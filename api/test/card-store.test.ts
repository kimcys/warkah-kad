import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/lib/api.js";
import { createAutosaver, readValue, writeValue } from "../../src/lib/card-form.js";
import { BUILDER_STEPS } from "@warkah/card-kit";
import { harness, uniq } from "./helpers";

type H = ReturnType<typeof harness>;

function phone(h: H) {
  let cookie = "";
  const calls: string[] = [];
  const fetchShim = async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${url.replace("https://kad.test", "")}`);
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", h.ip);
    if (cookie) headers.set("Cookie", cookie);
    const res = await h.app.request(url, { ...init, headers }, env);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return res;
  };
  return { store: createApi({ base: "https://kad.test", fetch: fetchShim as unknown as typeof fetch }), calls };
}
async function signedIn(h: H) {
  const p = phone(h);
  const email = `cs-${uniq()}@example.com`;
  await p.store.emailCode.request(email);
  await p.store.emailCode.verify(email, h.sent[h.sent.length - 1].text.match(/\d{6}/)![0]);
  return p;
}
const field = (path: string) => BUILDER_STEPS.flatMap((s) => s.fields).find((f) => f.path === path)!;
const webp = (w: number, h: number) => { const b = new Uint8Array(64); b.set([...[..."RIFF"].map((c) => c.charCodeAt(0)), 40, 0, 0, 0, ...[..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 10, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0]); return new File([b], "a.webp", { type: "image/webp" }); };

describe("the card methods of the app's API client", () => {
  it("fetches the catalogue once and keeps it", async () => {
    const h = harness();
    const p = phone(h);
    const a = await p.store.loadCatalogue();
    const b = await p.store.loadCatalogue();
    expect(a).toBe(b);
    expect(p.calls.filter((c) => c === "GET /api/catalogue")).toHaveLength(1);
    expect(a.themes).toHaveLength(4);
  });

  it("creates, lists, reads, saves and checks an address", async () => {
    const h = harness();
    const { store } = await signedIn(h);
    const made = await store.createCard({ lang: "ms", theme: "lover" });
    expect(made.card.status).toBe("draft");
    expect((await store.listCards()).map((c: any) => c.id)).toEqual([made.card.id]);
    const saved = await store.saveCard(made.card.id, made.card.version, { venue: { name: "Dewan A" } });
    expect(saved.version).toBe(2);
    expect((await store.getCard(made.card.id)).draft.venue.name).toBe("Dewan A");
    expect((await store.checkCardSlug(made.card.id, "aisyah-hafiz")).ok).toBe(true);
    expect((await store.setCardSlug(made.card.id, `aisyah-${uniq()}`)).card.version).toBe(3);
  });

  it("a stale save throws an error that carries the current card", async () => {
    const h = harness();
    const { store } = await signedIn(h);
    const { card } = await store.createCard();
    await store.saveCard(card.id, 1, { venue: { name: "A" } });
    const err: any = await store.saveCard(card.id, 1, { venue: { name: "B" } }).catch((e: any) => e);
    expect(err.status).toBe(409);
    expect(err.code).toBe("stale");
    expect(err.body.card.version).toBe(2);
    expect(err.body.draft.venue.name).toBe("A");
  });

  it("uploads and deletes a file, and says where the owner can see it", async () => {
    const h = harness();
    const { store } = await signedIn(h);
    const { card } = await store.createCard();
    const up = await store.uploadCardAsset(card.id, "portrait", webp(800, 1000), "groom");
    expect(up.asset.path).toBe("portrait/groom.webp");
    expect(store.cardFileUrl(card.id, up.asset.path)).toBe(`https://kad.test/api/cards/${card.id}/files/portrait/groom.webp`);
    expect(store.cardFileUrl(card.id, "gallery/a b.webp")).toContain("gallery/a%20b.webp");
    await store.deleteCardAsset(card.id, up.asset.id);
    expect((await store.getCard(card.id)).assets).toEqual([]);
    const bad: any = await store.uploadCardAsset(card.id, "portrait", webp(100, 100), "groom").catch((e: any) => e);
    expect(bad.code).toBe("image_too_small");
  });

  it("is refused for someone else's card", async () => {
    const h = harness();
    const a = await signedIn(h), b = await signedIn(h);
    const { card } = await a.store.createCard();
    expect(((await b.store.getCard(card.id).catch((e: any) => e)) as any).status).toBe(404);
  });
});

describe("the form and the autosaver against the real API", () => {
  it("what a customer types is saved after the pause, and the server's status follows", async () => {
    const h = harness();
    const { store } = await signedIn(h);
    let card = (await store.createCard({ theme: "lover" })).card;
    let version = card.version;
    let status: any = null;
    const saver = createAutosaver({
      save: (patch: any, v: number) => store.saveCard(card.id, v, patch),
      getVersion: () => version,
      onSaved: (r: any) => { version = r.version; status = r.status; },
      onStale: (b: any) => { if (b?.card) version = b.card.version; },
      delay: 5
    });
    let draft: any = {};
    for (const [path, value] of [["couple.groom.name", "Muhammad Hafiz"], ["couple.groom.parentsHtml", "Hj. Rahman bin Ismail\n& Hjh. Zainab binti Omar"], ["date.start", { date: "2027-03-20", time: "11:00" }]] as const) {
      const patch = writeValue(draft, field(path), value);
      saver.change(patch);
    }
    expect(await saver.flush()).toBe("saved");
    const server = await store.getCard(card.id);
    expect(server.draft.couple.groom.name).toBe("Muhammad Hafiz");
    expect(server.draft.couple.groom.parentsHtml).toBe("Hj. Rahman bin Ismail<br>&amp; Hjh. Zainab binti Omar");
    expect(server.draft.date).toEqual({ start: "2027-03-20T11:00:00+08:00", end: "2027-03-20T16:00:00+08:00" });
    expect(readValue(server.draft, field("couple.groom.parentsHtml"))).toBe("Hj. Rahman bin Ismail\n& Hjh. Zainab binti Omar");
    expect(readValue(server.draft, field("date.end"))).toEqual({ date: "2027-03-20", time: "16:00" });
    expect(status.missing.some((m: any) => m.path === "couple.groom.name")).toBe(false);
    expect(status.missing.some((m: any) => m.path === "couple.bride.name")).toBe(true);
  });

  it("two tabs of the same card: both edits survive (different fields, the stale one rebases)", async () => {
    const h = harness();
    const one = await signedIn(h);
    const { card } = await one.store.createCard();
    // a second tab on the same sign-in is the same store with its own saver and its own idea of the version
    const mk = () => { let v = card.version; return { saver: createAutosaver({ save: (p: any, ver: number) => one.store.saveCard(card.id, ver, p), getVersion: () => v, onSaved: (r: any) => { v = r.version; }, onStale: (b: any) => { if (b?.card) v = b.card.version; }, delay: 1 }) }; };
    const tabA = mk(), tabB = mk();
    tabA.saver.change({ venue: { name: "Dewan A" } });
    await tabA.saver.flush();
    tabB.saver.change({ couple: { hashtag: "#AisyahHafiz" } });       // tab B still believes the card is at version 1
    expect(await tabB.saver.flush()).toBe("saved");
    const { draft } = await one.store.getCard(card.id);
    expect(draft.venue.name).toBe("Dewan A");
    expect(draft.couple.hashtag).toBe("#AisyahHafiz");
  });

  it("a switch outside the package is refused and not retried", async () => {
    const h = harness();
    const { store } = await signedIn(h);
    const { card } = await store.createCard();
    let tries = 0;
    const saver = createAutosaver({ save: (p: any, v: number) => (tries++, store.saveCard(card.id, v, p)), getVersion: () => card.version, delay: 1 });
    saver.change({ features: { gifts: true } });
    expect(await saver.flush()).toBe("refused");
    expect(tries).toBe(1);
  });
});
