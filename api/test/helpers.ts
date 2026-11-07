import { env } from "cloudflare:test";
import { createApp } from "../src/index";
import type { EmailMessage } from "../src/lib/email";

let seq = 0;

/** A fresh app, clock, inbox and client IP per test (D1 state is shared and the clock is frozen). */
export function harness() {
  seq++;
  const sent: EmailMessage[] = [];
  const clock = { now: 1_800_000_000_000 };
  const ip = `10.${Math.floor(seq / 62500) % 250}.${Math.floor(seq / 250) % 250}.${seq % 250}`;
  const app = createApp({ email: () => ({ send: async (m) => (sent.push(m), { id: `test-${sent.length}` }) }), now: () => clock.now });

  const call = (method: string, path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) =>
    app.request(
      `https://kad.test${path}`,
      {
        method,
        headers: { "Content-Type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { Cookie: cookie } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body)
      },
      env
    );

  /** multipart/form-data request (the browser sets the boundary itself, so no Content-Type here). */
  const upload = (path: string, fields: Record<string, string>, file?: File | null, cookie?: string) => {
    const fd = new FormData();
    for (const [k, val] of Object.entries(fields)) fd.set(k, val);
    if (file) fd.set("file", file);
    return app.request(
      `https://kad.test${path}`,
      { method: "POST", headers: { "cf-connecting-ip": ip, ...(cookie ? { Cookie: cookie } : {}) }, body: fd },
      env
    );
  };

  async function signIn(email: string): Promise<string> {
    await call("POST", "/api/auth/otp/request", { email });
    const code = sent[sent.length - 1].text.match(/\d{6}/)![0];
    const res = await call("POST", "/api/auth/otp/verify", { email, code });
    return (res.headers.get("set-cookie") ?? "").split(";")[0];
  }

  const json = async (res: Response) => (await res.json()) as any;
  return { app, ip, call, upload, signIn, json, clock, sent };
}

export const uniq = () => Math.random().toString(36).slice(2, 8);

/** Files with real magic bytes, so the server's sniffing accepts them. */
const withHeader = (head: number[], size: number) => {
  const b = new Uint8Array(Math.max(size, 16));
  b.set(head);
  return b;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
export const jpeg = (size = 64) => new File([withHeader([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1], size)], "a.jpg", { type: "image/jpeg" });
export const png = (size = 64) => new File([withHeader([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], size)], "a.png", { type: "image/png" });
export const mp4 = (type: string, size = 64) => new File([withHeader([0, 0, 0, 0x20, ...ascii("ftypisom")], size)], "a.mp4", { type });
export const webm = (type: string, size = 64) => new File([withHeader([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0], size)], "a.webm", { type });
export const ogg = (size = 64) => new File([withHeader([...ascii("OggS"), 0, 0, 0, 0, 0, 0, 0, 0], size)], "a.ogg", { type: "audio/ogg" });
