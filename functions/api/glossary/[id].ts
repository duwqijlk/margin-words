import { effectiveRole } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { requireUser } from "../../lib/session.ts";
import { glossaryWeekUsed, GLOSSARY_WEEK_BOOKS, GLOSSARY_WEEK_MS } from "../../lib/trust.ts";

/**
 * One word list, for a signed-in reader.
 * A plain reader may open 5 distinct books in a rolling week. Opening a book
 * again in that week is free. Trusted and admin readers are not counted.
 * There is no route that returns every list at once.
 *
 *   GET /api/glossary/:id
 */
export const onRequestGet = (context: { request: Request; env: Env; params: { id: string } }) =>
  handleGlossary(context.request, context.env, context.params.id);

export async function handleGlossary(
  request: Request,
  env: Env,
  id: string,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const now = options?.now ?? Date.now();
    const user = await requireUser(env.DB, request, now);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(400, "bad-id");
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const open = effectiveRole(user, now) !== "user";
    const slot = open ? "again" : await weekSlot(env.DB, user.id, id, now);
    if (slot === "full") throw new HttpError(429, "glossary-week");
    const object =
      (await bucket.get(`word-lists/${id}/glossary.json`)) ??
      (await bucket.get(`public-books/${id}/glossary.json`));
    if (!object) throw new HttpError(404, "no-list");
    if (slot === "new") {
      await env.DB.prepare("INSERT INTO glossary_reads (user_id, book_id, created_at) VALUES (?, ?, ?)")
        .bind(user.id, id, now)
        .run();
    }
    const body = object.body ?? (await object.arrayBuffer());
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(object.size),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function weekSlot(
  db: Env["DB"],
  userId: string,
  bookId: string,
  now: number,
): Promise<"again" | "new" | "full"> {
  const since = now - GLOSSARY_WEEK_MS;
  const again = await db
    .prepare("SELECT book_id FROM glossary_reads WHERE user_id = ? AND book_id = ? AND created_at > ? LIMIT 1")
    .bind(userId, bookId, since)
    .first<{ book_id: string }>();
  if (again) return "again";
  const used = await glossaryWeekUsed(db, userId, now);
  return used >= GLOSSARY_WEEK_BOOKS ? "full" : "new";
}
