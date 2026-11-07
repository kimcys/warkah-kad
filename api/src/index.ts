import { Hono } from "hono";
import { senderFromEnv, type EmailSender } from "./lib/email";
import { cleanup } from "./lib/cleanup";
import { sameOriginOnly, type AppEnv } from "./lib/session";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { buildRoutes } from "./routes/build";
import { cardSite } from "./routes/card-site";
import { cardRoutes, catalogueRoute } from "./routes/cards";
import { previewSite } from "./routes/preview-site";

export interface Deps {
  /** Injected in tests; production resolves it from the environment (fails closed without credentials). */
  email: (env: Cloudflare.Env) => EmailSender;
  now: () => number;
}

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { email: senderFromEnv, now: Date.now, ...overrides };
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("now", deps.now());
    await next();
  });
  app.use("*", cardSite);   // a published card, on the card host
  app.use("/api/*", sameOriginOnly);
  // API answers carry sessions and private data: shared caches must not keep them unless a route says otherwise.
  app.use("/api/*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/api/health", async (c) => {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ ok: row?.ok === 1 });
  });

  app.route("/api/auth", authRoutes(deps.email));
  app.route("/api/admin", adminRoutes);
  app.route("/api/cards", cardRoutes);
  app.route("/api/catalogue", catalogueRoute);
  app.route("/api/build", buildRoutes);
  app.route("/p", previewSite);

  // The Worker answers first for almost every path (so /<slug>/ can be a card); what it does not own is the site's own files (landing page and builder).
  app.notFound((c) => (new URL(c.req.url).pathname.startsWith("/api/") ? c.json({ error: "not_found" }, 404) : c.env.ASSETS.fetch(c.req.raw)));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message === "email_not_configured" ? err.message : "internal" }, 500);
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env, controller.scheduledTime ?? Date.now()));
  }
} satisfies ExportedHandler<Cloudflare.Env>;
