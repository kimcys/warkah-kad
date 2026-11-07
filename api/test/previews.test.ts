import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/lib/cleanup";
import { harness, uniq } from "./helpers";

import { SECRET, bytes, build, buildEnv, finishJob, html, readyCard, serveAs, state, webp, type H } from "./build-helpers";

describe("preview: asking for one", () => {
  it("needs sign-in, a card of your own, and a complete card", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/cards/x/preview", {})).status).toBe(401);
    const a = await readyCard(h);
    const b = `p2-${uniq()}@example.com`;
    const other = await h.signIn(b);
    expect((await h.call("POST", `/api/cards/${a.id}/preview`, {}, other)).status).toBe(404);
    const made = await h.json(await h.call("POST", "/api/cards", { theme: "lover" }, other));
    const res = await h.call("POST", `/api/cards/${made.card.id}/preview`, {}, other);
    expect(res.status).toBe(409);
    const body = await h.json(res);
    expect(body.error).toBe("not_ready");
    expect(body.status.missing.length).toBeGreaterThan(0);
  });

  it("queues one build, with a link that is known at once, and does not queue a second while one waits", async () => {
    const h = harness();
    const { id, cookie } = await readyCard(h);
    expect((await state(h, id, cookie)).state).toBe("none");
    const first = await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    expect(first.status).toBe(202);
    const a = await h.json(first);
    expect(a).toMatchObject({ state: "queued", url: null, builtVersion: null });
    const again = await h.json(await h.call("POST", `/api/cards/${id}/preview`, {}, cookie));
    expect(again.state).toBe("queued");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM card_jobs WHERE card_id = ?").bind(id).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT preview_token FROM cards WHERE id = ?").bind(id).first<{ preview_token: string }>())?.preview_token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("is limited to 20 a hour per card", async () => {
    const h = harness();
    const { id, cookie } = await readyCard(h);
    let last = 202;
    for (let i = 0; i < 22; i++) { last = (await h.call("POST", `/api/cards/${id}/preview`, {}, cookie)).status; await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE card_id = ?").bind(id).run(); }
    expect(last).toBe(429);
  });
});

describe("the build server's side", () => {
  it("is closed without the secret, and closed for good when none is configured", async () => {
    const h = harness();
    expect((await h.app.request("https://kad.test/api/build/claim", { method: "POST" }, buildEnv)).status).toBe(401);
    expect((await h.app.request("https://kad.test/api/build/claim", { method: "POST", headers: { Authorization: "Bearer nope" } }, buildEnv)).status).toBe(401);
    expect((await h.app.request("https://kad.test/api/build/claim", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } }, env)).status).toBe(503);
    expect((await h.app.request("https://kad.test/api/build/claim", { method: "POST" }, env)).status).toBe(503);
  });

  it("hands out nothing when the queue is empty", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    expect((await build(h, "POST", "/claim")).status).toBe(204);
  });

  it("claims a job with the draft, the tier, the files and a token; one job goes to one build server", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const res = await build(h, "POST", "/claim");
    expect(res.status).toBe(200);
    const job = await h.json(res);
    expect(job.job).toMatchObject({ tier: "basic", lang: "ms", draftVersion: expect.any(Number) });
    expect(job.job.token).toMatch(/^[a-f0-9]{32}$/);
    expect(job.draft.theme).toBe("lover");
    expect(job.draft.couple.groom.name).toBe("Muhammad Farid");
    expect(job.assets.map((a: any) => a.path).sort()).toEqual(["cover/og-preview.jpg", "gallery/1.webp", "portrait/bride.webp", "portrait/groom.webp"]);
    expect((await state(h, id, cookie)).state).toBe("building");
    expect((await build(h, "POST", "/claim")).status).toBe(204);
    const file = await build(h, "GET", `/jobs/${job.job.id}/files/portrait/groom.webp`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect((await build(h, "GET", `/jobs/${job.job.id}/files/portrait/none.webp`)).status).toBe(404);
  });

  it("a finished build makes the preview ready for the version it was built from, and serves it", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    // nothing is served before it is done
    expect((await serveAs(h, `/p/${job.token}/`)).status).toBe(404);
    const done = await finishJob(h, job.id, { "index.html": html, "_astro/a.css": "body{}", "event/gallery/1.webp": new Uint8Array(await webp(10, 10).arrayBuffer()) });
    expect(done.status).toBe(200);
    const s = await state(h, id, cookie);
    expect(s).toMatchObject({ state: "ready", stale: false, url: `/p/${job.token}/`, builtVersion: job.draftVersion });
    expect(s.expiresAt).toBe(h.clock.now + 7 * 86_400_000);

    const page = await serveAs(h, `/p/${job.token}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("hello");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("content-security-policy")).toContain("sandbox");
    expect((await serveAs(h, `/p/${job.token}/_astro/a.css`)).headers.get("content-type")).toContain("text/css");
    expect((await serveAs(h, `/p/${job.token}/missing.js`)).status).toBe(404);
    expect((await serveAs(h, `/p/${job.token}/%2e%2e/x`)).status).toBe(404);
    expect((await serveAs(h, `/p/${job.token}/a%2F..%2Fb`)).status).toBe(404);
    expect((await serveAs(h, `/p/${"0".repeat(32)}/`)).status).toBe(404);
    expect((await serveAs(h, `/p/${job.token}`)).status).toBe(301);
  });

  it("the preview goes stale when the card changes afterwards, and a rebuild keeps the same link", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const first = (await h.json(await build(h, "POST", "/claim"))).job;
    await finishJob(h, first.id, { "index.html": html, "old.txt": "old" });
    const v = (await h.json(await h.call("GET", `/api/cards/${id}`, undefined, cookie))).card.version;
    await h.call("PATCH", `/api/cards/${id}`, { baseVersion: v, patch: { couple: { hashtag: "#DinaFarid" } } }, cookie);
    expect((await state(h, id, cookie)).stale).toBe(true);

    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    expect((await state(h, id, cookie)).state).toBe("queued");
    expect((await state(h, id, cookie)).url).toBe(`/p/${first.token}/`);         // the old preview still works while the new one builds
    expect((await serveAs(h, `/p/${first.token}/`)).status).toBe(200);
    const second = (await h.json(await build(h, "POST", "/claim"))).job;
    expect(second.token).toBe(first.token);
    expect(second.draftVersion).toBe(v + 1);
    await finishJob(h, second.id, { "index.html": bytes("<p>second") });
    const s = await state(h, id, cookie);
    expect(s).toMatchObject({ state: "ready", stale: false, builtVersion: v + 1 });
    expect(await (await serveAs(h, `/p/${first.token}/`)).text()).toContain("second");
    expect(await env.MEDIA.head(`previews/${first.token}/${first.id}/old.txt`)).toBeNull();      // the earlier build's files are gone
  });

  it("refuses a build that has no index.html, and files from outside the card", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    expect((await build(h, "POST", `/jobs/${job.id}/done`, { files: [] })).status).toBe(409);
    expect((await build(h, "PUT", `/jobs/${job.id}/out/../../x`, "x")).status).toBeGreaterThanOrEqual(400);
    expect((await build(h, "PUT", `/jobs/${job.id}/out/a b.html`, "x")).status).toBe(400);
    expect((await build(h, "PUT", `/jobs/${job.id}/out/a%2F..%2Fb.html`, "x")).status).toBe(400);
    expect((await build(h, "PUT", `/jobs/nope/out/index.html`, "x")).status).toBe(404);
  });

  it("a failed build is reported to the customer in one word, and can be tried again", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    expect((await build(h, "POST", `/jobs/${job.id}/fail`, { error: "x".repeat(900) })).status).toBe(200);
    expect(await state(h, id, cookie)).toMatchObject({ state: "failed", error: "build_failed", url: null });
    expect((await env.DB.prepare("SELECT length(error) AS n FROM card_jobs WHERE id = ?").bind(job.id).first<{ n: number }>())?.n).toBe(300);
    expect((await build(h, "POST", `/jobs/${job.id}/done`, { files: [] })).status).toBe(404);    // a finished job cannot be worked on again
    expect((await h.call("POST", `/api/cards/${id}/preview`, {}, cookie)).status).toBe(202);
    expect((await state(h, id, cookie)).state).toBe("queued");
  });

  it("a build that went quiet is offered again, and given up on after three tries", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const first = (await h.json(await build(h, "POST", "/claim"))).job;
    h.clock.now += 6 * 60_000;
    const second = (await h.json(await build(h, "POST", "/claim"))).job;
    expect(second.id).toBe(first.id);
    h.clock.now += 6 * 60_000;
    expect((await h.json(await build(h, "POST", "/claim"))).job.id).toBe(first.id);
    h.clock.now += 6 * 60_000;
    expect((await build(h, "POST", "/claim")).status).toBe(204);
    expect(await state(h, id, cookie)).toMatchObject({ state: "failed" });
  });
});

describe("previews expire", () => {
  it("after seven days the link stops working, the files go, and the card can be previewed again", async () => {
    const h = harness();
    await env.DB.prepare("UPDATE card_jobs SET state = 'ready' WHERE state IN ('queued', 'building')").run();
    const { id, cookie } = await readyCard(h);
    await h.call("POST", `/api/cards/${id}/preview`, {}, cookie);
    const { job } = await h.json(await build(h, "POST", "/claim"));
    await finishJob(h, job.id);
    h.clock.now += 8 * 86_400_000;
    expect((await serveAs(h, `/p/${job.token}/`)).status).toBe(404);
    expect((await state(h, id, cookie)).state).toBe("none");
    await cleanup(env, h.clock.now);
    expect(await env.MEDIA.head(`previews/${job.token}/${job.id}/index.html`)).toBeNull();
    expect((await env.DB.prepare("SELECT preview_job, preview_version FROM cards WHERE id = ?").bind(id).first())).toEqual({ preview_job: null, preview_version: null });
  });
});
