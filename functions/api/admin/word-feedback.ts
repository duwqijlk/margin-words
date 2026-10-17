import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, json } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleAdminWordFeedbackGet(context.request, context.env);

type FeedbackGroupRow = {
  book_id: string;
  word: string;
  reason: string;
  report_count: number;
  last_reported_at: number;
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
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? "30") || 30));

    // Summary metrics across all feedback
    const summaryRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_reports,
         SUM(CASE WHEN reason = 'too_hard' THEN 1 ELSE 0 END) AS too_hard_reports,
         SUM(CASE WHEN reason = 'wrong_meaning' THEN 1 ELSE 0 END) AS wrong_meaning_reports,
         COUNT(DISTINCT book_id || ':' || word) AS distinct_words
       FROM word_feedback`,
    ).first<{
      total_reports: number;
      too_hard_reports: number;
      wrong_meaning_reports: number;
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

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM word_feedback ${whereSql} GROUP BY book_id, word, reason
       )`,
    )
      .bind(...bindings)
      .first<{ n: number }>();

    const rows = await env.DB.prepare(
      `SELECT
         book_id,
         COALESCE(MAX(book_title), '') AS book_title,
         word,
         reason,
         COUNT(*) AS report_count,
         MAX(created_at) AS last_reported_at
       FROM word_feedback
       ${whereSql}
       GROUP BY book_id, word, reason
       ORDER BY report_count DESC, last_reported_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, pageSize, (page - 1) * pageSize)
      .all<FeedbackGroupRow & { book_title: string }>();

    return json({
      total: countRow?.n ?? 0,
      page,
      pageSize,
      summary: {
        totalReports: summaryRow?.total_reports ?? 0,
        tooHardReports: summaryRow?.too_hard_reports ?? 0,
        wrongMeaningReports: summaryRow?.wrong_meaning_reports ?? 0,
        distinctWords: summaryRow?.distinct_words ?? 0,
      },
      items: (rows.results ?? []).map((row) => ({
        bookId: row.book_id,
        bookTitle: row.book_title || "",
        word: row.word,
        reason: row.reason,
        count: row.report_count,
        lastReportedAt: row.last_reported_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
