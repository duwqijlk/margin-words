import { requireAdmin } from "../../lib/admin.ts";
import { publishContributors } from "../../lib/contributors.ts";
import type { Env } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";

/** Rebuild contributors.json on the books host from accepted meanings. Admin only. */
export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleContributorsRebuild(context.request, context.env);

export async function handleContributorsRebuild(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    if (!env.BOOKS) throw new HttpError(500, "no-books-bucket");
    const people = await publishContributors(env.DB, env.BOOKS, options?.now ?? Date.now());
    return json({ ok: true, people });
  } catch (error) {
    return errorResponse(error);
  }
}
