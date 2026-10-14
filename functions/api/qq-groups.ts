import type { Env } from "../lib/db.ts";
import { readQqGroups } from "../lib/qq-groups-file.ts";
import { errorResponse, HttpError, json } from "../lib/http.ts";

/**
 * The overview reads this. No account is required.
 *   GET /api/qq-groups
 * `saved: false` means the file is not there yet, so the page uses its built-in number.
 */
export const onRequestGet = (context: { request: Request; env: Env }) => handleGet(context.request, context.env);

export async function handleGet(_request: Request, env: Env): Promise<Response> {
  try {
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const file = await readQqGroups(bucket);
    if (!file) return json({ format: 1, saved: false, groups: [] });
    return json({ format: 1, saved: true, updated: file.updated, groups: file.groups });
  } catch (error) {
    return errorResponse(error);
  }
}
