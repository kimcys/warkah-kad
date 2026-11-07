import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/lib/cleanup";
import { harness, uniq } from "./helpers";

type H = ReturnType<typeof harness>;

// ---------- files with real headers (the server reads the type and size from the first bytes, never from the name)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (bytes: number[], size = 64) => { const b = new Uint8Array(Math.max(size, bytes.length + 8)); b.set(bytes); return b; };
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes], name, { type });
const pngFile = (w: number, h: number, size = 64) => file(pad([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h)], size), "a.png", "image/png");
const jpegFile = (w: number, h: number) => file(pad([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 64), "a.jpg", "image/jpeg");
const webpFile = (w: number, h: number, flags = 0, size = 64) => file(pad([...ascii("RIFF"), ...be32(40), ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, flags, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)], size), "a.webp", "image/webp");
const m4aFile = () => file(pad([0, 0, 0, 0x20, ...ascii("ftypM4A ")], 64), "a.m4a", "audio/mp4");
const mp3File = () => file(pad([...ascii("ID3"), 3, 0, 0, 0, 0, 0, 0], 64), "a.mp3", "audio/mpeg");

async function signedIn(h: H, tag = "c") {
  const email = `${tag}-${uniq()}@example.com`;
  return { email, cookie: await h.signIn(email) };
}
async function admin(h: H) {
  const a = await signedIn(h, "admin");
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE email = ?").bind(a.email).run();
  return a;
}
async function newCard(h: H, cookie: string, body: object = {}) {
  const res = await h.call("POST", "/api/cards", body, cookie);
  expect(res.status).toBe(201);
  return h.json(res);
}
const patch = (h: H, cookie: string, id: string, baseVersion: number, p: object) => h.call("PATCH", `/api/cards/${id}`, { baseVersion, patch: p }, cookie);
const up = (h: H, cookie: string, id: string, kind: string, f: File, slot?: string) => h.upload(`/api/cards/${id}/assets`, { kind, ...(slot ? { slot } : {}) }, f, cookie);

describe("the catalogue", () => {
  it("is public and cached, and says which kit it came from", async () => {
    const h = harness();
    const res = await h.call("GET", "/api/catalogue");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const body = await h.json(res);
    expect(body.kitVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(body.themes).toHaveLength(4);
    expect(body.steps).toHaveLength(6);
    expect(body.cardDomain).toBe("kad.aimanhakimcy.com");
  });
});

describe("cards: creating and reading", () => {
  it("requires sign-in everywhere", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/cards", {})).status).toBe(401);
    expect((await h.call("GET", "/api/cards")).status).toBe(401);
    expect((await h.call("GET", "/api/cards/x")).status).toBe(401);
    expect((await h.call("PATCH", "/api/cards/x", { baseVersion: 1, patch: {} })).status).toBe(401);
  });

  it("starts a draft: basic tier, draft status, a temporary valid address, nothing filled in", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card, draft, status, allowed, assets } = await newCard(h, cookie);
    expect(card).toMatchObject({ status: "draft", tier: "basic", lang: "ms", version: 1, ready: false, theme: null });
    expect(card.slug).toMatch(/^kad-[a-z0-9]{6}$/);
    expect(draft).toEqual({ lang: "ms" });
    expect(status.ready).toBe(false);
    expect(status.missing.length).toBeGreaterThan(10);
    expect(status.missing[0].step).toBe("pasangan");
    expect(allowed.features.gifts).toBe(false);
    expect(allowed.features.mempelai).toBe(true);
    expect(assets).toEqual([]);
  });

  it("takes a language and a theme at the start, and refuses nonsense", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card, draft } = await newCard(h, cookie, { lang: "en", theme: "lover" });
    expect(card.lang).toBe("en");
    expect(card.theme).toBe("lover");
    expect(draft).toEqual({ lang: "en", theme: "lover" });
    for (const bad of [{ theme: "disco" }, { lang: "fr" }, { tier: "full" }, { status: "live" }]) {
      expect((await h.call("POST", "/api/cards", bad, cookie)).status).toBe(400);
    }
  });

  it("allows three cards per customer, and not a fourth", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    for (let i = 0; i < 3; i++) await newCard(h, cookie);
    const fourth = await h.call("POST", "/api/cards", {}, cookie);
    expect(fourth.status).toBe(403);
    expect((await h.json(fourth)).error).toBe("card_limit");
    const other = await signedIn(h);
    await newCard(h, other.cookie);
  });

  it("lists only the customer's own cards", async () => {
    const h = harness();
    const a = await signedIn(h, "a"), b = await signedIn(h, "b");
    const one = await newCard(h, a.cookie), two = await newCard(h, b.cookie);
    const mine = (await h.json(await h.call("GET", "/api/cards", undefined, a.cookie))).cards;
    expect(mine.map((c: any) => c.id)).toEqual([one.card.id]);
    expect(mine.map((c: any) => c.id)).not.toContain(two.card.id);
  });

  it("answers 404 to anyone else, for every route", async () => {
    const h = harness();
    const a = await signedIn(h, "a"), b = await signedIn(h, "b");
    const { card } = await newCard(h, a.cookie);
    const id = card.id;
    for (const [method, path, body] of [["GET", `/api/cards/${id}`], ["PATCH", `/api/cards/${id}`, { baseVersion: 1, patch: {} }], ["GET", `/api/cards/${id}/slug?value=abc-def`], ["PUT", `/api/cards/${id}/slug`, { slug: "abc-def" }],
      ["DELETE", `/api/cards/${id}/assets/x`], ["GET", `/api/cards/${id}/files/a.webp`], ["GET", `/api/cards/${id}/preview`], ["POST", `/api/cards/${id}/preview`], ["POST", `/api/cards/${id}/publish`]] as const) {
      expect((await h.call(method, path, body, b.cookie)).status, `${method} ${path}`).toBe(404);
    }
    const upload = await up(h, b.cookie, id, "cover", jpegFile(720, 1280));
    expect(upload.status).toBe(404);
  });

  it("lets an admin read a customer's card", async () => {
    const h = harness();
    const a = await signedIn(h), staff = await admin(h);
    const { card } = await newCard(h, a.cookie);
    expect((await h.call("GET", `/api/cards/${card.id}`, undefined, staff.cookie)).status).toBe(200);
  });
});

describe("cards: saving the draft", () => {
  it("merges the patch, keeps what was not mentioned, and bumps the version", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const first = await h.json(await patch(h, cookie, card.id, 1, { theme: "lover", couple: { groom: { name: "Ali", short: "Ali" } } }));
    expect(first.version).toBe(2);
    const second = await h.json(await patch(h, cookie, card.id, 2, { couple: { bride: { name: "Aisyah" }, first: "bride" } }));
    expect(second.version).toBe(3);
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.theme).toBe("lover");
    expect(draft.couple.groom).toEqual({ name: "Ali", short: "Ali" });
    expect(draft.couple.bride.name).toBe("Aisyah");
    expect(second.card.names).toBe("Aisyah & Ali");
  });

  it("removes a key with null and replaces a list as a whole", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie, { theme: "lover" });
    await patch(h, cookie, card.id, 1, { aturcara: [{ icon: "jam", label: "A", time: "1" }, { icon: "jam", label: "B", time: "2" }] });
    await patch(h, cookie, card.id, 2, { aturcara: [{ icon: "makan", label: "C", time: "3" }], theme: null });
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.aturcara).toEqual([{ icon: "makan", label: "C", time: "3" }]);
    expect(draft.theme).toBeUndefined();
  });

  it("tells a stale browser, with the current draft, and does not overwrite", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    await patch(h, cookie, card.id, 1, { venue: { name: "Dewan A" } });
    const stale = await patch(h, cookie, card.id, 1, { venue: { name: "Dewan B" } });
    expect(stale.status).toBe(409);
    const body = await h.json(stale);
    expect(body.error).toBe("stale");
    expect(body.card.version).toBe(2);
    expect(body.draft.venue.name).toBe("Dewan A");
  });

  it("two saves at the same version: exactly one wins", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const results = await Promise.all([patch(h, cookie, card.id, 1, { venue: { name: "X" } }), patch(h, cookie, card.id, 1, { venue: { name: "Y" } })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("refuses parts of the draft that belong to the system, and bad values for the few that are checked", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    for (const bad of [{ hosting: { domain: "evil.com" } }, { meta: { title: "x" } }, { store: { mode: "demo" } }, { package: "custom" }, { tier: "full" }, { status: "live" }, { portraits: { groom: "x" } }, { preview: true }, { theme: "disco" }, { lang: "fr" }]) {
      expect((await patch(h, cookie, card.id, 1, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // nothing was saved
    expect((await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie))).card.version).toBe(1);
  });

  it("only accepts canonical paths for uploaded files", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    for (const bad of [{ gallery: [{ src: "../../x.webp", width: 1, height: 1, alt: "" }] }, { gallery: [{ src: "https://evil.com/a.webp" }] }, { gallery: ["x"] }, { music: { src: "audio/../x.mp3" } }, { music: { type: "text/html" } },
      { music: { fallback: { src: "x" } } }, { duitnow: { image: "http://evil.com/q.png" } }]) {
      const res = await patch(h, cookie, card.id, 1, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await patch(h, cookie, card.id, 1, { gallery: [{ src: "gallery/1.webp", width: 10, height: 10, alt: "a" }], duitnow: { image: "duitnow/qr.png" }, music: { src: "audio/song.m4a", type: "audio/mp4", title: "t", artist: "a" } })).status).toBe(200);
  });

  it("cleans what is written: control characters, long text, and any markup in the HTML fields", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const res = await h.json(await patch(h, cookie, card.id, 1, { couple: { groom: { name: "  Ali\u0000  ", parentsHtml: "Hj. A<br><script>alert(1)</script>& B" } }, venue: { name: "x".repeat(3000) } }));
    expect(res.changes.some((c: any) => c.path === "couple.groom.parentsHtml")).toBe(true);
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.couple.groom.name).toBe("Ali");
    expect(draft.couple.groom.parentsHtml).not.toMatch(/<script/);
    expect(draft.couple.groom.parentsHtml).toContain("<br>");
    expect(draft.venue.name).toHaveLength(2000);
  });

  it("refuses a draft that is too big", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const contacts = Array.from({ length: 200 }, (_, i) => ({ name: "n".repeat(900), role: "r", phone: String(i) }));
    expect((await patch(h, cookie, card.id, 1, { contacts })).status).toBe(413);
  });

  it("reports what is wrong in Malay, with the field, without refusing the save", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const res = await h.json(await patch(h, cookie, card.id, 1, { venue: { maps: "https://example.com/x" } }));
    const problem = res.status.problems.find((p: any) => p.path === "venue.maps");
    expect(problem.message).toMatch(/Google Maps/);
  });

  it("follows the language when it is changed", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const res = await h.json(await patch(h, cookie, card.id, 1, { lang: "en" }));
    expect(res.card.lang).toBe("en");
    expect((await env.DB.prepare("SELECT lang FROM cards WHERE id = ?").bind(card.id).first<{ lang: string }>())?.lang).toBe("en");
  });

  it("stops saving past 120 a minute", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    let v = 1, last = 200;
    for (let i = 0; i < 122 && last !== 429; i++) {
      const r = await patch(h, cookie, card.id, v, { venue: { name: `n${i}` } });
      last = r.status;
      if (r.status === 200) v++;
    }
    expect(last).toBe(429);
  });

  it("a live card can still be edited (the live version changes only when it is published again); an archived one is gone", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    await env.DB.prepare("UPDATE cards SET status = 'live' WHERE id = ?").bind(card.id).run();
    expect((await patch(h, cookie, card.id, 1, { venue: { name: "x" } })).status).toBe(200);
    await env.DB.prepare("UPDATE cards SET status = 'archived' WHERE id = ?").bind(card.id).run();
    expect((await h.call("GET", `/api/cards/${card.id}`, undefined, cookie)).status).toBe(404);
  });
});

describe("cards: the package (tier)", () => {
  it("refuses a switch the package does not include, and explains which", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const res = await patch(h, cookie, card.id, 1, { features: { gifts: true, ayat: true, rsvp: true } });
    expect(res.status).toBe(403);
    const body = await h.json(res);
    expect(body.error).toBe("not_in_tier");
    expect(body.features.sort()).toEqual(["ayat", "gifts"]);
    expect((await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie))).card.version).toBe(1);
  });

  it("never offers Kenang, whatever the package", async () => {
    const h = harness();
    const customer = await signedIn(h), staff = await admin(h);
    const { card } = await newCard(h, customer.cookie);
    await h.call("PATCH", `/api/admin/cards/${card.id}`, { tier: "custom" }, staff.cookie);
    const res = await patch(h, customer.cookie, card.id, 1, { features: { kenang: true } });
    expect(res.status).toBe(403);
    expect((await h.json(res)).error).toBe("not_offered");
  });

  it("lets the customer use the add-ons once an admin sets the package", async () => {
    const h = harness();
    const customer = await signedIn(h), staff = await admin(h);
    const { card } = await newCard(h, customer.cookie);
    const set = await h.call("PATCH", `/api/admin/cards/${card.id}`, { tier: "full" }, staff.cookie);
    expect(set.status).toBe(200);
    expect((await h.json(set)).card.tier).toBe("full");
    const res = await patch(h, customer.cookie, card.id, 1, { features: { gifts: true, ayat: true } });
    expect(res.status).toBe(200);
    expect((await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, customer.cookie))).allowed.features.gifts).toBe(true);
  });

  it("is the admin's to change, and only to a real package", async () => {
    const h = harness();
    const customer = await signedIn(h), staff = await admin(h);
    const { card } = await newCard(h, customer.cookie);
    expect((await h.call("PATCH", `/api/admin/cards/${card.id}`, { tier: "full" }, customer.cookie)).status).toBe(403);
    expect((await h.call("PATCH", `/api/admin/cards/${card.id}`, { tier: "gold" }, staff.cookie)).status).toBe(400);
    expect((await h.call("PATCH", `/api/admin/cards/nope`, { tier: "full" }, staff.cookie)).status).toBe(404);
    expect((await h.call("GET", "/api/admin/cards", undefined, customer.cookie)).status).toBe(403);
  });

  it("lets an admin find a card by the owner's email or the address", async () => {
    const h = harness();
    const customer = await signedIn(h, "findme"), staff = await admin(h);
    const { card } = await newCard(h, customer.cookie);
    const byEmail = await h.json(await h.call("GET", `/api/admin/cards?q=${encodeURIComponent(customer.email)}`, undefined, staff.cookie));
    expect(byEmail.cards.map((c: any) => c.id)).toContain(card.id);
    expect(byEmail.cards[0].ownerEmail).toBe(customer.email);
    const bySlug = await h.json(await h.call("GET", `/api/admin/cards?q=${card.slug}`, undefined, staff.cookie));
    expect(bySlug.cards.map((c: any) => c.id)).toContain(card.id);
    expect(byEmail.tiers.map((t: any) => t.id)).toEqual(["basic", "full", "custom"]);
  });
});

describe("cards: the address", () => {
  it("checks an address: format, reserved words, taken by another card", async () => {
    const h = harness();
    const a = await signedIn(h, "a"), b = await signedIn(h, "b");
    const mine = await newCard(h, a.cookie), theirs = await newCard(h, b.cookie);
    const check = async (value: string) => h.json(await h.call("GET", `/api/cards/${mine.card.id}/slug?value=${encodeURIComponent(value)}`, undefined, a.cookie));
    expect((await check("aisyah-hafiz")).ok).toBe(true);
    expect((await check("ab")).ok).toBe(false);
    expect((await check("admin")).problem).toMatch(/dikhaskan/);
    expect((await check(theirs.card.slug)).problem).toMatch(/sudah digunakan/);
  });

  it("sets the address while it is a draft, and refuses a taken or reserved one", async () => {
    const h = harness();
    const a = await signedIn(h, "a"), b = await signedIn(h, "b");
    const mine = await newCard(h, a.cookie), theirs = await newCard(h, b.cookie);
    const slug = `ali-aisyah-${uniq()}`;
    const ok = await h.call("PUT", `/api/cards/${mine.card.id}/slug`, { slug: slug.toUpperCase() }, a.cookie);
    expect(ok.status).toBe(200);
    const body = await h.json(ok);
    expect(body.card.slug).toBe(slug);
    expect(body.card.version).toBe(2);
    expect((await h.call("PUT", `/api/cards/${mine.card.id}/slug`, { slug: "studio" }, a.cookie)).status).toBe(400);
    expect((await h.call("PUT", `/api/cards/${mine.card.id}/slug`, { slug: theirs.card.slug }, a.cookie)).status).toBe(409);
    await env.DB.prepare("UPDATE cards SET status = 'paid' WHERE id = ?").bind(mine.card.id).run();
    expect((await h.call("PUT", `/api/cards/${mine.card.id}/slug`, { slug: `again-${uniq()}` }, a.cookie)).status).toBe(200);     // paid, not yet live: still theirs to choose
    await env.DB.prepare("UPDATE cards SET status = 'live' WHERE id = ?").bind(mine.card.id).run();
    expect((await h.call("PUT", `/api/cards/${mine.card.id}/slug`, { slug: `again-${uniq()}` }, a.cookie)).status).toBe(409);      // live: the address is out in the world
  });
});

describe("cards: uploads", () => {
  it("takes a cover, records where it sits and what the card now says", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const res = await up(h, cookie, card.id, "cover", jpegFile(720, 1280));
    expect(res.status).toBe(201);
    const body = await h.json(res);
    expect(body.asset).toMatchObject({ kind: "cover", path: "cover/og-preview.jpg", width: 720, height: 1280, contentType: "image/jpeg" });
    expect(typeof body.asset.createdAt).toBe("number");
    expect(body.version).toBe(2);
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.meta).toEqual({ ogImage: "cover/og-preview.jpg", ogWidth: 720, ogHeight: 1280 });
    expect(await env.MEDIA.get(`cards/${card.id}/cover/og-preview.jpg`)).not.toBeNull();
    expect(body.status.missing.some((m: any) => m.path === "meta.ogImage")).toBe(false);
  });

  it("takes portraits for each person, and a new one replaces the old, even in another format", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    expect((await up(h, cookie, card.id, "portrait", webpFile(800, 1000), "groom")).status).toBe(201);
    expect((await up(h, cookie, card.id, "portrait", webpFile(800, 1000), "bride")).status).toBe(201);
    expect((await up(h, cookie, card.id, "portrait", pngFile(900, 1100), "groom")).status).toBe(201);
    const { assets, draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(assets.map((a: any) => a.path).sort()).toEqual(["portrait/bride.webp", "portrait/groom.png"]);
    expect(draft.portraits).toEqual({ groom: "portrait/groom.png", bride: "portrait/bride.webp" });
    expect(await env.MEDIA.get(`cards/${card.id}/portrait/groom.webp`)).toBeNull();
    expect((await up(h, cookie, card.id, "portrait", webpFile(800, 1000))).status).toBe(400);
    expect((await up(h, cookie, card.id, "portrait", webpFile(800, 1000), "cat")).status).toBe(400);
  });

  it("adds gallery photos one after another with their size, and stops at the limit", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    for (let i = 1; i <= 12; i++) {
      const res = await up(h, cookie, card.id, "gallery", webpFile(1200 + i, 800));
      expect(res.status, `photo ${i}`).toBe(201);
      expect((await h.json(res)).asset.path).toBe(`gallery/${i}.webp`);
    }
    const over = await up(h, cookie, card.id, "gallery", webpFile(1200, 800));
    expect(over.status).toBe(409);
    expect((await h.json(over)).error).toBe("too_many");
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.gallery).toHaveLength(12);
    expect(draft.gallery[0]).toEqual({ src: "gallery/1.webp", width: 1201, height: 800, alt: "Gambar 1" });
  });

  it("reuses a gallery number once a photo is deleted", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await h.json(await up(h, cookie, card.id, "gallery", webpFile(1200, 800)))).asset.id);
    const del = await h.call("DELETE", `/api/cards/${card.id}/assets/${ids[1]}`, undefined, cookie);
    expect(del.status).toBe(200);
    const again = await h.json(await up(h, cookie, card.id, "gallery", webpFile(1000, 700)));
    expect(again.asset.path).toBe("gallery/2.webp");
    const { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.gallery.map((g: any) => g.src)).toEqual(["gallery/1.webp", "gallery/3.webp", "gallery/2.webp"]);
  });

  it("checks size, type and shape: too small, too large, animated, not an image, too heavy", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const status = async (kind: string, f: File, slot?: string) => (await up(h, cookie, card.id, kind, f, slot)).status;
    expect(await status("portrait", webpFile(300, 400), "groom")).toBe(422);          // smaller than 800 on its long edge
    expect(await status("portrait", webpFile(3000, 2000), "groom")).toBe(422);        // larger than 1400
    expect(await status("gallery", webpFile(1200, 800, 0x02))).toBe(415);             // animated
    expect(await status("gallery", file(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "a.png", "image/png"))).toBe(415);
    expect(await status("gallery", file(new TextEncoder().encode("<?php echo 1; ?>"), "a.jpg", "image/jpeg"))).toBe(415);
    expect(await status("cover", pngFile(720, 1280))).toBe(415);                      // the cover must be a jpeg
    expect(await status("gift", jpegFile(400, 400), "g1")).toBe(415);                 // gift photos are webp (the card looks for gifts/<id>.webp)
    expect(await status("gallery", webpFile(1200, 800, 0, 400_000))).toBe(413);       // over 300 KB
    expect(await status("gallery", file(new Uint8Array(0), "a.webp", "image/webp"))).toBe(400);
    expect((await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie))).assets).toEqual([]);   // nothing was stored
  });

  it("refuses an unknown kind, a missing file, or a body that is not a form", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    expect((await up(h, cookie, card.id, "avatar", webpFile(800, 800))).status).toBe(400);
    expect((await h.upload(`/api/cards/${card.id}/assets`, { kind: "gallery" }, null, cookie)).status).toBe(400);
    expect((await h.call("POST", `/api/cards/${card.id}/assets`, { kind: "gallery" }, cookie)).status).toBe(400);
  });

  it("takes gift photos (webp only, named by the gift), the DuitNow QR and the song", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const gift = await h.json(await up(h, cookie, card.id, "gift", webpFile(400, 400), "g1"));
    expect(gift.asset.path).toBe("gifts/g1.webp");
    expect((await up(h, cookie, card.id, "gift", webpFile(400, 400))).status).toBe(400);
    expect((await up(h, cookie, card.id, "gift", webpFile(400, 400), "../x")).status).toBe(400);
    const qr = await h.json(await up(h, cookie, card.id, "qr", pngFile(600, 600)));
    expect(qr.asset.path).toBe("duitnow/qr.png");
    const song = await h.json(await up(h, cookie, card.id, "music", m4aFile()));
    expect(song.asset.path).toBe("audio/song.m4a");
    let { draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.duitnow.image).toBe("duitnow/qr.png");
    expect(draft.music).toEqual({ src: "audio/song.m4a", type: "audio/mp4" });
    // a new song in another format replaces the first
    await up(h, cookie, card.id, "music", mp3File());
    ({ draft } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie)));
    expect(draft.music).toEqual({ src: "audio/song.mp3", type: "audio/mpeg" });
    expect(await env.MEDIA.get(`cards/${card.id}/audio/song.m4a`)).toBeNull();
  });

  it("deletes a file together with the card's reference to it", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const cover = await h.json(await up(h, cookie, card.id, "cover", jpegFile(720, 1280)));
    const res = await h.call("DELETE", `/api/cards/${card.id}/assets/${cover.asset.id}`, undefined, cookie);
    expect(res.status).toBe(200);
    expect((await h.json(res)).status.missing.some((m: any) => m.path === "meta.ogImage")).toBe(true);
    expect(await env.MEDIA.get(`cards/${card.id}/cover/og-preview.jpg`)).toBeNull();
    const { draft, assets } = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(draft.meta).toBeUndefined();
    expect(assets).toEqual([]);
    expect((await h.call("DELETE", `/api/cards/${card.id}/assets/${cover.asset.id}`, undefined, cookie)).status).toBe(404);
  });

  it("will not delete another card's file, even with its id", async () => {
    const h = harness();
    const a = await signedIn(h, "a");
    const one = await newCard(h, a.cookie), two = await newCard(h, a.cookie);
    const cover = await h.json(await up(h, a.cookie, one.card.id, "cover", jpegFile(720, 1280)));
    expect((await h.call("DELETE", `/api/cards/${two.card.id}/assets/${cover.asset.id}`, undefined, a.cookie)).status).toBe(404);
    expect(await env.MEDIA.get(`cards/${one.card.id}/cover/og-preview.jpg`)).not.toBeNull();
  });

  it("serves a file to its owner only, privately", async () => {
    const h = harness();
    const a = await signedIn(h, "a"), b = await signedIn(h, "b");
    const { card } = await newCard(h, a.cookie);
    await up(h, a.cookie, card.id, "portrait", webpFile(800, 1000), "groom");
    const mine = await h.call("GET", `/api/cards/${card.id}/files/portrait/groom.webp`, undefined, a.cookie);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/webp");
    expect(mine.headers.get("cache-control")).toContain("private");
    expect(mine.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await h.call("GET", `/api/cards/${card.id}/files/portrait/groom.webp`, undefined, b.cookie)).status).toBe(404);
    expect((await h.call("GET", `/api/cards/${card.id}/files/portrait/bride.webp`, undefined, a.cookie)).status).toBe(404);
    expect((await h.call("GET", `/api/cards/${card.id}/files/../../other`, undefined, a.cookie)).status).toBe(404);
  });
});

describe("cards: from empty to ready", () => {
  it("is ready once the required details, the cover, the portraits and a gallery photo are in", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie, { theme: "lover" });
    const empty = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(empty.status.ready).toBe(false);

    await patch(h, cookie, card.id, 1, {
      couple: { first: "bride", groom: { name: "Muhammad Farid", full: "bin Hj. Anuar", short: "Farid", parentsHtml: "Hj. Anuar bin Salleh<br>& Hjh. Mariam binti Ali" }, bride: { name: "Nur Dina", full: "binti Hj. Rashid", short: "Dina", parentsHtml: "Hj. Rashid bin Karim<br>& Hjh. Salmah binti Noh" } },
      host: { parents: ["Hj. Rashid bin Karim", "Hjh. Salmah binti Noh"] },
      date: { start: "2027-05-15T11:00:00+08:00", end: "2027-05-15T16:00:00+08:00" },
      venue: { name: "Dewan Anggerik", area: "Kuantan, Pahang", address: "Jalan Contoh, 25000 Kuantan", maps: "https://maps.app.goo.gl/abc123", waze: "https://waze.com/ul?q=anggerik" },
      aturcara: [{ icon: "jam", label: "Ketibaan Tetamu", time: "11:00 AM" }],
      features: { music: false, dressCode: false }
    });
    const mid = await h.json(await h.call("GET", `/api/cards/${card.id}`, undefined, cookie));
    expect(mid.status.problems).toEqual([]);
    expect(mid.status.missing.map((m: any) => m.path).sort()).toEqual(["gallery", "meta.ogImage", "portrait/bride.webp", "portrait/groom.webp"]);

    await up(h, cookie, card.id, "cover", jpegFile(720, 1280));
    await up(h, cookie, card.id, "portrait", webpFile(800, 1000), "groom");
    await up(h, cookie, card.id, "portrait", webpFile(800, 1000), "bride");
    const last = await h.json(await up(h, cookie, card.id, "gallery", webpFile(1200, 800)));
    expect(last.status.problems).toEqual([]);
    expect(last.status.missing).toEqual([]);
    expect(last.status.ready).toBe(true);
    expect(last.card.ready).toBe(true);
    expect(last.card.names).toBe("Dina & Farid");
    expect(last.card.completeness.done).toBe(last.card.completeness.total);
  });
});

describe("cards: the preview contract", () => {
  it("no preview yet, and an incomplete card is not previewed", async () => {
    const h = harness();
    const { cookie } = await signedIn(h);
    const { card } = await newCard(h, cookie);
    const state = await h.json(await h.call("GET", `/api/cards/${card.id}/preview`, undefined, cookie));
    expect(state).toMatchObject({ state: "none", builtVersion: null, stale: true, url: null });
    expect((await h.call("POST", `/api/cards/${card.id}/preview`, {}, cookie)).status).toBe(409);
  });
});

describe("cards: the daily cleanup", () => {
  it("archives drafts nobody touched for 90 days, with their files; leaves recent, paid and live ones alone", async () => {
    const h = harness();
    const { email, cookie } = await signedIn(h);
    const old = await newCard(h, cookie), fresh = await newCard(h, cookie), paid = await newCard(h, cookie);
    for (const c of [old, fresh, paid]) await up(h, cookie, c.card.id, "cover", jpegFile(720, 1280));
    const now = h.clock.now + 200 * 86_400_000;
    await env.DB.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").bind(now - 91 * 86_400_000, old.card.id).run();
    await env.DB.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").bind(now - 5 * 86_400_000, fresh.card.id).run();
    await env.DB.prepare("UPDATE cards SET updated_at = ?, status = 'paid' WHERE id = ?").bind(now - 365 * 86_400_000, paid.card.id).run();
    await cleanup(env, now);
    const row = (id: string) => env.DB.prepare("SELECT status, draft_json FROM cards WHERE id = ?").bind(id).first<{ status: string; draft_json: string }>();
    expect(await row(old.card.id)).toEqual({ status: "archived", draft_json: "{}" });
    expect((await row(fresh.card.id))?.status).toBe("draft");
    expect((await row(paid.card.id))?.status).toBe("paid");
    expect(await env.MEDIA.get(`cards/${old.card.id}/cover/og-preview.jpg`)).toBeNull();
    expect(await env.MEDIA.get(`cards/${fresh.card.id}/cover/og-preview.jpg`)).not.toBeNull();
    expect(await env.MEDIA.get(`cards/${paid.card.id}/cover/og-preview.jpg`)).not.toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM card_assets WHERE card_id = ?").bind(old.card.id).first<{ n: number }>())?.n).toBe(0);
    // an archived card is gone for its owner, and no longer counts against the three (the clock jumped 200 days, so their session is gone too)
    const again = await h.signIn(email);
    expect((await h.call("GET", `/api/cards/${old.card.id}`, undefined, again)).status).toBe(404);
    expect((await h.call("POST", "/api/cards", {}, again)).status).toBe(201);
  });
});
