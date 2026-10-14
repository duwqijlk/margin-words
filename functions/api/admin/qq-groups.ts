import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { writeQqGroups } from "../../lib/qq-groups-file.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import { normalizeQqGroups } from "../../../src/lib/qq-groups.ts";

/**
 * Replace the QQ group numbers shown on the overview.
 *   PUT /api/admin/qq-groups   { groups: ["656911882"] }
 * Stored at word-lists/qq-groups.json. It does not touch catalog.json.
 */
export const onRequestPut = (context: { request: Request; env: Env }) => handlePut(context.request, context.env);

export async function handlePut(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const parsed = normalizeQqGroups(await readJson(request, 10_000));
    if (!parsed.ok) throw new HttpError(400, "bad-groups");
    const file = await writeQqGroups(bucket, parsed.groups, new Date().toISOString());
    return json(file);
  } catch (error) {
    return errorResponse(error);
  }
}
