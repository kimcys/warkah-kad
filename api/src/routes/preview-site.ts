// A customer's preview card, served at /p/<token>/ from R2. The link is unguessable and works for 7 days after the last build, so the couple
// can show family before paying. It is a page of the customer's own words: never indexed, never sent as a referrer, and sandboxed so a page
// on it cannot reach the app's cookies or API even if someone sent a link to somebody else.
import { Hono } from "hono";
import { serveObject } from "../lib/media";
import { previewPrefix } from "../lib/previews";
import type { AppEnv } from "../lib/session";

const gone = (c: import("hono").Context<AppEnv>) => c.text("Tidak dijumpai", 404);   // a real 404: the app's single-page fallback must not answer for a card

export const previewSite = new Hono<AppEnv>();

const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals; frame-ancestors 'self'";

async function serve(c: import("hono").Context<AppEnv>, token: string, rest: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return gone(c);
  const row = await c.env.DB.prepare("SELECT preview_job FROM cards WHERE preview_token = ? AND preview_job IS NOT NULL AND preview_expires > ?").bind(token, c.get("now")).first<{ preview_job: string }>();
  if (!row) return gone(c);
  let path = decodeURIComponent(rest);
  if (path === "" || path.endsWith("/")) path += "index.html";
  if (path.split("/").some((s) => s === ".." || s === ".")) return gone(c);
  let res = await serveObject(c.env.MEDIA, previewPrefix(token, row.preview_job) + path, c.req.raw, "private, max-age=30");
  if (!res && !path.includes(".")) res = await serveObject(c.env.MEDIA, previewPrefix(token, row.preview_job) + path + "/index.html", c.req.raw, "private, max-age=30");
  if (!res) return gone(c);
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("Referrer-Policy", "no-referrer");
  out.headers.set("Content-Security-Policy", SANDBOX);
  return out;
}

previewSite.get("/:token", (c) => (/^[a-f0-9]{32}$/.test(c.req.param("token")) ? c.redirect(`/p/${c.req.param("token")}/`, 301) : gone(c)));
previewSite.get("/:token/*", (c) => serve(c, c.req.param("token"), c.req.path.split("/").slice(3).join("/")));
