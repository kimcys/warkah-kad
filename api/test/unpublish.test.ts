import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { harness } from "./helpers";
import { build, buildEnv, finishJob, readyCard, type H } from "./build-helpers";

const CARD_HOST = "cards.test";
const asHost = (h: H, path: string) => h.app.request(`https://${CARD_HOST}${path}`, { headers: { "cf-connecting-ip": h.ip } }, { ...buildEnv, CARD_HOST });
const clearQueue = () => env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
const claim = async (h: H) => (await h.json(await build(h, "POST", "/claim"))).job;

/** A card that is live: paid, previewed, published and built. */
async function liveCard(h: H) {
  await clearQueue();
  const card = await readyCard(h);
  await env.DB.prepare("UPDATE cards SET status = 'paid' WHERE id = ?").bind(card.id).run();
  await h.call("POST", `/api/cards/${card.id}/preview`, {}, card.cookie);
  await finishJob(h, (await claim(h)).id);
  await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
  const job = await claim(h);
  await finishJob(h, job.id);
  const row = (await env.DB.prepare("SELECT slug FROM cards WHERE id = ?").bind(card.id).first<{ slug: string }>())!;
  return { ...card, ...row, job };
}
const unpublish = (h: H, c: { id: string; cookie: string }) => h.call("POST", `/api/cards/${c.id}/unpublish`, {}, c.cookie);

describe("unpublish", () => {
  it("takes the card down at once, deletes its files and leaves it paid and editable", async () => {
    const h = harness();
    const card = await liveCard(h);
    expect((await asHost(h, `/${card.slug}/`)).status).toBe(200);
    const res = await unpublish(h, card);
    expect(res.status).toBe(200);
    expect(await h.json(res)).toMatchObject({ state: "none", url: null });
    expect((await asHost(h, `/${card.slug}/`)).status).not.toBe(200);
    const listed = await env.MEDIA.list({ prefix: `live/${card.slug}/` });
    expect(listed.objects).toHaveLength(0);
    const row = await env.DB.prepare("SELECT status, live_job, live_version FROM cards WHERE id = ?").bind(card.id).first();
    expect(row).toEqual({ status: "paid", live_job: null, live_version: null });
    // still editable, and the address can change again
    expect((await h.call("GET", `/api/cards/${card.id}`, undefined, card.cookie)).status).toBe(200);
    expect((await h.call("PUT", `/api/cards/${card.id}/slug`, { slug: `new-${card.slug}`.slice(0, 40) }, card.cookie)).status).toBe(200);
  });

  it("can be published again afterwards", async () => {
    const h = harness();
    const card = await liveCard(h);
    await unpublish(h, card);
    await clearQueue();
    await h.call("POST", `/api/cards/${card.id}/preview`, {}, card.cookie);
    await finishJob(h, (await claim(h)).id);
    expect((await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie)).status).toBe(202);
    await finishJob(h, (await claim(h)).id);
    expect((await asHost(h, `/${card.slug}/`)).status).toBe(200);
  });

  it("is for the owner of a live card only", async () => {
    const h = harness();
    const card = await liveCard(h);
    const other = await h.signIn(`o-${Math.random().toString(36).slice(2)}@example.com`);
    expect((await h.call("POST", `/api/cards/${card.id}/unpublish`, {}, other)).status).toBe(404);
    expect((await h.call("POST", `/api/cards/${card.id}/unpublish`, {})).status).toBe(401);
    expect((await unpublish(h, card)).status).toBe(200);
    const again = await unpublish(h, card);
    expect(again.status).toBe(409);
    expect((await h.json(again)).error).toBe("not_live");
  });

  it("cancels a republish that is still waiting, so the card does not come back", async () => {
    const h = harness();
    const card = await liveCard(h);
    await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    const waiting = await claim(h);                      // being built when the customer takes the card down
    await unpublish(h, card);
    expect((await build(h, "PUT", `/jobs/${waiting.id}/out/index.html`, "x")).status).toBe(404);   // the build server is told to stop
    expect((await build(h, "POST", `/jobs/${waiting.id}/done`, {})).status).toBe(404);
    expect((await asHost(h, `/${card.slug}/`)).status).not.toBe(200);
    expect((await h.json(await h.call("GET", `/api/cards/${card.id}/publish`, undefined, card.cookie))).state).toBe("none");
  });
});
