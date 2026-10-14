import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import { normalizeDiscoverRails } from "../../../src/lib/discover-rails.ts";

const KEY = "word-lists/discover-rails.json";

/**
 * Save which series rows Discover shows.
 *   PUT /api/admin/discover-rails   { rails: [...] }
 * The public file is word-lists/discover-rails.json. It does not touch catalog.json.
 */
export const onRequestPut = (context: { request: Request; env: Env }) => handlePut(context.request, context.env);

export async function handlePut(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const parsed = normalizeDiscoverRails(await readJson(request, 100_000));
    if (!parsed.ok) throw new HttpError(400, "bad-rails");
    const file = { format: 1, updated: new Date().toISOString(), rails: parsed.rails };
    await bucket.put(KEY, new TextEncoder().encode(`${JSON.stringify(file, null, 1)}\n`));
    return json(file);
  } catch (error) {
    return errorResponse(error);
  }
}
