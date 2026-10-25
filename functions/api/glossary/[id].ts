import { effectiveRole } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertUserRateLimit } from "../../lib/rate-limit.ts";
import { requireUser } from "../../lib/session.ts";
import { shelfGrantsBook } from "../../lib/shelf-grant.ts";
import { speechIds } from "../../lib/book-category.ts";
import { glossaryWeekUsed, GLOSSARY_WEEK_BOOKS, GLOSSARY_WEEK_SPEECHES } from "../../lib/trust.ts";

/**
 * One word list, for a signed-in reader.
 * A plain reader may open 7 new novels and 7 new speeches in a rolling week. A book already opened,
 * or already on the shelf before the cap, does not take another place.
 * Trusted and admin readers are not counted. A plain reader must have checked their email first.
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
    await assertUserRateLimit(env.DB, "glossary", user.id, now);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(400, "bad-id");
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const open = effectiveRole(user, now) !== "user";
    // A new account opens word lists only after it typed the code sent to its email: a free
    // account per made-up address was the cheap way around the weekly cap.
    if (!open && !user.email_verified_at) throw new HttpError(403, "email-unverified");
    const week = open ? null : await weekSlot(env.DB, bucket, user.id, id, now);
    let slot: Slot["slot"] | "shelf" = week?.slot ?? "again";
    // A shelf book is free even when the week is full, and it does not take a place.
    if (!open && slot !== "again" && (await shelfGrantsBook(env.DB, bucket, user.id, id))) slot = "shelf";
    // A full week also says when the next place comes back, so the page can name the day.
    if (slot === "full") return json({ error: "glossary-week", resetAt: week?.resetAt ?? 0 }, 429);
    if (slot === "full-speech") return json({ error: "glossary-week-speech", resetAt: week?.resetAt ?? 0 }, 429);
    const object =
      (await bucket.get(`word-lists/${id}/glossary.json`)) ??
      (await bucket.get(`public-books/${id}/glossary.json`));
    if (!object) throw new HttpError(404, "no-list");
    if (slot === "new" || slot === "shelf") {
      // A shelf book is recorded outside the window, so the weekly count stays put.
      const at = slot === "shelf" ? 0 : now;
      await env.DB.prepare("INSERT INTO glossary_reads (user_id, book_id, created_at) VALUES (?, ?, ?)")
        .bind(user.id, id, at)
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

type Slot = { slot: "again" | "new" | "full" | "full-speech"; resetAt: number };

async function weekSlot(
  db: Env["DB"],
  bucket: NonNullable<Env["BOOKS"]>,
  userId: string,
  bookId: string,
  now: number,
): Promise<Slot> {
  // Any earlier open counts, including one from a previous week, so another device can fetch it.
  const again = await db
    .prepare("SELECT book_id FROM glossary_reads WHERE user_id = ? AND book_id = ? LIMIT 1")
    .bind(userId, bookId)
    .first<{ book_id: string }>();
  if (again) return { slot: "again", resetAt: 0 };
  // Novels and speeches each have their own weekly places.
  const speeches = await speechIds(bucket);
  const used = await glossaryWeekUsed(db, userId, now, speeches);
  if (speeches.has(bookId)) {
    const full = used.speeches.used >= GLOSSARY_WEEK_SPEECHES;
    return { slot: full ? "full-speech" : "new", resetAt: used.speeches.resetAt };
  }
  return { slot: used.novels.used >= GLOSSARY_WEEK_BOOKS ? "full" : "new", resetAt: used.novels.resetAt };
}
