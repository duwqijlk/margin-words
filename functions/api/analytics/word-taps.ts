import type { Env } from "../../lib/db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { assertDailyWriteBudget, assertIpRateLimit } from "../../lib/rate-limit.ts";
import { WORD_TAPS_MAX } from "../../../src/lib/limits.ts";
import { cleanCatalogRef } from "../../../src/lib/catalog-id.ts";


export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleWordTapsPost(context.request, context.env);

export async function handleWordTapsPost(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const body = (await readJson(request)) as {
      bookId?: unknown;
      bookTitle?: unknown;
      catalogId?: unknown;
      taps?: unknown;
    };
    const bookId = typeof body.bookId === "string" ? body.bookId.trim().slice(0, 64) : "";
    if (!bookId || !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(bookId)) {
      throw new HttpError(400, "bad-book");
    }

    const bookTitle =
      typeof body.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : "";
    const catalogId = cleanCatalogRef(body.catalogId);

    if (!Array.isArray(body.taps) || body.taps.length === 0 || body.taps.length > WORD_TAPS_MAX) {
      throw new HttpError(400, "bad-taps");
    }

    type CleanTap = {
      word: string;
      form: string;
      chapter: number;
      chapters: number;
      occurrence: number;
      paragraph: number;
      context: string;
      sentence: string;
      glossaryRev: string;
      count: number;
      inGlossary: number;
    };
    const clean: CleanTap[] = [];
    for (const item of body.taps) {
      if (!item || typeof item !== "object") continue;
      const record = item as {
        word?: unknown;
        form?: unknown;
        chapter?: unknown;
        chapters?: unknown;
        occurrence?: unknown;
        paragraph?: unknown;
        context?: unknown;
        sentence?: unknown;
        glossaryRev?: unknown;
        count?: unknown;
        inGlossary?: unknown;
      };
      const rawWord = typeof record.word === "string" ? record.word.trim().toLowerCase() : "";
      if (!rawWord || !/^[a-z]+(?:-[a-z]+)?$/.test(rawWord) || rawWord.length < 2 || rawWord.length > 48) {
        continue;
      }
      const rawForm =
        typeof record.form === "string" && record.form.trim()
          ? record.form.trim().toLowerCase().slice(0, 48)
          : rawWord;
      const chapter =
        typeof record.chapter === "number" && Number.isInteger(record.chapter) && record.chapter >= 0
          ? Math.min(record.chapter, 2000)
          : 0;
      // The reader's own copy may be split into a different number of chapters than the
      // word list; this count lets the patrol tell that the chapter number is not the list's.
      const chapters =
        typeof record.chapters === "number" && Number.isInteger(record.chapters) && record.chapters >= 0
          ? Math.min(record.chapters, 2000)
          : 0;
      const occurrence =
        typeof record.occurrence === "number" && Number.isInteger(record.occurrence) && record.occurrence >= 1
          ? Math.min(record.occurrence, 50000)
          : 1;
      const paragraph =
        typeof record.paragraph === "number" && Number.isInteger(record.paragraph) && record.paragraph >= 0
          ? Math.min(record.paragraph, 100000)
          : 0;
      const context =
        typeof record.context === "string" ? record.context.trim().slice(0, 300) : "";
      const sentence =
        typeof record.sentence === "string" ? record.sentence.trim().slice(0, 600) : "";
      const glossaryRev =
        typeof record.glossaryRev === "string" ? record.glossaryRev.trim().slice(0, 100) : "";

      const count =
        typeof record.count === "number" && Number.isSafeInteger(record.count) && record.count > 0
          ? Math.min(record.count, 100)
          : 1;
      // Only words with no meaning in the book are kept: they are what the word-list agent adds.
      // A word that has one is skipped here too, so an old client cannot keep writing them.
      if (record.inGlossary === true || record.inGlossary === 1) continue;
      const inGlossary = 0;
      clean.push({
        word: rawWord,
        form: rawForm,
        chapter,
        chapters,
        occurrence,
        paragraph,
        context,
        sentence,
        glossaryRev,
        count,
        inGlossary,
      });
    }

    if (clean.length === 0) {
      return json({ ok: true, saved: 0 });
    }

    const now = options?.now ?? Date.now();
    const ip = clientIp(request);
    await assertIpRateLimit(env.DB, "taps", ip, now);
    // A ceiling for the whole day, not just this address: the per-IP limit does not bound a
    // botnet, and every row here is a billable write.
    await assertDailyWriteBudget(env.DB, "taps", now, clean.length);

    const writeBatch = clean.map((item) =>
      env.DB.prepare(
        `INSERT INTO book_word_taps (
           book_id, book_title, catalog_id, word, form, chapter, chapters, occurrence, paragraph, context, sentence,
           glossary_rev, tap_count, in_glossary, last_tapped_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id, word, chapter, occurrence) DO UPDATE SET
           tap_count = book_word_taps.tap_count + excluded.tap_count,
           in_glossary = CASE WHEN excluded.in_glossary = 1 THEN 1 ELSE book_word_taps.in_glossary END,
           status = CASE WHEN excluded.in_glossary = 1 THEN 'resolved' ELSE book_word_taps.status END,
           book_title = CASE WHEN excluded.book_title != '' THEN excluded.book_title ELSE book_word_taps.book_title END,
           catalog_id = CASE WHEN excluded.catalog_id != '' THEN excluded.catalog_id ELSE book_word_taps.catalog_id END,
           form = CASE WHEN excluded.form != '' THEN excluded.form ELSE book_word_taps.form END,
           chapters = CASE WHEN excluded.chapters > 0 THEN excluded.chapters ELSE book_word_taps.chapters END,
           paragraph = excluded.paragraph,
           context = CASE WHEN excluded.context != '' THEN excluded.context ELSE book_word_taps.context END,
           sentence = CASE WHEN excluded.sentence != '' THEN excluded.sentence ELSE book_word_taps.sentence END,
           glossary_rev = CASE WHEN excluded.glossary_rev != '' THEN excluded.glossary_rev ELSE book_word_taps.glossary_rev END,
           last_tapped_at = excluded.last_tapped_at`,
      ).bind(
        bookId,
        bookTitle,
        catalogId,
        item.word,
        item.form,
        item.chapter,
        item.chapters,
        item.occurrence,
        item.paragraph,
        item.context,
        item.sentence,
        item.glossaryRev,
        item.count,
        item.inGlossary,
        now,
      ),
    );
    await env.DB.batch(writeBatch);

    return json({ ok: true, saved: clean.length });
  } catch (error) {
    return errorResponse(error);
  }
}
