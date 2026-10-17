import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertIpRateLimit } from "../../lib/rate-limit.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleWordFeedbackPost(context.request, context.env);

export async function handleWordFeedbackPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const body = (await readJson(request)) as {
      bookId?: unknown;
      bookTitle?: unknown;
      word?: unknown;
      reason?: unknown;
    };
    const bookId = typeof body.bookId === "string" ? body.bookId.trim().slice(0, 64) : "";
    if (!bookId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(bookId)) {
      throw new HttpError(400, "bad-book");
    }

    const bookTitle =
      typeof body.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : "";

    const rawWord = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
    if (!rawWord || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(rawWord) || rawWord.length < 2 || rawWord.length > 48) {
      throw new HttpError(400, "bad-word");
    }

    const reason = body.reason === "too_hard" || body.reason === "wrong_meaning" ? body.reason : null;
    if (!reason) {
      throw new HttpError(400, "bad-reason");
    }

    const now = options?.now ?? Date.now();
    const ip = clientIp(request);
    await assertIpRateLimit(env.DB, "feedback", ip, now);

    // Prevent duplicate spam from the same IP within 24 hours
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const existing = await env.DB.prepare(
      `SELECT id FROM word_feedback
       WHERE book_id = ? AND word = ? AND reason = ? AND ip = ? AND created_at > ?
       LIMIT 1`,
    )
      .bind(bookId, rawWord, reason, ip, oneDayAgo)
      .first<{ id: number }>();

    if (existing) {
      return json({ ok: true, duplicate: true });
    }

    await env.DB.prepare(
      `INSERT INTO word_feedback (book_id, book_title, word, reason, created_at, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(bookId, bookTitle, rawWord, reason, now, ip)
      .run();

    return json({ ok: true, saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
