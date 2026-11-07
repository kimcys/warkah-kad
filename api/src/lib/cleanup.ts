import { deletePrefix, previewPrefix } from "./previews";

const DAY = 86_400_000;
const DRAFT_IDLE = 90 * DAY;   // a card draft nobody touched for this long is archived and its files deleted

/**
 * Card drafts nobody has touched for 90 days: their files go, their text is cleared and they are archived (the row stays, so the address is not reused by accident).
 * Published cards (live) and paid ones are never touched here.
 */
async function purgeIdleCards(env: Cloudflare.Env, now: number): Promise<number> {
  let files = 0;
  const cards = await env.DB.prepare("SELECT id FROM cards WHERE status = 'draft' AND updated_at < ? LIMIT 100").bind(now - DRAFT_IDLE).all<{ id: string }>();
  for (const card of cards.results) {
    const assets = await env.DB.prepare("SELECT r2_key FROM card_assets WHERE card_id = ?").bind(card.id).all<{ r2_key: string }>();
    const keys = assets.results.map((a) => a.r2_key);
    for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000)).catch((e) => console.error("card file delete failed", e));
    files += keys.length;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM card_assets WHERE card_id = ?").bind(card.id),
      env.DB.prepare("UPDATE cards SET status = 'archived', draft_json = '{}', updated_at = ? WHERE id = ?").bind(now, card.id)
    ]);
  }
  return files;
}

/** Previews are kept 7 days after the last build; then their files go (the card keeps its link, so the next preview has the same address). */
async function purgeExpiredPreviews(env: Cloudflare.Env, now: number): Promise<number> {
  let files = 0;
  const cards = await env.DB.prepare("SELECT id, preview_token, preview_job FROM cards WHERE preview_job IS NOT NULL AND preview_expires < ? LIMIT 100").bind(now).all<{ id: string; preview_token: string; preview_job: string }>();
  for (const card of cards.results) {
    files += await deletePrefix(env.MEDIA, previewPrefix(card.preview_token, card.preview_job)).catch((e) => { console.error("preview delete failed", e); return 0; });
    await env.DB.prepare("UPDATE cards SET preview_job = NULL, preview_version = NULL, preview_expires = NULL WHERE id = ?").bind(card.id).run();
  }
  await env.DB.prepare("DELETE FROM card_jobs WHERE state IN ('ready', 'failed') AND finished_at < ?").bind(now - 30 * DAY).run();
  return files;
}

/** Daily job: prunes counters, one-time codes and sessions that can no longer matter, archives idle drafts and removes expired previews. */
export async function cleanup(env: Cloudflare.Env, now: number): Promise<{ files: number }> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 2 * DAY),
    env.DB.prepare("DELETE FROM otp_codes WHERE expires_at < ?").bind(now - DAY),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM email_log WHERE kind = 'otp' AND sent_at < ?").bind(now - 30 * DAY)
  ]);
  const files = (await purgeIdleCards(env, now)) + (await purgeExpiredPreviews(env, now));
  console.log("cleanup", JSON.stringify({ files }));
  return { files };
}
