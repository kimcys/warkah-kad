import { Hono } from "hono";
import * as v from "valibot";
import { TIERS } from "@warkah/card-kit";
import { cardView, parseDraft, assetsOf, statusOf, type CardRow } from "../lib/cards";
import { requireAdmin, requireUser, type AppEnv } from "../lib/session";
import { readJson } from "../lib/validate";

// Staff tools for the days when payment is manual: find the customer who wrote to us, then set the tier they paid for and mark the card paid.
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireUser, requireAdmin);

/** A LIKE pattern that matches the text literally, so a search for "100%" or "a_b" means what it says. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------- cards (the invitation builder). Until payment is online, an admin sets the tier a customer paid for (Asas / Penuh / Reka Khas).

adminRoutes.get("/cards", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const rows = await db
    .prepare(
      "SELECT c.*, u.email AS owner_email FROM cards c JOIN users u ON u.id = c.owner_user_id " +
        "WHERE c.status != 'archived' AND (?1 = '' OR u.email LIKE ?2 ESCAPE '\\' OR c.id = ?1 OR c.slug LIKE ?2 ESCAPE '\\') ORDER BY c.updated_at DESC LIMIT 20"
    )
    .bind(q, like(q))
    .all<CardRow & { owner_email: string }>();
  const cards = await Promise.all(
    rows.results.map(async (row) => {
      const draft = parseDraft(row);
      return { ...cardView(row, draft, statusOf(row, draft, await assetsOf(db, row.id))), ownerEmail: row.owner_email };
    })
  );
  return c.json({ cards, tiers: TIERS.map((t) => ({ id: t.id, label: t.label, priceRM: t.priceRM })) });
});

const TierSchema = v.pipe(
  v.strictObject({ tier: v.optional(v.picklist(TIERS.map((t) => t.id) as [string, ...string[]])), paid: v.optional(v.literal(true)) }),
  v.check((o) => o.tier !== undefined || o.paid === true)
);

adminRoutes.patch("/cards/:id", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c, TierSchema);
  if (!body) return c.json({ error: "invalid_input" }, 400);
  // `paid: true` is what a customer's payment will do later: it lets them publish. A card already live or paid is left as it is.
  const result = await db.prepare("UPDATE cards SET tier = COALESCE(?1, tier), status = CASE WHEN ?2 = 1 AND status = 'draft' THEN 'paid' ELSE status END, updated_at = ?3 WHERE id = ?4 AND status != 'archived'").bind(body.tier ?? null, body.paid ? 1 : 0, c.get("now"), c.req.param("id")).run();
  if (result.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  const row = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(c.req.param("id")).first<CardRow>())!;
  const draft = parseDraft(row);
  return c.json({ card: cardView(row, draft, statusOf(row, draft, await assetsOf(db, row.id))) });
});
