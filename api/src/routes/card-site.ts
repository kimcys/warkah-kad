// Published cards: https://<card host>/<slug>/ is the customer's card, served from R2 (the build server put it there). Only on the card host (CARD_HOST);
// the builder's own paths (/app, /api, ...) are never taken, because a slug cannot be any of them (RESERVED_SLUGS in the kit).
import type { MiddlewareHandler } from "hono";
import { RESERVED_SLUGS } from "@warkah/card-kit";
import { serveObject } from "../lib/media";
import { livePrefix } from "../lib/previews";
import type { AppEnv } from "../lib/session";

const gone = (c: import("hono").Context<AppEnv>) => c.text("Tidak dijumpai", 404);

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const cardSite: MiddlewareHandler<AppEnv> = async (c, next) => {
  const host = c.env.CARD_HOST;
  if (!host || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();
  const url = new URL(c.req.url);
  if (url.hostname !== host) return next();
  const [slug, ...rest] = url.pathname.split("/").filter((_, i) => i > 0);
  if (!slug || !SLUG.test(slug) || RESERVED_SLUGS.includes(slug)) return next();
  const row = await c.env.DB.prepare("SELECT live_job FROM cards WHERE slug = ? AND status = 'live' AND live_job IS NOT NULL").bind(slug).first<{ live_job: string }>();
  if (!row) return gone(c);   // a card address with no live card (never published, or taken down) is not the builder app
  if (rest.length === 0 && !url.pathname.endsWith("/")) return c.redirect(`/${slug}/${url.search}`, 301);   // the card's own links are relative to /<slug>/
  let path = decodeURIComponent(rest.join("/"));
  if (url.pathname.endsWith("/") || path === "") path = (path ? path + "/" : "") + "index.html";
  if (path.split("/").some((s) => s === ".." || s === ".")) return gone(c);
  const res = await serveObject(c.env.MEDIA, livePrefix(slug, row.live_job) + path, c.req.raw, path.startsWith("_astro/") ? "public, max-age=31536000, immutable" : "public, max-age=60");
  if (!res) return gone(c);
  return res;
};
