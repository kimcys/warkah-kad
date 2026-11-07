import { Hono } from "hono";
import * as v from "valibot";
import { THEME_KEYS, isValidSlug, sanitizeDraft, slugProblem } from "@warkah/card-kit";
import catalogue from "@warkah/card-kit/catalogue.json";
import { ownedCard, assetsOf, assetView, cardView, fullView, parseDraft, statusOf, mergePatch, fileRefProblems, EDITABLE_KEYS, KIT_VERSION, MAX_CARDS_PER_USER, MAX_DRAFT_BYTES, type AssetRow, type CardRow } from "../lib/cards";
import { UPLOAD_STATUS, inspect, place, ruleFor, unreference } from "../lib/card-assets";
import { serveObject } from "../lib/media";
import { deletePrefix, livePrefix, livePreview, newToken, previewView, publishView, type JobRow } from "../lib/previews";
import { allow } from "../lib/ratelimit";
import { requireUser, type AppEnv } from "../lib/session";
import { randomSuffix } from "../lib/text";
import { readJson } from "../lib/validate";
import { effectiveFeatures } from "@warkah/card-kit";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const MAX_UPLOAD_BODY = 8 * 1024 * 1024 + 64 * 1024;

/** The builder's catalogue: themes, palettes, models, features, tiers, the form's steps, upload rules, samples. Public, the same for everyone. */
export const catalogueRoute = new Hono<AppEnv>();
catalogueRoute.get("/", (c) => {
  c.header("Cache-Control", "public, max-age=3600, s-maxage=3600");
  return c.json({ kitVersion: KIT_VERSION, ...(catalogue as object) });
});

export const cardRoutes = new Hono<AppEnv>();
cardRoutes.use("*", requireUser);

const CreateSchema = v.strictObject({
  lang: v.optional(v.picklist(["ms", "en"])),
  theme: v.optional(v.picklist(THEME_KEYS as unknown as [string, ...string[]]))
});

const PatchSchema = v.strictObject({
  baseVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  patch: v.record(v.string(), v.unknown())
});

const SlugSchema = v.strictObject({ slug: v.pipe(v.string(), v.trim(), v.toLowerCase()) });

const EDITABLE = new Set<string>(EDITABLE_KEYS);
const editable = (row: CardRow) => row.status === "draft" || row.status === "paid" || row.status === "live";   // a live card can be edited and published again; the live version does not change until then

cardRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare("SELECT * FROM cards WHERE owner_user_id = ? AND status != 'archived' ORDER BY updated_at DESC").bind(c.get("user").id).all<CardRow>();
  const cards = await Promise.all(
    rows.results.map(async (row) => {
      const draft = parseDraft(row);
      return cardView(row, draft, statusOf(row, draft, await assetsOf(db, row.id)));
    })
  );
  return c.json({ cards });
});

cardRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson(c, CreateSchema);
  if (!body) return c.json({ error: "invalid_input" }, 400);
  const now = c.get("now");
  const db = c.env.DB;
  if (!(await allow(db, `card:create:${user.id}`, 10, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

  const lang = body.lang ?? "ms";
  const draft: Record<string, unknown> = { lang };
  if (body.theme) draft.theme = body.theme;
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = `kad-${randomSuffix(6)}`;                  // a temporary address; the customer picks the real one from their names
    try {
      // The cap is part of the insert, so parallel requests cannot go past it.
      const inserted = await db
        .prepare(
          "INSERT INTO cards (id, owner_user_id, slug, lang, draft_json, kit_version, created_at, updated_at) " +
            "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE (SELECT COUNT(*) FROM cards WHERE owner_user_id = ?2 AND status != 'archived') < ?8"
        )
        .bind(id, user.id, slug, lang, JSON.stringify(draft), KIT_VERSION, now, MAX_CARDS_PER_USER)
        .run();
      if (inserted.meta.changes === 0) return c.json({ error: "card_limit" }, 403);
      const row = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
      return c.json(await fullView(db, row!), 201);
    } catch (err) {
      if (String((err as Error).message).includes("cards.slug")) continue;
      throw err;
    }
  }
  return c.json({ error: "internal" }, 500);
});

cardRoutes.get("/:id", async (c) => {
  const row = await ownedCard(c.env.DB, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await fullView(c.env.DB, row));
});

// Autosave. A JSON merge patch on the draft, checked against the version the browser last saw.
cardRoutes.patch("/:id", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await ownedCard(db, user, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!editable(row)) return c.json({ error: "not_editable" }, 409);
  const body = await readJson(c, PatchSchema);
  if (!body) return c.json({ error: "invalid_input" }, 400);
  const now = c.get("now");
  if (!(await allow(db, `card:save:${row.id}`, 120, MINUTE, now))) return c.json({ error: "rate_limited" }, 429);

  const forbidden = Object.keys(body.patch).filter((k) => !EDITABLE.has(k));
  if (forbidden.length) return c.json({ error: "invalid_input", fields: forbidden }, 400);
  if (body.baseVersion !== row.draft_version) return c.json({ error: "stale", ...(await fullView(db, row)) }, 409);

  const merged = mergePatch(parseDraft(row), body.patch) as Record<string, any>;
  if (merged.theme !== undefined && !THEME_KEYS.includes(merged.theme as never)) return c.json({ error: "invalid_input", fields: ["theme"] }, 400);
  if (merged.lang !== undefined && merged.lang !== "ms" && merged.lang !== "en") return c.json({ error: "invalid_input", fields: ["lang"] }, 400);
  const badRefs = fileRefProblems(merged);
  if (badRefs.length) return c.json({ error: "invalid_input", fields: badRefs }, 400);

  const { draft, changes } = sanitizeDraft(merged);
  const json = JSON.stringify(draft);
  if (json.length > MAX_DRAFT_BYTES) return c.json({ error: "too_large" }, 413);

  // A switch their package does not include is refused, not silently dropped.
  const effective = effectiveFeatures(draft, row.tier);
  const explicit = (draft.features && typeof draft.features === "object" ? draft.features : {}) as Record<string, unknown>;
  const locked = Object.keys(explicit).filter((k) => explicit[k] === true && effective[k] === false);
  if (locked.length) {
    const offered = new Set((catalogue as { features: { key: string; offered?: boolean }[] }).features.filter((f) => f.offered !== false).map((f) => f.key));
    return c.json({ error: locked.every((k) => offered.has(k)) ? "not_in_tier" : "not_offered", features: locked }, 403);
  }

  const lang = draft.lang === "en" ? "en" : draft.lang === "ms" ? "ms" : row.lang;
  const result = await db
    .prepare("UPDATE cards SET draft_json = ?, draft_version = draft_version + 1, lang = ?, kit_version = ?, updated_at = ? WHERE id = ? AND draft_version = ?")
    .bind(json, lang, KIT_VERSION, now, row.id, row.draft_version)
    .run();
  if (result.meta.changes === 0) {
    const fresh = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(row.id).first<CardRow>();
    return c.json({ error: "stale", ...(await fullView(db, fresh!)) }, 409);
  }
  const saved = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(row.id).first<CardRow>())!;
  const assets = await assetsOf(db, row.id);
  const status = statusOf(saved, draft, assets);
  return c.json({ version: saved.draft_version, status, changes, card: cardView(saved, draft, status) });
});

// ---------- the card's address

cardRoutes.get("/:id/slug", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await ownedCard(db, user, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const value = (c.req.query("value") ?? "").trim().toLowerCase();
  const problem = slugProblem(value);
  if (problem) return c.json({ ok: false, problem });
  if (await slugTaken(db, value, row)) return c.json({ ok: false, problem: "Alamat ini sudah digunakan. Sila pilih yang lain." });
  return c.json({ ok: true });
});

cardRoutes.put("/:id/slug", async (c) => {
  const db = c.env.DB;
  const row = await ownedCard(db, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft" && row.status !== "paid") return c.json({ error: "not_editable" }, 409);   // once live, the address is on printed cards and in chats
  const body = await readJson(c, SlugSchema);
  if (!body || !isValidSlug(body.slug)) return c.json({ error: "invalid_slug" }, 400);
  if (await slugTaken(db, body.slug, row)) return c.json({ error: "slug_taken" }, 409);
  try {
    await db.prepare("UPDATE cards SET slug = ?, draft_version = draft_version + 1, updated_at = ? WHERE id = ?").bind(body.slug, c.get("now"), row.id).run();
  } catch (err) {
    if (String((err as Error).message).includes("cards.slug")) return c.json({ error: "slug_taken" }, 409);
    throw err;
  }
  return c.json(await fullView(db, (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(row.id).first<CardRow>())!));
});

/** An address another card already uses. */
async function slugTaken(db: D1Database, slug: string, card: CardRow): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM cards WHERE slug = ? AND id != ? AND status != 'archived'").bind(slug, card.id).first());
}

// ---------- files

cardRoutes.post("/:id/assets", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await ownedCard(db, user, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!editable(row)) return c.json({ error: "not_editable" }, 409);
  if (Number(c.req.header("content-length") ?? 0) > MAX_UPLOAD_BODY) return c.json({ error: "too_large" }, 413);
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return c.json({ error: "invalid_input" }, 400);
  const now = c.get("now");
  if (!(await allow(db, `card:upload:${user.id}`, 40, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

  const form = await c.req.formData().catch(() => null);
  const kind = form?.get("kind");
  const file = form?.get("file");
  const slotField = form?.get("slot");
  const slot = typeof slotField === "string" && slotField ? slotField : null;
  const rule = typeof kind === "string" ? ruleFor(kind) : undefined;
  if (!form || !rule || !(file instanceof File)) return c.json({ error: "invalid_input" }, 400);
  if (file.size > rule.maxBytes) return c.json({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspect(rule, bytes);
  if (!inspected.ok) return c.json({ error: inspected.error }, UPLOAD_STATUS[inspected.error]);

  // The draft may change while we work (autosave), so the update is checked against its version and tried again.
  for (let attempt = 0; attempt < 4; attempt++) {
    const card = attempt === 0 ? row : await ownedCard(db, user, row.id);
    if (!card || !editable(card)) return c.json({ error: "not_found" }, 404);
    const assets = await assetsOf(db, card.id);
    const placed = place(card, rule, slot, inspected.value, assets, parseDraft(card));
    if (!placed.ok) return c.json({ error: placed.error }, UPLOAD_STATUS[placed.error]);
    const { path, replaces, apply } = placed.value;
    const draft = parseDraft(card);
    apply(draft);
    const json = JSON.stringify(draft);
    if (json.length > MAX_DRAFT_BYTES) return c.json({ error: "too_large" }, 413);

    const r2Key = `cards/${card.id}/${path}`;
    await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: inspected.value.contentType } });
    const id = crypto.randomUUID();
    const [, updated] = await db.batch([
      db
        .prepare(
          "INSERT INTO card_assets (id, card_id, kind, path, r2_key, bytes, width, height, content_type, created_at) " +
            "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE EXISTS (SELECT 1 FROM cards WHERE id = ?2 AND draft_version = ?11) " +
            "ON CONFLICT(card_id, path) DO UPDATE SET kind = excluded.kind, r2_key = excluded.r2_key, bytes = excluded.bytes, width = excluded.width, height = excluded.height, content_type = excluded.content_type, created_at = excluded.created_at"
        )
        .bind(id, card.id, rule.key, path, r2Key, bytes.length, inspected.value.width, inspected.value.height, inspected.value.contentType, now, card.draft_version),
      db.prepare("UPDATE cards SET draft_json = ?, draft_version = draft_version + 1, kit_version = ?, updated_at = ? WHERE id = ? AND draft_version = ?").bind(json, KIT_VERSION, now, card.id, card.draft_version)
    ]);
    if (updated.meta.changes === 0) continue;

    for (const old of replaces) {
      await c.env.MEDIA.delete(old.r2_key).catch((e) => console.error("card file delete failed", e));
      await db.prepare("DELETE FROM card_assets WHERE id = ?").bind(old.id).run();
    }
    const saved = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(card.id).first<CardRow>())!;
    const all = await assetsOf(db, card.id);
    const asset = all.find((a) => a.path === path)!;
    const status = statusOf(saved, draft, all);
    return c.json({ asset: assetView(asset), version: saved.draft_version, status, card: cardView(saved, draft, status) }, 201);
  }
  return c.json({ error: "stale" }, 409);
});

cardRoutes.delete("/:id/assets/:assetId", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await ownedCard(db, user, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!editable(row)) return c.json({ error: "not_editable" }, 409);
  const asset = await db.prepare("SELECT * FROM card_assets WHERE id = ? AND card_id = ?").bind(c.req.param("assetId"), row.id).first<AssetRow>();
  if (!asset) return c.json({ error: "not_found" }, 404);
  const now = c.get("now");
  for (let attempt = 0; attempt < 4; attempt++) {
    const card = attempt === 0 ? row : await ownedCard(db, user, row.id);
    if (!card) return c.json({ error: "not_found" }, 404);
    const draft = parseDraft(card);
    unreference(draft, asset);
    const [deleted, updated] = await db.batch([
      db.prepare("DELETE FROM card_assets WHERE id = ? AND EXISTS (SELECT 1 FROM cards WHERE id = ? AND draft_version = ?)").bind(asset.id, card.id, card.draft_version),
      db.prepare("UPDATE cards SET draft_json = ?, draft_version = draft_version + 1, kit_version = ?, updated_at = ? WHERE id = ? AND draft_version = ?").bind(JSON.stringify(draft), KIT_VERSION, now, card.id, card.draft_version)
    ]);
    void deleted;
    if (updated.meta.changes === 0) continue;
    await c.env.MEDIA.delete(asset.r2_key).catch((e) => console.error("card file delete failed", e));
    const saved = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(card.id).first<CardRow>())!;
    const status = statusOf(saved, draft, await assetsOf(db, card.id));
    return c.json({ version: saved.draft_version, status, card: cardView(saved, draft, status) });
  }
  return c.json({ error: "stale" }, 409);
});

// The owner's own uploads, for the editor. Never public: the public copy is part of the built card.
cardRoutes.get("/:id/files/*", async (c) => {
  const db = c.env.DB;
  const row = await ownedCard(db, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const path = decodeURIComponent(c.req.path.split("/files/")[1] ?? "");
  const asset = await db.prepare("SELECT * FROM card_assets WHERE card_id = ? AND path = ?").bind(row.id, path).first<AssetRow>();
  if (!asset) return c.json({ error: "not_found" }, 404);
  const res = await serveObject(c.env.MEDIA, asset.r2_key, c.req.raw, "private, max-age=300");
  return res ?? c.json({ error: "not_found" }, 404);
});

// ---------- preview: a real build of the customer's own card, made by the build server (routes/build.ts). Required before the card can be bought.

const latestJob = (db: D1Database, cardId: string, kind: "preview" | "publish" = "preview") => db.prepare("SELECT * FROM card_jobs WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(cardId, kind).first<JobRow>();

cardRoutes.get("/:id/preview", async (c) => {
  const row = await ownedCard(c.env.DB, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(previewView(row, await latestJob(c.env.DB, row.id), c.get("now")));
});

cardRoutes.post("/:id/preview", async (c) => {
  const db = c.env.DB;
  const row = await ownedCard(db, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!editable(row)) return c.json({ error: "not_editable" }, 409);
  const now = c.get("now");
  const status = statusOf(row, parseDraft(row), await assetsOf(db, row.id));
  if (!status.ready) return c.json({ error: "not_ready", status }, 409);          // a preview is only built from a complete card, so it never needs a stranger's words
  if (!(await allow(db, `card:preview:${row.id}`, 20, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

  const waiting = await db.prepare("SELECT * FROM card_jobs WHERE card_id = ? AND kind = 'preview' AND state = 'queued' ORDER BY created_at DESC LIMIT 1").bind(row.id).first<JobRow>();   // it will build whatever the draft is when it starts
  if (!waiting) {
    if (!row.preview_token) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await db.prepare("UPDATE cards SET preview_token = ? WHERE id = ? AND preview_token IS NULL").bind(newToken(), row.id).run(); break; } catch (err) { if (attempt === 2) throw err; }
      }
    }
    await db.prepare("INSERT INTO card_jobs (id, card_id, kind, created_at) VALUES (?, ?, 'preview', ?)").bind(crypto.randomUUID(), row.id, now).run();
  }
  const fresh = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(row.id).first<CardRow>())!;
  return c.json(previewView(fresh, await latestJob(db, row.id), now), 202);
});

// ---------- publish: the real card, built by the build server from the version the customer previewed, served at https://<card domain>/<slug>/

const originOf = (c: { env: Cloudflare.Env; req: { url: string } }) => (slug: string) => {
  const host = c.env.CARD_HOST;
  const here = new URL(c.req.url);
  return host && host !== here.hostname ? `https://${host}/${slug}/` : `${here.origin}/${slug}/`;    // on the card host itself (or in development), the address of this server
};

cardRoutes.get("/:id/publish", async (c) => {
  const row = await ownedCard(c.env.DB, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(publishView(row, await latestJob(c.env.DB, row.id, "publish"), c.get("now"), originOf(c)));
});

/**
 * Takes the live card down: guests get "not found" at once, the files are deleted, and the card goes back to `paid`, so it can be edited
 * and published again (its address is free to change again). A publish still waiting or building is cancelled.
 */
cardRoutes.post("/:id/unpublish", async (c) => {
  const db = c.env.DB;
  const row = await ownedCard(db, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "live") return c.json({ error: "not_live" }, 409);
  const now = c.get("now");
  await db.batch([
    db.prepare("UPDATE card_jobs SET state = 'failed', error = 'unpublished', finished_at = ?1 WHERE card_id = ?2 AND kind = 'publish' AND state IN ('queued', 'building')").bind(now, row.id),
    db.prepare("UPDATE cards SET status = 'paid', live_job = NULL, live_version = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'live'").bind(now, row.id)
  ]);
  if (row.live_job) await deletePrefix(c.env.MEDIA, livePrefix(row.slug, row.live_job)).catch((e) => console.error("live delete failed", e));
  const fresh = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(row.id).first<CardRow>())!;
  return c.json(publishView(fresh, await latestJob(db, row.id, "publish"), now, originOf(c)));
});

cardRoutes.post("/:id/publish", async (c) => {
  const db = c.env.DB;
  const row = await ownedCard(db, c.get("user"), c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const now = c.get("now");
  if (row.status !== "paid" && row.status !== "live") return c.json({ error: "payment_required" }, 402);   // an admin marks a card paid until online payment exists
  const status = statusOf(row, parseDraft(row), await assetsOf(db, row.id));
  if (!status.ready) return c.json({ error: "not_ready", status }, 409);
  const preview = livePreview(row, now);
  if (!preview || preview.version !== row.draft_version) return c.json({ error: "preview_required" }, 409);    // the customer must have seen the card as it is now
  if (!(await allow(db, `card:publish:${row.id}`, 10, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

  const waiting = await db.prepare("SELECT * FROM card_jobs WHERE card_id = ? AND kind = 'publish' AND state = 'queued' LIMIT 1").bind(row.id).first<JobRow>();
  if (!waiting) await db.prepare("INSERT INTO card_jobs (id, card_id, kind, draft_version, created_at) VALUES (?, ?, 'publish', ?, ?)").bind(crypto.randomUUID(), row.id, row.draft_version, now).run();
  return c.json(publishView(row, await latestJob(db, row.id, "publish"), now, originOf(c)), 202);
});
