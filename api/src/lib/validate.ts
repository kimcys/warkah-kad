import type { Context } from "hono";
import * as v from "valibot";

/** Parses the JSON body against a schema. Returns null on any problem; callers answer 400 invalid_input. */
export async function readJson<S extends v.GenericSchema>(c: Context, schema: S): Promise<v.InferOutput<S> | null> {
  const raw = await c.req.json().catch(() => undefined);
  const result = v.safeParse(schema, raw);
  return result.success ? result.output : null;
}
