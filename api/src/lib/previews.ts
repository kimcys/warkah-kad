// Previews of a customer's own card: what the screens are told, how long a preview lives, and where its files sit in R2.
// The build itself is done by the build server (routes/build.ts); this file is the shared vocabulary.
import type { CardRow } from "./cards";

export const PREVIEW_TTL = 7 * 24 * 3_600_000;
/** A build that has not finished by now is given up on and offered to the next claim (the build server crashed or lost its connection). */
export const BUILD_TIMEOUT = 5 * 60_000;
export const MAX_ATTEMPTS = 3;

export interface JobRow {
  id: string;
  card_id: string;
  kind: "preview" | "publish";
  state: "queued" | "building" | "ready" | "failed";
  draft_version: number | null;
  attempts: number;
  error: string | null;
  created_at: number;
  claimed_at: number | null;
  finished_at: number | null;
}

export const previewPrefix = (token: string, jobId: string) => `previews/${token}/${jobId}/`;
export const previewUrl = (token: string) => `/p/${token}/`;
export const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The current preview of a card, or null: built, not expired. */
export function livePreview(row: CardRow, now: number): { token: string; version: number; expiresAt: number } | null {
  if (!row.preview_token || !row.preview_job || row.preview_version === null || !row.preview_expires || row.preview_expires <= now) return null;
  return { token: row.preview_token, version: row.preview_version, expiresAt: row.preview_expires };
}

/**
 * What GET /cards/:id/preview answers.
 *   state     none | queued | building | ready | failed (the newest job's state wins while it is working or has failed)
 *   stale     there is no preview of the card as it is now: none yet, expired, or the card changed after it was built
 */
export function previewView(row: CardRow, latest: JobRow | null, now: number) {
  const live = livePreview(row, now);
  const working = latest && (latest.state === "queued" || latest.state === "building");
  const failed = latest && latest.state === "failed" && (!live || latest.created_at > (row.preview_expires ?? 0) - PREVIEW_TTL);
  const state = working ? latest!.state : failed ? "failed" : live ? "ready" : "none";
  return {
    state,
    builtVersion: live?.version ?? null,
    stale: !live || live.version !== row.draft_version,          // true = there is no preview of the card as it is now (the purchase gate)
    url: live ? previewUrl(live.token) : null,
    expiresAt: live?.expiresAt ?? null,
    error: state === "failed" ? "build_failed" : null
  };
}

/** Deletes every object under a prefix (R2 lists and deletes in pages). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let n = 0;
  for (let round = 0; round < 50; round++) {
    const page = await bucket.list({ prefix, limit: 1000 });
    if (!page.objects.length) break;
    await bucket.delete(page.objects.map((o) => o.key));
    n += page.objects.length;
    if (!page.truncated) break;
  }
  return n;
}

// ---------- publishing

export const livePrefix = (slug: string, jobId: string) => `live/${slug}/${jobId}/`;

/** What GET /cards/:id/publish answers. state: none | queued | building | live | failed; `changed` = the card was edited after the version that is live. */
export function publishView(row: CardRow, latest: JobRow | null, now: number, origin: (slug: string) => string) {
  void now;
  const live = row.status === "live" && !!row.live_job;
  const working = latest && latest.kind === "publish" && (latest.state === "queued" || latest.state === "building");
  const failed = latest && latest.kind === "publish" && latest.state === "failed" && latest.error !== "unpublished" && latest.created_at > (row.published_at ?? 0);
  const state = working ? latest!.state : failed ? "failed" : live ? "live" : "none";
  return {
    state,
    url: live ? origin(row.slug) : null,
    publishedAt: row.published_at,
    changed: live ? row.live_version !== row.draft_version : false,
    error: state === "failed" ? (latest!.error === "changed" ? "changed" : "build_failed") : null
  };
}
