// The invitation builder's cards: rows, views, ownership, and the rules for changing a draft.
// What a valid card is lives in @warkah/card-kit (built from warkah-engine); this file only applies it to the database.
import { KIT_VERSION, THEME_KEYS, draftStatus, effectiveFeatures, mergePatch, type DraftStatus, type Lang, type TierId } from "@warkah/card-kit";
import type { SessionUser } from "./session";

export interface CardRow {
  id: string;
  owner_user_id: string;
  slug: string;
  lang: Lang;
  tier: TierId;
  status: "draft" | "paid" | "live" | "archived";
  draft_json: string;
  draft_version: number;
  kit_version: string;
  preview_version: number | null;
  preview_token: string | null;
  preview_expires: number | null;
  preview_job: string | null;
  live_job: string | null;
  live_version: number | null;
  live_json: string | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AssetRow {
  id: string;
  card_id: string;
  kind: string;
  path: string;
  r2_key: string;
  bytes: number;
  width: number | null;
  height: number | null;
  content_type: string;
  created_at: number;
}

export const MAX_CARDS_PER_USER = 3;
export const MAX_DRAFT_BYTES = 100_000;
export const DRAFT_IDLE_DAYS = 90;
export { KIT_VERSION, mergePatch };

/** Owner or admin. Anyone else gets null, which routes answer as 404 so existence is not revealed. */
export async function ownedCard(db: D1Database, user: SessionUser, id: string): Promise<CardRow | null> {
  const row = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!row || row.status === "archived") return null;
  return row.owner_user_id === user.id || user.role === "admin" ? row : null;
}

export const assetsOf = (db: D1Database, cardId: string) =>
  db.prepare("SELECT * FROM card_assets WHERE card_id = ? ORDER BY created_at, path").bind(cardId).all<AssetRow>().then((r) => r.results);

export function parseDraft(row: Pick<CardRow, "draft_json">): Record<string, any> {
  try {
    const value = JSON.parse(row.draft_json);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The kit's verdict on this card: what is wrong, what is missing, whether it may go on. */
export function statusOf(card: CardRow, draft: Record<string, any>, assets: AssetRow[]): DraftStatus {
  return draftStatus(draft, { tier: card.tier, lang: card.lang, slug: card.slug, assets: assets.map((a) => a.path) });
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** "Aisyah & Hafiz" in the order of the card, or "" while the names are not filled in. */
export function namesOf(draft: Record<string, any>): string {
  const g = text(draft.couple?.groom?.short) || text(draft.couple?.groom?.name);
  const b = text(draft.couple?.bride?.short) || text(draft.couple?.bride?.name);
  const [a, c] = draft.couple?.first === "bride" ? [b, g] : [g, b];
  return [a, c].filter(Boolean).join(" & ");
}

export function cardView(row: CardRow, draft: Record<string, any>, status: DraftStatus) {
  return {
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    tier: row.tier,
    status: row.status,
    theme: THEME_KEYS.includes(draft.theme) ? draft.theme : null,
    names: namesOf(draft),
    version: row.draft_version,
    kitVersion: row.kit_version,
    completeness: status.completeness,
    ready: status.ready,
    previewVersion: row.preview_version,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function fullView(db: D1Database, row: CardRow) {
  const draft = parseDraft(row);
  const assets = await assetsOf(db, row.id);
  const status = statusOf(row, draft, assets);
  return {
    card: cardView(row, draft, status),
    draft,
    status,
    allowed: { features: effectiveFeatures(draft, row.tier) },
    assets: assets.map(assetView)
  };
}

export const assetView = (a: AssetRow) => ({ id: a.id, kind: a.kind, path: a.path, bytes: a.bytes, width: a.width, height: a.height, contentType: a.content_type, createdAt: a.created_at });

// ---------- changing a draft

/** The top-level parts of a draft a customer may change. Everything else (hosting, store, package, meta, ...) belongs to the system. */
export const EDITABLE_KEYS = ["lang", "theme", "palette", "couple", "host", "date", "venue", "aturcara", "music", "gallery", "contacts", "rsvp", "features", "gifts", "duitnow", "dressCode", "ayat"] as const;

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Where an uploaded file may be referenced from. The patch route calls this so a customer cannot point the card at anything but a canonical
 * path of their own uploads (the publish job copies files by the asset table, never by a path found in the draft).
 */
export function fileRefProblems(draft: Record<string, any>): string[] {
  const bad: string[] = [];
  if (Array.isArray(draft.gallery)) {
    draft.gallery.forEach((g: any, i: number) => {
      if (!isObject(g) || typeof g.src !== "string" || !/^gallery\/\d{1,2}\.(webp|jpg|png)$/.test(g.src)) bad.push(`gallery.${i}.src`);
    });
  }
  if (draft.music?.src !== undefined && !/^audio\/song\.(mp3|m4a)$/.test(String(draft.music.src))) bad.push("music.src");
  if (draft.music?.type !== undefined && !["audio/mpeg", "audio/mp4"].includes(String(draft.music.type))) bad.push("music.type");
  if (draft.music?.fallback !== undefined) bad.push("music.fallback");
  if (draft.duitnow?.image !== undefined && !/^duitnow\/qr\.(png|webp)$/.test(String(draft.duitnow.image))) bad.push("duitnow.image");
  return bad;
}
