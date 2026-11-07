/** Counts one hit in a fixed window. Returns false once the limit is exceeded. */
export async function allow(db: D1Database, key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count"
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}
