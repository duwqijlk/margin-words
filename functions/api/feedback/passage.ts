import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertIpRateLimit } from "../../lib/rate-limit.ts";
import { requireUser } from "../../lib/session.ts";
import { cleanSuggestion } from "./word.ts";
import { PASSAGE_MAX } from "../../../src/lib/limits.ts";

/**
 * Help with a selected passage: a few words, a sentence, or a short part of one paragraph that a
 * reader found hard (a phrase, a figure of speech, a long sentence). The daily patrol turns a good
 * one into a phrase, sentence or paragraph note in the live word list.
 *
 *   POST /api/feedback/passage
 *   { bookId, bookTitle, chapter, paragraph, selected, before, after, reason, suggestion?, glossaryRev }
 *
 * A selection never crosses paragraphs (the page refuses that), and the text is short: only enough
 * of the book to find the place again.
 */
export const onRequestPost = (context: { request: Request; env: Env }) =>
  handlePassageFeedbackPost(context.request, context.env);

/** "hard": I do not understand this. "phrase": these words go together. "wrong": the help shown here is wrong. */
export const PASSAGE_REASONS = ["hard", "phrase", "wrong", "suggested"] as const;
export type PassageReason = (typeof PASSAGE_REASONS)[number];

/** Book text from the page: one line, no control characters or markup brackets, at most `max` characters. */
export function cleanBookText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Each character is kept unless it is a control character or a markup bracket.
  const text = [...value]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || ch === "<" || ch === ">" ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, max).join("");
}

export async function handlePassageFeedbackPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const now = options?.now ?? Date.now();
    const user = await requireUser(env.DB, request, now);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;

    const bookId = typeof body.bookId === "string" ? body.bookId.trim().slice(0, 64) : "";
    if (!bookId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(bookId)) throw new HttpError(400, "bad-book");
    const bookTitle = cleanBookText(body.bookTitle, 150);

    // A selection longer than PASSAGE_MAX is refused, not cut: the page already stops it there.
    const raw = typeof body.selected === "string" ? body.selected.replace(/\s+/g, " ").trim() : "";
    if ([...raw].length > PASSAGE_MAX) throw new HttpError(400, "too-long");
    const selected = cleanBookText(raw, PASSAGE_MAX);
    if ([...selected].length < 2 || !/[a-z]/i.test(selected)) throw new HttpError(400, "bad-passage");

    const reason = PASSAGE_REASONS.includes(body.reason as PassageReason) ? (body.reason as PassageReason) : null;
    if (!reason) throw new HttpError(400, "bad-reason");
    const suggestion = cleanSuggestion(body.suggestion);
    if (reason === "suggested" && !suggestion) throw new HttpError(400, "bad-reason");

    const chapter = Math.max(0, Math.floor(Number(body.chapter) || 0));
    const paragraph = Math.max(0, Math.floor(Number(body.paragraph) || 0));
    const before = cleanBookText(body.before, 80);
    const after = cleanBookText(body.after, 80);
    const glossaryRev = cleanBookText(body.glossaryRev, 100);

    const ip = clientIp(request);
    await assertIpRateLimit(env.DB, "feedback", ip, now);

    // The same place and reason from the same address within a day is one report, unless it
    // brings the reader's own explanation: that is the part worth keeping.
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const repeat = await env.DB.prepare(
      `SELECT id FROM passage_feedback
       WHERE book_id = ? AND chapter = ? AND paragraph = ? AND selected = ? AND reason = ? AND ip = ? AND created_at > ?
       LIMIT 1`,
    )
      .bind(bookId, chapter, paragraph, selected, reason, ip, dayAgo)
      .first<{ id: number }>();
    if (repeat && !suggestion) return json({ ok: true, duplicate: true });

    await env.DB.prepare(
      `INSERT INTO passage_feedback (
         book_id, book_title, chapter, paragraph, selected, before, after, reason,
         suggestion, glossary_rev, status, user_id, ip, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        bookId,
        bookTitle,
        chapter,
        paragraph,
        selected,
        before,
        after,
        reason,
        suggestion,
        glossaryRev,
        suggestion ? user.id : null,
        ip,
        now,
      )
      .run();
    return json({ ok: true, saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
