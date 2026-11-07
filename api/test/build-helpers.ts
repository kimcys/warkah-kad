// Shared by the preview and publish tests: a customer with a complete card, and the build server's calls.
import { env } from "cloudflare:test";
import { expect } from "vitest";
import { harness, uniq } from "./helpers";

export type H = ReturnType<typeof harness>;
export const SECRET = "build-secret";
export const buildEnv = { ...env, BUILD_SECRET: SECRET };

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const pad = (bytes: number[], size = 64) => { const b = new Uint8Array(Math.max(size, bytes.length + 8)); b.set(bytes); return b; };
export const jpeg = (w: number, h: number) => new File([pad([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])], "a.jpg", { type: "image/jpeg" });
export const webp = (w: number, h: number) => new File([pad([...ascii("RIFF"), ...be32(40), ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)])], "a.webp", { type: "image/webp" });

/** A signed-in customer with a complete card (the same details the builder's own test uses). */
export async function readyCard(h: H) {
  const email = `p-${uniq()}@example.com`;
  const cookie = await h.signIn(email);
  const made = await h.json(await h.call("POST", "/api/cards", { theme: "lover" }, cookie));
  const id = made.card.id as string;
  await h.call("PATCH", `/api/cards/${id}`, { baseVersion: 1, patch: {
    couple: { first: "bride", groom: { name: "Muhammad Farid", full: "bin Hj. Anuar", short: "Farid", parentsHtml: "Hj. A<br>& Hjh. B" }, bride: { name: "Nur Dina", full: "binti Hj. Rashid", short: "Dina", parentsHtml: "Hj. C<br>& Hjh. D" } },
    host: { parents: ["Hj. C", "Hjh. D"] }, date: { start: "2027-05-15T11:00:00+08:00", end: "2027-05-15T16:00:00+08:00" },
    venue: { name: "Dewan Anggerik", area: "Kuantan, Pahang", address: "Jalan Contoh, Kuantan", maps: "https://maps.app.goo.gl/abc123", waze: "https://waze.com/ul?q=a" },
    aturcara: [{ icon: "jam", label: "Ketibaan", time: "11:00 AM" }], features: { music: false, dressCode: false }
  } }, cookie);
  const up = (kind: string, f: File, slot?: string) => h.upload(`/api/cards/${id}/assets`, { kind, ...(slot ? { slot } : {}) }, f, cookie);
  await up("cover", jpeg(720, 1280)); await up("portrait", webp(800, 1000), "groom"); await up("portrait", webp(800, 1000), "bride"); await up("gallery", webp(1200, 800));
  return { id, cookie, email };
}

export type Body = string | Uint8Array | object;
export const build = (h: H, method: string, path: string, body?: Body, headers: Record<string, string> = {}) => {
  const raw = body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body);
  const json = body !== undefined && typeof body === "object" && !(body instanceof Uint8Array);
  return h.app.request(`https://kad.test/api/build${path}`, { method, headers: { Authorization: `Bearer ${SECRET}`, "cf-connecting-ip": h.ip, ...(json ? { "Content-Type": "application/json" } : {}), ...headers }, body: raw }, buildEnv);
};
export const state = async (h: H, id: string, cookie: string) => h.json(await h.call("GET", `/api/cards/${id}/preview`, undefined, cookie));
export const serveAs = (h: H, path: string) => h.app.request(`https://kad.test${path}`, { headers: { "cf-connecting-ip": h.ip } }, env);
export const bytes = (text: string) => new TextEncoder().encode(text);
export const html = bytes("<!doctype html><title>Kad</title><p>hello");

export async function finishJob(h: H, jobId: string, files: Record<string, Uint8Array | string> = { "index.html": html }) {
  for (const [path, data] of Object.entries(files)) expect((await build(h, "PUT", `/jobs/${jobId}/out/${path}`, data)).status).toBe(200);
  return build(h, "POST", `/jobs/${jobId}/done`, { files: Object.keys(files) });
}

