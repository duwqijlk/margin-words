import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertIpRateLimit } from "../../lib/rate-limit.ts";
import { requireUser } from "../../lib/session.ts";
import { cleanCatalogId } from "../../../src/lib/catalog-id.ts";
import { SUGGESTION_MAX } from "../../../src/lib/limits.ts";

/**
 * A reader's own meaning, as plain text: control characters and markup brackets removed, spaces
 * folded, at most SUGGESTION_MAX characters. It is reviewed before any of it reaches a word list.
 */
export function cleanSuggestion(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, SUGGESTION_MAX).join("");
}

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleWordFeedbackPost(context.request, context.env);

export async function handleWordFeedbackPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    // Only signed-in readers can open a book, so only they report. Who sent a report is kept
    // only when it carries their own meaning: that is what the meaning may be credited to.
    const user = await requireUser(env.DB, request, options?.now ?? Date.now());
    const body = (await readJson(request)) as {
      bookId?: unknown;
      bookTitle?: unknown;
      catalogId?: unknown;
      word?: unknown;
      reason?: unknown;
      form?: unknown;
      chapter?: unknown;
      chapters?: unknown;
      occurrence?: unknown;
      paragraph?: unknown;
      context?: unknown;
      sentence?: unknown;
      senseIndex?: unknown;
      senseMeaning?: unknown;
      glossaryRev?: unknown;
      suggestion?: unknown;
    };
    const bookId = typeof body.bookId === "string" ? body.bookId.trim().slice(0, 64) : "";
    if (!bookId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(bookId)) {
      throw new HttpError(400, "bad-book");
    }

    const bookTitle =
      typeof body.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : "";
    const catalogId = cleanCatalogId(body.catalogId);

    const rawWord = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
    if (!rawWord || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(rawWord) || rawWord.length < 2 || rawWord.length > 48) {
      throw new HttpError(400, "bad-word");
    }

    // "suggested": the reader wrote a better meaning without saying what was wrong with the one shown.
    const reason =
      body.reason === "too_hard" ||
      body.reason === "wrong_meaning" ||
      body.reason === "missing_meaning" ||
      body.reason === "suggested"
        ? body.reason
        : null;
    if (!reason) {
      throw new HttpError(400, "bad-reason");
    }

    const form = typeof body.form === "string" ? body.form.trim().toLowerCase().slice(0, 48) : rawWord;
    const chapter = Math.max(0, Math.floor(Number(body.chapter) || 0));
    // The reader's edition may split the book into a different number of chapters than the
    // word list; the count tells the patrol whether the chapter number can be trusted.
    const chapters = Math.min(2000, Math.max(0, Math.floor(Number(body.chapters) || 0)));
    const occurrence = Math.max(1, Math.floor(Number(body.occurrence) || 1));
    const paragraph = Math.max(0, Math.floor(Number(body.paragraph) || 0));
    const context = typeof body.context === "string" ? body.context.trim().slice(0, 300) : "";
    const sentence = typeof body.sentence === "string" ? body.sentence.trim().slice(0, 600) : "";
    const senseIndex = typeof body.senseIndex === "number" ? Math.floor(body.senseIndex) : -1;
    const senseMeaning = typeof body.senseMeaning === "string" ? body.senseMeaning.trim().slice(0, 300) : "";
    const glossaryRev = typeof body.glossaryRev === "string" ? body.glossaryRev.trim().slice(0, 100) : "";
    const suggestion = cleanSuggestion(body.suggestion);
    if (reason === "suggested" && !suggestion) throw new HttpError(400, "bad-reason");

    const now = options?.now ?? Date.now();
    const ip = clientIp(request);
    await assertIpRateLimit(env.DB, "feedback", ip, now);

    // Prevent duplicate spam from the same IP for the same word occurrence on the same glossary revision within 24 hours
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const existing = await env.DB.prepare(
      `SELECT id FROM word_feedback
       WHERE book_id = ? AND word = ? AND chapter = ? AND occurrence = ? AND reason = ? AND glossary_rev = ? AND ip = ? AND created_at > ?
       LIMIT 1`,
    )
      .bind(bookId, rawWord, chapter, occurrence, reason, glossaryRev, ip, oneDayAgo)
      .first<{ id: number }>();

    // A repeat with the reader's own meaning is kept: the meaning is the part worth having.
    if (existing && !suggestion) {
      return json({ ok: true, duplicate: true });
    }

    // Check if this issue was previously resolved
    const priorResolved = await env.DB.prepare(
      `SELECT resolved_at, resolved_rev FROM word_feedback
       WHERE book_id = ? AND word = ? AND chapter = ? AND occurrence = ? AND reason = ? AND (status = 'resolved' OR resolved_at IS NOT NULL)
       ORDER BY resolved_at DESC LIMIT 1`,
    )
      .bind(bookId, rawWord, chapter, occurrence, reason)
      .first<{ resolved_at: number; resolved_rev: string }>();

    let status = "pending";
    if (priorResolved && priorResolved.resolved_at > 0 && now > priorResolved.resolved_at) {
      const resolvedRev = priorResolved.resolved_rev || "";

      const priorReports = await env.DB.prepare(
        `SELECT DISTINCT glossary_rev FROM word_feedback
         WHERE book_id = ? AND word = ? AND chapter = ? AND occurrence = ? AND reason = ?
           AND created_at <= ? AND glossary_rev != ''`,
      )
        .bind(bookId, rawWord, chapter, occurrence, reason, priorResolved.resolved_at)
        .all<{ glossary_rev: string }>();

      const preResolutionRevs = new Set(
        (priorReports.results ?? []).map((r) => r.glossary_rev).filter(Boolean),
      );

      // Simple Occam's razor:
      // An incoming report is only suppressed as an outdated client if its revision
      // explicitly matches one of the known pre-resolution buggy revisions (and != resolvedRev).
      // All other cases (reproduced on resolvedRev, on any newer revision, or unknown) trigger 'reopened'.
      const isOutdatedClient =
        Boolean(glossaryRev) &&
        preResolutionRevs.has(glossaryRev) &&
        glossaryRev !== resolvedRev;

      status = isOutdatedClient ? "resolved" : "reopened";
    }

    await env.DB.prepare(
      `INSERT INTO word_feedback (
         book_id, book_title, catalog_id, word, reason, form, chapter, chapters, occurrence,
         paragraph, context, sentence, sense_index, sense_meaning,
         glossary_rev, status, created_at, ip, suggestion, user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        bookId,
        bookTitle,
        catalogId,
        rawWord,
        reason,
        form || rawWord,
        chapter,
        chapters,
        occurrence,
        paragraph,
        context,
        sentence,
        senseIndex,
        senseMeaning,
        glossaryRev,
        status,
        now,
        ip,
        suggestion,
        suggestion ? user.id : null,
      )
      .run();

    return json({ ok: true, saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
