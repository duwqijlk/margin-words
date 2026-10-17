import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertIpRateLimit } from "../../lib/rate-limit.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleWordTapsPost(context.request, context.env);

export async function handleWordTapsPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const body = (await readJson(request)) as { bookId?: unknown; taps?: unknown };
    const bookId = typeof body.bookId === "string" ? body.bookId.trim().slice(0, 64) : "";
    if (!bookId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(bookId)) {
      throw new HttpError(400, "bad-book");
    }

    if (!Array.isArray(body.taps) || body.taps.length === 0 || body.taps.length > 50) {
      throw new HttpError(400, "bad-taps");
    }

    type CleanTap = { word: string; count: number; inGlossary: number };
    const clean: CleanTap[] = [];
    for (const item of body.taps) {
      if (!item || typeof item !== "object") continue;
      const record = item as { word?: unknown; count?: unknown; inGlossary?: unknown };
      const rawWord = typeof record.word === "string" ? record.word.trim().toLowerCase() : "";
      if (!rawWord || !/^[a-z]+(?:-[a-z]+)?$/.test(rawWord) || rawWord.length < 2 || rawWord.length > 40) {
        continue;
      }
      const count =
        typeof record.count === "number" && Number.isSafeInteger(record.count) && record.count > 0
          ? Math.min(record.count, 100)
          : 1;
      const inGlossary = record.inGlossary === true || record.inGlossary === 1 ? 1 : 0;
      clean.push({ word: rawWord, count, inGlossary });
    }

    if (clean.length === 0) {
      return json({ ok: true, saved: 0 });
    }

    const now = options?.now ?? Date.now();
    const ip = clientIp(request);
    await assertIpRateLimit(env.DB, "taps", ip, now);

    const writeBatch = clean.map((item) =>
      env.DB.prepare(
        `INSERT INTO book_word_taps (book_id, word, tap_count, in_glossary, last_tapped_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_id, word) DO UPDATE SET
           tap_count = book_word_taps.tap_count + excluded.tap_count,
           in_glossary = CASE WHEN excluded.in_glossary = 1 THEN 1 ELSE book_word_taps.in_glossary END,
           last_tapped_at = excluded.last_tapped_at`,
      ).bind(bookId, item.word, item.count, item.inGlossary, now),
    );
    await env.DB.batch(writeBatch);

    return json({ ok: true, saved: clean.length });
  } catch (error) {
    return errorResponse(error);
  }
}
