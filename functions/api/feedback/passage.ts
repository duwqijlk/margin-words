import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertIpRateLimit } from "../../lib/rate-limit.ts";
import { requireUser } from "../../lib/session.ts";
import { PASSAGE_MAX, PASSAGE_NOTE_MAX } from "../../../src/lib/limits.ts";

/**
 * Help with a selected passage: a few words, a sentence, or a short part of one paragraph that a
 * reader found hard (a phrase, a figure of speech, a long sentence). The daily patrol turns a good
 * one into a phrase, sentence or paragraph note in the live word list.
 *
 *   POST /api/feedback/passage
 *   { bookId, bookTitle, chapter, paragraph, start, end, selected, before, after, reason, suggestion?, glossaryRev }
 *
 * A selection never crosses paragraphs (the page refuses that), and the text is short: only enough
 * of the book to find the place again. `start` / `end` are its character offsets in the paragraph.
 *
 * Reports on one paragraph that overlap are one topic, whoever sent them and however long each is:
 * a short selection inside a longer one, or two that share words. Each report keeps its own text
 * and explanation; `topic` is the id of the first open report it overlaps, so the patrol reads
 * them together and writes one note (see docs/GLOSSARY_PATROL.md).
 */
export const onRequestPost = (context: { request: Request; env: Env }) =>
  handlePassageFeedbackPost(context.request, context.env);

/** Two [start, end) spans of one paragraph share at least one character. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

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
    const suggestion = cleanBookText(body.suggestion, PASSAGE_NOTE_MAX);
    if (reason === "suggested" && !suggestion) throw new HttpError(400, "bad-reason");

    const chapter = Math.max(0, Math.floor(Number(body.chapter) || 0));
    const paragraph = Math.max(0, Math.floor(Number(body.paragraph) || 0));
    const before = cleanBookText(body.before, 80);
    const after = cleanBookText(body.after, 80);
    // Offsets of the selection in the paragraph. An older page sends none: treat it as unknown,
    // and only an exact repeat of the same text counts as the same place.
    const startRaw = Number(body.start);
    const endRaw = Number(body.end);
    const located = Number.isInteger(startRaw) && Number.isInteger(endRaw) && startRaw >= 0 && endRaw > startRaw && endRaw - startRaw <= PASSAGE_MAX * 2;
    const start = located ? startRaw : -1;
    const end = located ? endRaw : -1;
    const span = body.span === "sentence" ? "sentence" : "words";
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

    // The open topic this report belongs to: the oldest open report on the same paragraph whose
    // span overlaps this one (or, without offsets, whose text holds this one or is held by it).
    const open = await env.DB.prepare(
      `SELECT id, topic, sel_start, sel_end, selected FROM passage_feedback
       WHERE book_id = ? AND chapter = ? AND paragraph = ? AND status != 'resolved'
       ORDER BY id ASC LIMIT 200`,
    )
      .bind(bookId, chapter, paragraph)
      .all<{ id: number; topic: number; sel_start: number; sel_end: number; selected: string }>();
    const near = (open.results ?? []).find((row) =>
      start >= 0 && row.sel_start >= 0
        ? overlaps({ start, end }, { start: row.sel_start, end: row.sel_end })
        : row.selected.includes(selected) || selected.includes(row.selected),
    );
    const topic = near ? near.topic || near.id : 0;

    const inserted = await env.DB.prepare(
      `INSERT INTO passage_feedback (
         book_id, book_title, chapter, paragraph, sel_start, sel_end, span, selected, before, after, reason,
         suggestion, glossary_rev, status, topic, user_id, ip, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        bookId,
        bookTitle,
        chapter,
        paragraph,
        start,
        end,
        span,
        selected,
        before,
        after,
        reason,
        suggestion,
        glossaryRev,
        topic,
        suggestion ? user.id : null,
        ip,
        now,
      )
      .first<{ id: number }>();
    // The first report of a topic names it with its own id.
    if (!topic && inserted?.id) {
      await env.DB.prepare("UPDATE passage_feedback SET topic = id WHERE id = ?").bind(inserted.id).run();
    }
    return json({ ok: true, saved: true, ...(near ? { joined: true } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}
