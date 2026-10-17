import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { catalogGlossaryRev } from "../../lib/catalog-rev.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleAdminWordFeedbackGet(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleAdminWordFeedbackPost(context.request, context.env);

type FeedbackGroupRow = {
  book_id: string;
  book_title: string;
  word: string;
  form: string;
  chapter: number;
  occurrence: number;
  paragraph: number;
  context: string;
  sentence: string;
  sense_index: number;
  sense_meaning: string;
  reason: string;
  report_count: number;
  last_reported_at: number;
  glossary_rev: string | null;
  status: string | null;
  resolved_at: number | null;
  resolved_rev: string | null;
};

export async function handleAdminWordFeedbackGet(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const url = new URL(request.url);
    const bookId = (url.searchParams.get("bookId") ?? "").trim().slice(0, 64);
    const reason = url.searchParams.get("reason") ?? "all";
    const statusFilter = url.searchParams.get("status") ?? "all";
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? "30") || 30));

    // Summary metrics across all feedback
    const summaryRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_reports,
         SUM(CASE WHEN reason = 'too_hard' THEN 1 ELSE 0 END) AS too_hard_reports,
         SUM(CASE WHEN reason = 'wrong_meaning' THEN 1 ELSE 0 END) AS wrong_meaning_reports,
         SUM(CASE WHEN status = 'reopened' THEN 1 ELSE 0 END) AS reopened_reports,
         COUNT(DISTINCT book_id || ':' || word) AS distinct_words
       FROM word_feedback`,
    ).first<{
      total_reports: number;
      too_hard_reports: number;
      wrong_meaning_reports: number;
      reopened_reports: number;
      distinct_words: number;
    }>();

    // Query filters
    const whereParts: string[] = [];
    const bindings: (string | number)[] = [];

    if (reason === "too_hard" || reason === "wrong_meaning") {
      whereParts.push("reason = ?");
      bindings.push(reason);
    }
    if (bookId) {
      whereParts.push("book_id = ?");
      bindings.push(bookId);
    }
    if (search) {
      whereParts.push("word LIKE ?");
      bindings.push(`%${search}%`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    let havingSql = "";
    if (statusFilter === "reopened") {
      havingSql = "HAVING SUM(CASE WHEN status = 'reopened' THEN 1 ELSE 0 END) > 0";
    } else if (statusFilter === "pending") {
      havingSql = "HAVING SUM(CASE WHEN status = 'reopened' THEN 1 ELSE 0 END) = 0 AND SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) > 0";
    } else if (statusFilter === "resolved") {
      havingSql = "HAVING SUM(CASE WHEN status = 'reopened' THEN 1 ELSE 0 END) = 0 AND SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) = 0";
    }

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM word_feedback ${whereSql} GROUP BY book_id, word, chapter, occurrence, reason ${havingSql}
       )`,
    )
      .bind(...bindings)
      .first<{ n: number }>();

    const rows = await env.DB.prepare(
      `SELECT
         book_id,
         COALESCE(MAX(book_title), '') AS book_title,
         word,
         COALESCE(MAX(form), word) AS form,
         chapter,
         occurrence,
         paragraph,
         COALESCE(MAX(context), '') AS context,
         COALESCE(MAX(sentence), '') AS sentence,
         sense_index,
         COALESCE(MAX(sense_meaning), '') AS sense_meaning,
         reason,
         COUNT(*) AS report_count,
         MAX(created_at) AS last_reported_at,
         (
           SELECT f2.glossary_rev FROM word_feedback f2
           WHERE f2.book_id = word_feedback.book_id
             AND f2.word = word_feedback.word
             AND f2.chapter = word_feedback.chapter
             AND f2.occurrence = word_feedback.occurrence
             AND f2.reason = word_feedback.reason
           ORDER BY f2.created_at DESC LIMIT 1
         ) AS glossary_rev,
         CASE
           WHEN SUM(CASE WHEN status = 'reopened' THEN 1 ELSE 0 END) > 0 THEN 'reopened'
           WHEN SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) > 0 THEN 'pending'
           ELSE 'resolved'
         END AS status,
         MAX(resolved_at) AS resolved_at,
         MAX(resolved_rev) AS resolved_rev
       FROM word_feedback
       ${whereSql}
       GROUP BY book_id, word, chapter, occurrence, reason
       ${havingSql}
       ORDER BY report_count DESC, last_reported_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, pageSize, (page - 1) * pageSize)
      .all<FeedbackGroupRow>();

    return json({
      total: countRow?.n ?? 0,
      page,
      pageSize,
      summary: {
        totalReports: summaryRow?.total_reports ?? 0,
        tooHardReports: summaryRow?.too_hard_reports ?? 0,
        wrongMeaningReports: summaryRow?.wrong_meaning_reports ?? 0,
        reopenedReports: summaryRow?.reopened_reports ?? 0,
        distinctWords: summaryRow?.distinct_words ?? 0,
      },
      items: (rows.results ?? []).map((row) => ({
        bookId: row.book_id,
        bookTitle: row.book_title || "",
        word: row.word,
        form: row.form || row.word,
        chapter: row.chapter,
        occurrence: row.occurrence,
        paragraph: row.paragraph,
        context: row.context || "",
        sentence: row.sentence || "",
        senseIndex: row.sense_index,
        senseMeaning: row.sense_meaning || "",
        anchor: {
          chapter: row.chapter,
          occurrence: row.occurrence,
          form: row.form || row.word,
          context: row.context || "",
        },
        reason: row.reason,
        count: row.report_count,
        lastReportedAt: row.last_reported_at,
        glossaryRev: row.glossary_rev || "",
        status: row.status || "pending",
        resolvedAt: row.resolved_at || 0,
        resolvedRev: row.resolved_rev || "",
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAdminWordFeedbackPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const body = (await readJson(request)) as {
      action?: unknown;
      bookId?: unknown;
      word?: unknown;
      chapter?: unknown;
      occurrence?: unknown;
      reason?: unknown;
      rev?: unknown;
    };
    if (body.action !== "resolve") {
      throw new HttpError(400, "bad-action");
    }
    const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
    const word = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
    const chapter = Math.max(0, Math.floor(Number(body.chapter) || 0));
    const occurrence = Math.max(1, Math.floor(Number(body.occurrence) || 1));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const catalogRev = await catalogGlossaryRev(env.BOOKS, bookId);
    const rev = (typeof body.rev === "string" && body.rev.trim() ? body.rev.trim().slice(0, 100) : "") || catalogRev;
    const now = options?.now ?? Date.now();

    await env.DB.prepare(
      `UPDATE word_feedback
       SET status = 'resolved', resolved_at = ?, resolved_rev = ?
       WHERE book_id = ? AND word = ? AND chapter = ? AND occurrence = ? AND reason = ?`,
    )
      .bind(now, rev, bookId, word, chapter, occurrence, reason)
      .run();

    return json({ ok: true, resolved: true, resolvedRev: rev });
  } catch (error) {
    return errorResponse(error);
  }
}
