// The build server's side of the preview job queue. The build server (a separate machine that has the private engine) calls these with
// `Authorization: Bearer <BUILD_SECRET>`; nothing here is for browsers, and without the secret configured every route answers 503.
//   POST /claim               takes the oldest queued job: { job, draft, assets } (204 when there is none)
//   GET  /jobs/:id/files/*    one of the customer's uploaded files
//   PUT  /jobs/:id/out/*      one file of the finished card
//   POST /jobs/:id/done       { files } the preview is ready (needs index.html)      POST /jobs/:id/fail   { error }
import { Hono } from "hono";
import { assetsOf, parseDraft, type CardRow } from "../lib/cards";
import { BUILD_TIMEOUT, MAX_ATTEMPTS, PREVIEW_TTL, deletePrefix, livePrefix, previewPrefix, type JobRow } from "../lib/previews";
import type { AppEnv } from "../lib/session";

const MAX_FILE = 8 * 1024 * 1024;
const OUT_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._@~-]+(\/[A-Za-z0-9._@~-]+)*$/;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", avif: "image/avif",
  woff2: "font/woff2", woff: "font/woff", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", txt: "text/plain; charset=utf-8", xml: "application/xml", webmanifest: "application/manifest+json"
};
export const typeOf = (path: string) => TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

const equal = (a: string, b: string) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

export const buildRoutes = new Hono<AppEnv>();

buildRoutes.use("*", async (c, next) => {
  const secret = c.env.BUILD_SECRET;
  if (!secret) return c.json({ error: "build_not_configured" }, 503);
  const given = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
  if (!given || !equal(given, secret)) return c.json({ error: "unauthorized" }, 401);
  await next();
});

/** Where a job's finished files go in R2 until they are made current. */
const outPrefix = (job: JobRow, card: CardRow) => (job.kind === "publish" ? livePrefix(card.slug, job.id) : previewPrefix(card.preview_token!, job.id));

/** The job, if the build server may still work on it. */
async function building(c: { env: Cloudflare.Env; req: { param(n: string): string } }): Promise<{ job: JobRow; card: CardRow } | null> {
  const job = await c.env.DB.prepare("SELECT * FROM card_jobs WHERE id = ? AND state = 'building'").bind(c.req.param("id")).first<JobRow>();
  if (!job) return null;
  const card = await c.env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(job.card_id).first<CardRow>();
  return card ? { job, card } : null;
}

buildRoutes.post("/claim", async (c) => {
  const db = c.env.DB;
  const now = c.get("now");
  // A build that went quiet is put back in the queue (or given up on after a few tries), so a crashed build server does not leave a customer waiting.
  await db.batch([
    db.prepare("UPDATE card_jobs SET state = 'failed', error = 'timeout', finished_at = ?1 WHERE state = 'building' AND claimed_at < ?2 AND attempts >= ?3").bind(now, now - BUILD_TIMEOUT, MAX_ATTEMPTS),
    db.prepare("UPDATE card_jobs SET state = 'queued' WHERE state = 'building' AND claimed_at < ?1 AND attempts < ?2").bind(now - BUILD_TIMEOUT, MAX_ATTEMPTS)
  ]);
  const claimed = await db
    .prepare(
      "UPDATE card_jobs SET state = 'building', claimed_at = ?1, attempts = attempts + 1 " +
        "WHERE id = (SELECT id FROM card_jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1) AND state = 'queued' RETURNING id, card_id, kind, draft_version"
    )
    .bind(now)
    .first<{ id: string; card_id: string; kind: "preview" | "publish"; draft_version: number | null }>();
  if (!claimed) return c.body(null, 204);
  const card = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(claimed.card_id).first<CardRow>();
  const give = async (state: string, error: string) => { await db.prepare("UPDATE card_jobs SET state = ?, error = ?, finished_at = ? WHERE id = ?").bind(state, error, now, claimed.id).run(); return c.body(null, 204); };
  if (!card || card.status === "archived") return give("failed", "card_gone");
  if (claimed.kind === "publish") {
    // What goes live is the version the customer previewed. If the card was edited since they asked, it is not built: they preview again.
    if (card.draft_version !== claimed.draft_version) return give("failed", "changed");
    if (card.status !== "paid" && card.status !== "live") return give("failed", "not_paid");
  } else {
    if (!card.preview_token) return give("failed", "card_gone");
    await db.prepare("UPDATE card_jobs SET draft_version = ? WHERE id = ?").bind(card.draft_version, claimed.id).run();   // the version and the draft come from one read
  }
  const assets = await assetsOf(db, card.id);
  return c.json({
    job: { id: claimed.id, kind: claimed.kind, token: card.preview_token, slug: card.slug, tier: card.tier, lang: card.lang, draftVersion: card.draft_version },
    draft: parseDraft(card),
    assets: assets.map((a) => ({ path: a.path, bytes: a.bytes, contentType: a.content_type }))
  });
});

buildRoutes.get("/jobs/:id/files/*", async (c) => {
  const found = await building(c);
  if (!found) return c.json({ error: "not_found" }, 404);
  const path = decodeURIComponent(c.req.path.split("/files/")[1] ?? "");
  const asset = await c.env.DB.prepare("SELECT r2_key, content_type FROM card_assets WHERE card_id = ? AND path = ?").bind(found.card.id, path).first<{ r2_key: string; content_type: string }>();
  const obj = asset ? await c.env.MEDIA.get(asset.r2_key) : null;
  if (!asset || !obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": asset.content_type, "Content-Length": String(obj.size) } });
});

buildRoutes.put("/jobs/:id/out/*", async (c) => {
  const found = await building(c);
  if (!found) return c.json({ error: "not_found" }, 404);
  const path = decodeURIComponent(c.req.path.split("/out/")[1] ?? "");
  if (!OUT_PATH.test(path) || path.length > 200) return c.json({ error: "invalid_input" }, 400);
  if (Number(c.req.header("content-length") ?? 0) > MAX_FILE) return c.json({ error: "too_large" }, 413);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_FILE) return c.json({ error: "too_large" }, 413);
  await c.env.MEDIA.put(outPrefix(found.job, found.card) + path, bytes, { httpMetadata: { contentType: typeOf(path) } });
  return c.json({ ok: true });
});

buildRoutes.post("/jobs/:id/done", async (c) => {
  const found = await building(c);
  if (!found) return c.json({ error: "not_found" }, 404);
  const { job, card } = found;
  const now = c.get("now");
  const prefix = outPrefix(job, card);
  if (!(await c.env.MEDIA.head(prefix + "index.html"))) return c.json({ error: "incomplete" }, 409);
  if (job.kind === "publish") {
    const previous = card.live_job;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE card_jobs SET state = 'ready', error = NULL, finished_at = ? WHERE id = ?").bind(now, job.id),
      c.env.DB.prepare("UPDATE cards SET status = 'live', published_at = COALESCE(published_at, ?1), live_job = ?2, live_version = ?3, updated_at = ?1 WHERE id = ?4").bind(now, job.id, job.draft_version, card.id)
    ]);
    if (previous && previous !== job.id) await deletePrefix(c.env.MEDIA, livePrefix(card.slug, previous)).catch((e) => console.error("old live delete failed", e));
    return c.json({ ok: true });
  }
  const previous = card.preview_job;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE card_jobs SET state = 'ready', error = NULL, finished_at = ? WHERE id = ?").bind(now, job.id),
    c.env.DB.prepare("UPDATE cards SET preview_version = ?, preview_job = ?, preview_expires = ? WHERE id = ?").bind(job.draft_version, job.id, now + PREVIEW_TTL, card.id)
  ]);
  if (previous && previous !== job.id) await deletePrefix(c.env.MEDIA, previewPrefix(card.preview_token!, previous)).catch((e) => console.error("old preview delete failed", e));
  return c.json({ ok: true });
});

buildRoutes.post("/jobs/:id/fail", async (c) => {
  const found = await building(c);
  if (!found) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { error?: unknown };
  const error = typeof body.error === "string" ? body.error.slice(0, 300) : "failed";
  await c.env.DB.prepare("UPDATE card_jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(error, c.get("now"), found.job.id).run();
  await deletePrefix(c.env.MEDIA, outPrefix(found.job, found.card)).catch(() => {});
  return c.json({ ok: true });
});
