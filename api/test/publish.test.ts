import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { harness } from "./helpers";
import { build, buildEnv, bytes, finishJob, html, readyCard, serveAs, state, type H } from "./build-helpers";

const CARD_HOST = "cards.test";
const hostEnv = { ...buildEnv, CARD_HOST };
const asHost = (h: H, path: string, method = "GET") => h.app.request(`https://${CARD_HOST}${path}`, { method, headers: { "cf-connecting-ip": h.ip } }, hostEnv);
const clearQueue = () => env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
const admin = async (h: H) => {
  const email = `admin-${Math.random().toString(36).slice(2)}@example.com`;
  const cookie = await h.signIn(email);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE email = ?").bind(email).run();
  return cookie;
};
const grant = (h: H, adminCookie: string, id: string, body: object) => h.call("PATCH", `/api/admin/cards/${id}`, body, adminCookie);
const publishState = async (h: H, id: string, cookie: string) => h.json(await h.call("GET", `/api/cards/${id}/publish`, undefined, cookie));

/** A card that is complete, paid for (by an admin), and previewed at its current version. */
async function previewedCard(h: H) {
  const card = await readyCard(h);
  await h.call("POST", `/api/cards/${card.id}/preview`, {}, card.cookie);
  const { job } = await h.json(await build(h, "POST", "/claim"));
  await finishJob(h, job.id);
  return card;
}

describe("publish: the gates", () => {
  it("needs sign-in and a card of your own", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/cards/x/publish", {})).status).toBe(401);
    const a = await readyCard(h);
    const other = await h.signIn(`o-${Math.random().toString(36).slice(2)}@example.com`);
    expect((await h.call("POST", `/api/cards/${a.id}/publish`, {}, other)).status).toBe(404);
    expect((await h.call("GET", `/api/cards/${a.id}/publish`, undefined, other)).status).toBe(404);
  });

  it("is refused until the card is paid for (an admin marks it paid until online payment exists)", async () => {
    const h = harness();
    await clearQueue();
    const card = await previewedCard(h);
    const res = await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    expect(res.status).toBe(402);
    expect((await h.json(res)).error).toBe("payment_required");
    // only an admin can say so; a customer cannot give themselves the package
    expect((await grant(h, card.cookie, card.id, { paid: true })).status).toBe(403);
    const a = await admin(h);
    expect((await grant(h, a, card.id, {})).status).toBe(400);
    const granted = await h.json(await grant(h, a, card.id, { paid: true, tier: "full" }));
    expect(granted.card).toMatchObject({ status: "paid", tier: "full" });
  });

  it("is refused without a complete card, and without a preview of the card as it is now", async () => {
    const h = harness();
    await clearQueue();
    const a = await admin(h);
    const card = await readyCard(h);
    await grant(h, a, card.id, { paid: true });
    const noPreview = await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    expect(noPreview.status).toBe(409);
    expect((await h.json(noPreview)).error).toBe("preview_required");

    await h.call("POST", `/api/cards/${card.id}/preview`, {}, card.cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    await finishJob(h, job.id);
    expect((await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie)).status).toBe(202);   // previewed: allowed

    // an edit after the preview: not allowed until they preview again
    await clearQueue();
    const v = (await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, card.cookie))).card.version;
    await h.call("PATCH", `/api/cards/${card.id}`, { baseVersion: v, patch: { couple: { hashtag: "#baru" } } }, card.cookie);
    expect((await h.json(await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie))).error).toBe("preview_required");

    // an emptied required field: not ready
    await h.call("PATCH", `/api/cards/${card.id}`, { baseVersion: v + 1, patch: { venue: { name: null } } }, card.cookie);
    expect((await h.json(await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie))).error).toBe("not_ready");
  });
});

describe("publish: the build and what is served", () => {
  it("builds from the previewed version, goes live at /<slug>/ on the card host only, and leaves the preview alone", async () => {
    const h = harness();
    await clearQueue();
    const a = await admin(h);
    const card = await previewedCard(h);
    await grant(h, a, card.id, { paid: true });
    const asked = await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    expect(asked.status).toBe(202);
    expect(await h.json(asked)).toMatchObject({ state: "queued", url: null });
    const second = await h.json(await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie));
    expect(second.state).toBe("queued");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM card_jobs WHERE card_id = ? AND kind = 'publish'").bind(card.id).first<{ n: number }>())?.n).toBe(1);

    const claimed = await h.json(await build(h, "POST", "/claim"));
    expect(claimed.job).toMatchObject({ kind: "publish", tier: "basic" });
    expect(claimed.job.slug).toMatch(/^kad-/);
    expect((await publishState(h, card.id, card.cookie)).state).toBe("building");
    const slug = claimed.job.slug;
    expect((await asHost(h, `/${slug}/`)).status).toBeLessThan(500);
    const done = await finishJob(h, claimed.job.id, { "index.html": html, "_astro/a.js": bytes("console.log(1)"), "event/gallery/1.webp": bytes("x") });
    expect(done.status).toBe(200);

    const live = await publishState(h, card.id, card.cookie);
    expect(live).toMatchObject({ state: "live", changed: false });
    expect(live.url).toBe(`https://${env.CARD_HOST}/${slug}/`);       // the card domain from the Worker's settings
    expect(await env.DB.prepare("SELECT status, live_version, published_at FROM cards WHERE id = ?").bind(card.id).first()).toMatchObject({ status: "live", live_version: claimed.job.draftVersion });

    const page = await asHost(h, `/${slug}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello");
    expect(page.headers.get("x-robots-tag")).toBeNull();                              // (the card itself says noindex in its HTML: the engine does that for every card under a path)
    expect(page.headers.get("content-security-policy")).toBeNull();
    expect((await asHost(h, `/${slug}/_astro/a.js`)).headers.get("cache-control")).toContain("immutable");
    expect((await asHost(h, `/${slug}`)).status).toBe(301);
    expect((await asHost(h, `/${slug}/nope.html`)).status).toBe(404);
    expect((await asHost(h, `/${slug}/a%2F..%2Fb`)).status).toBe(404);
    // not on any other host, and never for something that is not live
    expect((await serveAs(h, `/${slug}/`)).headers.get("content-type") ?? "").not.toContain("hello");
    expect(await (await h.app.request(`https://kad.test/${slug}/`, {}, hostEnv)).text()).not.toContain("hello");
    expect(await (await asHost(h, `/kad-zzzzzz/`)).text()).not.toContain("hello");
    // the preview is still there
    expect((await state(h, card.id, card.cookie)).state).toBe("ready");
    // the card host's own paths are never taken by a card
    expect((await asHost(h, "/api/health")).status).toBe(200);
  });

  it("is not built if the card was edited after they asked: they preview again", async () => {
    const h = harness();
    await clearQueue();
    const a = await admin(h);
    const card = await previewedCard(h);
    await grant(h, a, card.id, { paid: true });
    await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    const v = (await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, card.cookie))).card.version;
    await h.call("PATCH", `/api/cards/${card.id}`, { baseVersion: v, patch: { couple: { hashtag: "#lain" } } }, card.cookie);
    expect((await build(h, "POST", "/claim")).status).toBe(204);
    expect(await publishState(h, card.id, card.cookie)).toMatchObject({ state: "failed", error: "changed" });
  });

  it("a failed build changes nothing that is live", async () => {
    const h = harness();
    await clearQueue();
    const a = await admin(h);
    const card = await previewedCard(h);
    await grant(h, a, card.id, { paid: true });
    await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    await build(h, "PUT", `/jobs/${job.id}/out/index.html`, html);
    expect((await build(h, "POST", `/jobs/${job.id}/fail`, { error: "missing files: gallery/1.webp" })).status).toBe(200);
    expect(await publishState(h, card.id, card.cookie)).toMatchObject({ state: "failed", error: "build_failed", url: null });
    expect(await env.MEDIA.head(`live/${job.slug}/${job.id}/index.html`)).toBeNull();
    expect((await env.DB.prepare("SELECT status FROM cards WHERE id = ?").bind(card.id).first<{ status: string }>())?.status).toBe("paid");
  });

  it("editing a live card shows 'changed'; publishing again replaces the files and keeps the address", async () => {
    const h = harness();
    await clearQueue();
    const a = await admin(h);
    const card = await previewedCard(h);
    await grant(h, a, card.id, { paid: true });
    await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie);
    const first = (await h.json(await build(h, "POST", "/claim"))).job;
    await finishJob(h, first.id, { "index.html": bytes("<p>one"), "old.txt": bytes("old") });

    const v = (await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, card.cookie))).card.version;
    expect((await h.call("PATCH", `/api/cards/${card.id}`, { baseVersion: v, patch: { couple: { hashtag: "#dua" } } }, card.cookie)).status).toBe(200);
    expect(await publishState(h, card.id, card.cookie)).toMatchObject({ state: "live", changed: true });
    expect(await (await asHost(h, `/${first.slug}/`)).text()).toContain("one");                         // still the old one until they publish again
    expect((await h.json(await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie))).error).toBe("preview_required");

    await h.call("POST", `/api/cards/${card.id}/preview`, {}, card.cookie);
    const pv = (await h.json(await build(h, "POST", "/claim"))).job;
    await finishJob(h, pv.id);
    expect((await h.call("POST", `/api/cards/${card.id}/publish`, {}, card.cookie)).status).toBe(202);
    const second = (await h.json(await build(h, "POST", "/claim"))).job;
    expect(second.slug).toBe(first.slug);
    await finishJob(h, second.id, { "index.html": bytes("<p>two") });
    expect(await publishState(h, card.id, card.cookie)).toMatchObject({ state: "live", changed: false });
    expect(await (await asHost(h, `/${first.slug}/`)).text()).toContain("two");
    expect(await env.MEDIA.head(`live/${first.slug}/${first.id}/old.txt`)).toBeNull();
  });

  it("the build server cannot publish a card that was never paid for", async () => {
    const h = harness();
    await clearQueue();
    const card = await previewedCard(h);
    await env.DB.prepare("INSERT INTO card_jobs (id, card_id, kind, draft_version, created_at) SELECT ?, id, 'publish', draft_version, ? FROM cards WHERE id = ?").bind(crypto.randomUUID(), h.clock.now, card.id).run();
    expect((await build(h, "POST", "/claim")).status).toBe(204);
    expect((await env.DB.prepare("SELECT error FROM card_jobs WHERE card_id = ? AND kind = 'publish'").bind(card.id).first<{ error: string }>())?.error).toBe("not_paid");
  });
});
