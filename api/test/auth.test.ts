import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import { senderFromEnv, type EmailMessage } from "../src/lib/email";

const ORIGIN = "https://kad.test";
let sent: EmailMessage[];
let now: number;
let app: ReturnType<typeof createApp>;
let testNo = 0; // D1 state is shared across tests and the clock is frozen, so each test is its own client

beforeEach(() => {
  testNo++;
  sent = [];
  now = 1_800_000_000_000;
  app = createApp({ email: () => ({ send: async (m) => (sent.push(m), { id: `test-${sent.length}` }) }), now: () => now });
});

const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(
    `${ORIGIN}${path}`,
    { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.0.${Math.floor(testNo / 250)}.${testNo % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env
  );

const lastCode = () => sent[sent.length - 1].text.match(/\d{6}/)![0];
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

async function signIn(email: string) {
  await call("/api/auth/otp/request", { email });
  const res = await call("/api/auth/otp/verify", { email, code: lastCode() });
  return { res, cookie: cookieOf(res) };
}

describe("requesting a code", () => {
  it("emails a six-digit code to the normalised address", async () => {
    const res = await call("/api/auth/otp/request", { email: "  Aiman@Example.COM " });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("aiman@example.com");
    expect(sent[0].text).toMatch(/\d{6}/);
  });

  it("rejects a malformed address without sending", async () => {
    const res = await call("/api/auth/otp/request", { email: "nope" });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("gives the same answer for a new and an existing account", async () => {
    await signIn("old@example.com");
    const existing = await call("/api/auth/otp/request", { email: "old@example.com" });
    const fresh = await call("/api/auth/otp/request", { email: "new@example.com" });
    expect(existing.status).toBe(fresh.status);
    expect(await existing.json()).toEqual(await fresh.json());
  });

  it("blocks a second request inside 60 seconds, then allows it", async () => {
    await call("/api/auth/otp/request", { email: "a@example.com" });
    expect((await call("/api/auth/otp/request", { email: "a@example.com" })).status).toBe(429);
    now += 61_000;
    expect((await call("/api/auth/otp/request", { email: "a@example.com" })).status).toBe(200);
  });

  it("limits one address to five codes an hour", async () => {
    for (let i = 0; i < 5; i++) {
      now += 61_000;
      expect((await call("/api/auth/otp/request", { email: "busy@example.com" })).status).toBe(200);
    }
    now += 61_000;
    expect((await call("/api/auth/otp/request", { email: "busy@example.com" })).status).toBe(429);
  });

  it("does not store a code when the email provider fails", async () => {
    app = createApp({ email: () => ({ send: async () => { throw new Error("down"); } }), now: () => now });
    const res = await call("/api/auth/otp/request", { email: "fail@example.com" });
    expect(res.status).toBe(502);
    const row = await env.DB.prepare("SELECT 1 FROM otp_codes WHERE email = 'fail@example.com'").first();
    expect(row).toBeNull();
  });
});

describe("the sign-in email log", () => {
  it("records that a code was sent and the provider's id, but neither the address nor the code", async () => {
    const id = crypto.randomUUID();
    const when = now + 12_345;
    app = createApp({ email: () => ({ send: async (m) => (sent.push(m), { id }) }), now: () => when });
    await call("/api/auth/otp/request", { email: "logged@example.com" });
    const row = await env.DB.prepare("SELECT * FROM email_log WHERE provider_id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "otp", user_id: null, sent_at: when });
    const everything = JSON.stringify(row);
    expect(everything).not.toContain("logged@example.com");
    expect(everything).not.toContain(lastCode());
  });

  it("records nothing when the email could not be sent", async () => {
    const when = now + 54_321;
    app = createApp({ email: () => ({ send: async () => { throw new Error("down"); } }), now: () => when });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("/api/auth/otp/request", { email: "nolog@example.com" })).status).toBe(502);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'otp' AND sent_at = ?").bind(when).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("verifying a code", () => {
  it("signs in, creates the user once, and sets a hardened cookie", async () => {
    const { res, cookie } = await signIn("couple@example.com");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).user).toMatchObject({ email: "couple@example.com", role: "customer" });
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("__Host-session=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    const me = await call("/api/auth/me", undefined, { Cookie: cookie });
    expect(me.status).toBe(200);

    now += 61_000;
    await signIn("couple@example.com");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'couple@example.com'").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("does not store the code or the session token in plain text", async () => {
    const { cookie } = await signIn("hash@example.com");
    const token = cookie.split("=")[1];
    const stored = await env.DB.prepare("SELECT id_hash FROM sessions").all<{ id_hash: string }>();
    expect(stored.results.some((r) => r.id_hash === token)).toBe(false);
  });

  it("accepts a code only once", async () => {
    await call("/api/auth/otp/request", { email: "once@example.com" });
    const code = lastCode();
    expect((await call("/api/auth/otp/verify", { email: "once@example.com", code })).status).toBe(200);
    expect((await call("/api/auth/otp/verify", { email: "once@example.com", code })).status).toBe(400);
  });

  it("rejects a wrong code, and a right code for another address", async () => {
    await call("/api/auth/otp/request", { email: "x@example.com" });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await call("/api/auth/otp/verify", { email: "x@example.com", code: wrong })).status).toBe(400);
    expect((await call("/api/auth/otp/verify", { email: "y@example.com", code })).status).toBe(400);
  });

  it("locks the code after five wrong guesses, even for the right code", async () => {
    await call("/api/auth/otp/request", { email: "brute@example.com" });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await call("/api/auth/otp/verify", { email: "brute@example.com", code: wrong });
    const res = await call("/api/auth/otp/verify", { email: "brute@example.com", code });
    expect(res.status).toBe(429);
    expect(cookieOf(res)).toBe("");
  });

  it("rejects an expired code", async () => {
    await call("/api/auth/otp/request", { email: "late@example.com" });
    const code = lastCode();
    now += 10 * 60_000 + 1;
    expect((await call("/api/auth/otp/verify", { email: "late@example.com", code })).status).toBe(400);
  });

  it("rejects malformed codes", async () => {
    expect((await call("/api/auth/otp/verify", { email: "a@example.com", code: "12ab56" })).status).toBe(400);
    expect((await call("/api/auth/otp/verify", { email: "a@example.com", code: 123456 })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("needs a session for /me", async () => {
    expect((await call("/api/auth/me")).status).toBe(401);
    expect((await call("/api/auth/me", undefined, { Cookie: "__Host-session=forged" })).status).toBe(401);
  });

  it("expires after 30 days", async () => {
    const { cookie } = await signIn("exp@example.com");
    now += 30 * 86_400_000 + 1;
    expect((await call("/api/auth/me", undefined, { Cookie: cookie })).status).toBe(401);
  });

  it("logout ends the session", async () => {
    const { cookie } = await signIn("bye@example.com");
    expect((await call("/api/auth/logout", {}, { Cookie: cookie })).status).toBe(200);
    expect((await call("/api/auth/me", undefined, { Cookie: cookie })).status).toBe(401);
  });

  it("refuses state-changing requests from another origin", async () => {
    const res = await call("/api/auth/otp/request", { email: "csrf@example.com" }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe("email configuration", () => {
  it("fails closed without credentials", () => {
    expect(() => senderFromEnv({ ...env, RESEND_API_KEY: undefined, EMAIL_FROM: undefined, EMAIL_MODE: undefined })).toThrow("email_not_configured");
  });

  it("allows the console sender only when EMAIL_MODE is fake", () => {
    expect(() => senderFromEnv({ ...env, EMAIL_MODE: "fake" })).not.toThrow();
    expect(() => senderFromEnv({ ...env, EMAIL_MODE: "true" })).toThrow();
  });

  it("answers 500 email_not_configured on the real app without credentials", async () => {
    const real = createApp({ now: () => now });
    const res = await real.request(`${ORIGIN}/api/auth/otp/request`, { method: "POST", body: JSON.stringify({ email: "z@example.com" }), headers: { "Content-Type": "application/json" } }, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "email_not_configured" });
    const stored = await env.DB.prepare("SELECT 1 FROM otp_codes WHERE email = 'z@example.com'").first();
    expect(stored).toBeNull();
  });
});
