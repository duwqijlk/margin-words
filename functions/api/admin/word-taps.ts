import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, json } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleAdminWordTapsGet(context.request, context.env);

type TapRow = {
  book_id: string;
  book_title: string;
  word: string;
  form: string;
  chapter: number;
  occurrence: number;
  paragraph: number;
  context: string;
  sentence: string;
  tap_count: number;
  in_glossary: number;
  last_tapped_at: number;
};

export async function handleAdminWordTapsGet(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const url = new URL(request.url);
    const bookId = (url.searchParams.get("bookId") ?? "").trim().slice(0, 64);
    const filter = url.searchParams.get("filter") === "all" ? "all" : "missing";
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? "50") || 50));

    // Summary metrics across the database
    const summaryRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_words,
         SUM(CASE WHEN in_glossary = 0 THEN 1 ELSE 0 END) AS missing_words,
         COALESCE(SUM(tap_count), 0) AS total_taps
       FROM book_word_taps`,
    ).first<{ total_words: number; missing_words: number; total_taps: number }>();

    // Build query conditions
    const whereParts: string[] = [];
    const bindings: (string | number)[] = [];

    if (filter === "missing") {
      whereParts.push("in_glossary = 0");
    }
    if (bookId) {
      whereParts.push("(book_id = ? OR book_title LIKE ?)");
      bindings.push(bookId, `%${bookId}%`);
    }
    if (search) {
      whereParts.push("(word LIKE ? OR form LIKE ?)");
      bindings.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM book_word_taps ${whereSql}`,
    )
      .bind(...bindings)
      .first<{ n: number }>();

    const rows = await env.DB.prepare(
      `SELECT
         book_id,
         book_title,
         word,
         form,
         chapter,
         occurrence,
         paragraph,
         context,
         sentence,
         tap_count,
         in_glossary,
         last_tapped_at
       FROM book_word_taps
       ${whereSql}
       ORDER BY tap_count DESC, last_tapped_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, pageSize, (page - 1) * pageSize)
      .all<TapRow>();

    return json({
      total: totalRow?.n ?? 0,
      page,
      pageSize,
      summary: {
        totalWords: summaryRow?.total_words ?? 0,
        missingWords: summaryRow?.missing_words ?? 0,
        totalTaps: summaryRow?.total_taps ?? 0,
      },
      items: (rows.results ?? []).map((row) => ({
        bookId: row.book_id,
        bookTitle: row.book_title || "",
        word: row.word,
        form: row.form || row.word,
        chapter: row.chapter,
        occurrence: row.occurrence,
        paragraph: row.paragraph,
        context: row.context,
        sentence: row.sentence,
        tapCount: row.tap_count,
        inGlossary: row.in_glossary === 1,
        lastTappedAt: row.last_tapped_at,
        anchor: {
          chapter: row.chapter,
          occurrence: row.occurrence,
          form: row.form || row.word,
          context: row.context,
        },
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
