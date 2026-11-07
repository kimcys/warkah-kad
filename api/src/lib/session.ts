import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sha256Hex } from "./crypto";

export const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "customer" | "admin";
}

export type AppEnv = {
  Bindings: Cloudflare.Env;
  Variables: { user: SessionUser; now: number };
};

const COOKIE = "session"; // stored as __Host-session (Secure, Path=/, no Domain)

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, { prefix: "host", httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { prefix: "host", secure: true, path: "/" });
}

export function readSessionToken(c: Context<AppEnv>): string | undefined {
  return getCookie(c, COOKIE, "host");
}

export async function findSessionUser(db: D1Database, token: string, now: number): Promise<SessionUser | null> {
  const idHash = await sha256Hex(token);
  return db
    .prepare(
      "SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id " +
        "WHERE s.id_hash = ? AND s.expires_at > ?"
    )
    .bind(idHash, now)
    .first<SessionUser>();
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c);
  const user = token ? await findSessionUser(c.env.DB, token, c.get("now")) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};

/** Staff only. Admin is a role on the user row, set from the command line (npm run make-admin), never through the app. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};

/** State-changing requests must come from our own origin. SameSite=Lax already blocks cross-site cookies; this is the second lock. */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  await next();
};
