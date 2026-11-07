import { Hono } from "hono";
import { randomCode, randomToken, safeEqual, sha256Hex } from "../lib/crypto";
import type { EmailSender } from "../lib/email";
import { otpEmail } from "../lib/emails";
import { allow } from "../lib/ratelimit";
import {
  SESSION_DAYS,
  clearSessionCookie,
  readSessionToken,
  requireUser,
  setSessionCookie,
  type AppEnv,
  type SessionUser
} from "../lib/session";

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 60_000;
const HOUR = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";
const otpHash = (env: Cloudflare.Env, email: string, code: string) => sha256Hex(`${env.OTP_PEPPER}:${email}:${code}`);

export function authRoutes(getSender: (env: Cloudflare.Env) => EmailSender) {
  const auth = new Hono<AppEnv>();

  auth.post("/otp/request", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);

    const sender = getSender(c.env); // throws before anything is stored if email is not configured
    const now = c.get("now");
    const db = c.env.DB;

    if (!(await allow(db, `otp:ip:${clientIp(c.req.raw)}`, 20, HOUR, now))) return c.json({ error: "rate_limited" }, 429);
    if (!(await allow(db, `otp:email:${email}`, 5, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

    const existing = await db.prepare("SELECT created_at FROM otp_codes WHERE email = ?").bind(email).first<{ created_at: number }>();
    if (existing && now - existing.created_at < RESEND_GAP_MS) return c.json({ error: "retry_later" }, 429);

    const code = randomCode();
    await db
      .prepare(
        "INSERT INTO otp_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) " +
          "ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at"
      )
      .bind(email, await otpHash(c.env, email, code), now + OTP_MINUTES * 60_000, now)
      .run();

    try {
      const sent = await sender.send({ to: email, ...otpEmail(code, OTP_MINUTES) });
      // For tracing a missing email in the provider's dashboard. No address and no code: just that one was sent, and its id.
      await db.prepare("INSERT INTO email_log (id, kind, provider_id, sent_at) VALUES (?, 'otp', ?, ?)").bind(crypto.randomUUID(), sent.id, now).run()
        .catch((e) => console.error("email_log insert failed", e));
    } catch (err) {
      await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();
      console.error(err);
      return c.json({ error: "email_failed" }, 502);
    }
    // Same answer whether or not the address already has an account.
    return c.json({ ok: true });
  });

  auth.post("/otp/verify", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!email || !/^\d{6}$/.test(code)) return c.json({ error: "invalid_code" }, 400);

    const now = c.get("now");
    const db = c.env.DB;
    if (!(await allow(db, `verify:ip:${clientIp(c.req.raw)}`, 60, HOUR, now))) return c.json({ error: "rate_limited" }, 429);

    // Count the attempt first, in one statement, so parallel guesses cannot beat the limit.
    const row = await db
      .prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ? RETURNING code_hash, expires_at, attempts")
      .bind(email)
      .first<{ code_hash: string; expires_at: number; attempts: number }>();
    if (!row || row.expires_at <= now) return c.json({ error: "invalid_code" }, 400);
    if (row.attempts > OTP_MAX_ATTEMPTS) {
      await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();
      return c.json({ error: "too_many_attempts" }, 429);
    }
    if (!safeEqual(row.code_hash, await otpHash(c.env, email, code))) return c.json({ error: "invalid_code" }, 400);

    await db.prepare("DELETE FROM otp_codes WHERE email = ?").bind(email).run();
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING").bind(crypto.randomUUID(), email, now).run();
    const user = await db.prepare("SELECT id, email, name, role FROM users WHERE email = ?").bind(email).first<SessionUser>();
    if (!user) return c.json({ error: "internal" }, 500);

    const token = randomToken();
    await db
      .prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), user.id, now + SESSION_DAYS * 86_400_000, now)
      .run();
    setSessionCookie(c, token);
    return c.json({ user });
  });

  auth.post("/logout", async (c) => {
    const token = readSessionToken(c);
    if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(token)).run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  auth.get("/me", requireUser, (c) => c.json({ user: c.get("user") }));

  return auth;
}
