import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { catalogGlossaryRev } from "../../lib/catalog-rev.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleAdminWordTapsGet(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleAdminWordTapsPost(context.request, context.env);

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
  glossary_rev: string;
  status: string;
  resolved_at: number;
  resolved_rev: string;
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
    const filter = url.searchParams.get("filter") ?? "missing";
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? "50") || 50));

    // Summary metrics across the database
    const summaryRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_words,
         SUM(CASE WHEN in_glossary = 0 AND status != 'resolved' THEN 1 ELSE 0 END) AS missing_words,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_words,
         COALESCE(SUM(tap_count), 0) AS total_taps
       FROM book_word_taps`,
    ).first<{ total_words: number; missing_words: number; resolved_words: number; total_taps: number }>();

    // Build query conditions
    const whereParts: string[] = [];
    const bindings: (string | number)[] = [];

    if (filter === "missing") {
      whereParts.push("in_glossary = 0 AND status != 'resolved'");
    } else if (filter === "resolved") {
      whereParts.push("status = 'resolved'");
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
         glossary_rev,
         status,
         resolved_at,
         resolved_rev,
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
        resolvedWords: summaryRow?.resolved_words ?? 0,
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
        glossaryRev: row.glossary_rev || "",
        status: row.status || "pending",
        resolvedAt: row.resolved_at || 0,
        resolvedRev: row.resolved_rev || "",
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

export async function handleAdminWordTapsPost(
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
      rev?: unknown;
    };
    if (body.action !== "resolve") {
      throw new HttpError(400, "bad-action");
    }
    const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
    const word = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
    const chapter = Math.max(0, Math.floor(Number(body.chapter) || 0));
    const occurrence = Math.max(1, Math.floor(Number(body.occurrence) || 1));
    const catalogRev = await catalogGlossaryRev(env.BOOKS, bookId, { bypassCache: true });
    const rev = catalogRev || (typeof body.rev === "string" && body.rev.trim() ? body.rev.trim().slice(0, 100) : "");
    const now = options?.now ?? Date.now();

    await env.DB.prepare(
      `UPDATE book_word_taps
       SET status = 'resolved', resolved_at = ?, resolved_rev = ?
       WHERE book_id = ? AND word = ? AND chapter = ? AND occurrence = ?`,
    )
      .bind(now, rev, bookId, word, chapter, occurrence)
      .run();

    return json({ ok: true, resolved: true, resolvedRev: rev });
  } catch (error) {
    return errorResponse(error);
  }
}
