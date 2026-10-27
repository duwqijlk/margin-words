import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import { sha256HexBytes } from "../../lib/password.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { normalizeTitle, replacesSameBook } from "../../lib/book-title.ts";
import { GLOSSARY_MAX } from "../../lib/glossary-limit.ts";
import { clearGlossaryWork } from "../../lib/glossary-work-file.ts";
import { applyIsbn, assertPublicPublishBudget, checkPublicGlossary, fileRef, updatePublicRow } from "../../lib/public-book-publish.ts";
import { mergeWordListCatalog, type CatalogRow, type WordListCatalog } from "../../lib/word-list-publish.ts";
import { applyCategory, applySeries } from "../../lib/book-category.ts";
import { publishWithCatalog, withCatalogLock } from "../../lib/catalog-lock.ts";

/**
 * Publish word lists from the admin page: the request body is the glossary
 * JSON file exactly as it should live on the books host. The server hashes
 * those bytes, writes the glossary, and rewrites word-lists/catalog.json with
 * only this row changed, so the hash and the file can never drift apart.
 *
 *   POST /api/admin/word-lists?id=<book id>   body: raw glossary JSON text
 *   POST /api/admin/word-lists?id=<book id>&catalog=public
 *   &category=novel|speech sets which Discover tab and which weekly count the book belongs to.
 *   &series=<name>&seriesNumber=<n> sets its series row (an empty name removes it).
 *
 * A book that is already in the catalog is updated in place when this file is
 * that same book (the same title, or no title). A file whose title is a
 * different book is refused, so a new book cannot reuse the id and leave
 * Discover showing the old name. A new id is onboarded from the glossary's
 * own metadata (title, author, lexile, isbn, series, category) — no cover,
 * so the app keeps its generated one.
 * catalog=public updates the glossary of a public-domain book already in
 * public-books/catalog.json. It does not add a new public book, and it does
 * not write the word-list catalog.
 */
export const onRequestPost = (context: { request: Request; env: Env }) => handlePublish(context.request, context.env);

function rowFromGlossary(
  id: string,
  record: Record<string, unknown>,
  counts: { words: number; paragraphs: number; sentences: number; phrases: number; bytes: number; sha256: string },
): CatalogRow {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const lexile = text(record.lexile);
  const isbn = text(record.isbn);
  const series = text(record.series);
  const seriesNumber = typeof record.seriesNumber === "number" ? record.seriesNumber : undefined;
  const category = record.category === "speech" ? "speech" : undefined;
  return {
    id,
    title: text(record.title) ?? id,
    author: text(record.author) ?? "",
    ...(lexile ? { lexile } : {}),
    ...(isbn ? { isbn } : {}),
    ...(series ? { series, ...(seriesNumber ? { seriesNumber } : {}) } : {}),
    ...(category ? { category } : {}),
    words: counts.words,
    paragraphs: counts.paragraphs,
    sentences: counts.sentences,
    phrases: counts.phrases,
    updated: new Date().toISOString(),
    glossary: { url: `${id}/glossary.json`, bytes: counts.bytes, sha256: counts.sha256 },
  };
}

export async function handlePublish(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(400, "bad-id");
    const isPublic = url.searchParams.get("catalog") === "public";
    if (isPublic) assertPublicPublishBudget(env);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    if (!bytes.length || bytes.length > GLOSSARY_MAX) throw new HttpError(413, "too-large");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(400, "bad-json");
    }
    const glossary = (data as { glossary?: unknown })?.glossary;
    if (!glossary || typeof glossary !== "object" || Array.isArray(glossary) || Object.keys(glossary).length === 0) {
      throw new HttpError(400, "bad-glossary");
    }
    const record = data as {
      count?: unknown;
      glossary: Record<string, unknown>;
      paragraphs?: unknown;
      sentences?: unknown;
      phrases?: unknown;
    };
    const words = Number(record.count) || Object.keys(record.glossary).length;
    const paragraphs = Array.isArray(record.paragraphs) ? record.paragraphs.length : 0;
    const sentences = Array.isArray(record.sentences) ? record.sentences.length : 0;
    const phrases = record.phrases && typeof record.phrases === "object" ? Object.keys(record.phrases).length : 0;

    const sha256 = await sha256HexBytes(bytes);
    const counts = { ...(isPublic ? checkPublicGlossary(data) : { words, paragraphs, sentences, phrases }), bytes: bytes.byteLength, sha256 };

    if (url.searchParams.get("catalog") === "public") {
      const row = await withCatalogLock(env.DB, "public-books/catalog.json", () =>
        updatePublicGlossary(bucket, id, bytes, counts, url.searchParams, data),
      );
      await clearGlossaryWork(bucket, "public", id);
      return json({ row, catalog: "public" });
    }

    // Read, change one row, write back: one publish at a time, or a second would drop the first's row.
    return await withCatalogLock(env.DB, "word-lists/catalog.json", async () => {
    const current = await bucket.get("word-lists/catalog.json");
    if (!current) throw new HttpError(500, "no-catalog");
    const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as WordListCatalog;
    const existing = (live.lists ?? []).find((item) => item && item.id === id) as CatalogRow | undefined;
    if (existing && !replacesSameBook(existing.title, (record as { title?: unknown }).title)) {
      throw new HttpError(409, "different-book");
    }
    if (!existing && typeof (record as { title?: unknown }).title !== "string") {
      // A new book needs at least a title from the glossary itself.
      throw new HttpError(404, "unknown-id");
    }
    if (!existing) {
      // A new id must not shadow a book that is already on the host under
      // another id: the same title means the file name is wrong, not that
      // this is a new book.
      const titleKey = normalizeTitle(String((record as Record<string, unknown>).title));
      const clash = (live.lists ?? []).find(
        (item) => typeof item?.title === "string" && normalizeTitle(item.title) === titleKey,
      );
      if (clash) throw new HttpError(409, "duplicate-title");
      const publicClash = await publicTitleClash(bucket, titleKey);
      if (publicClash) throw new HttpError(409, "duplicate-title");
    }

    const row: CatalogRow = existing
      ? {
          ...existing,
          words,
          paragraphs,
          sentences,
          phrases,
          updated: new Date().toISOString(),
          glossary: { ...fileRef(existing.glossary), url: `${id}/glossary.json`, bytes: bytes.byteLength, sha256 },
        }
      : rowFromGlossary(id, record as Record<string, unknown>, {
          words,
          paragraphs,
          sentences,
          phrases,
          bytes: bytes.byteLength,
          sha256,
        });
    applyIsbn(row, url.searchParams);
    applyCategory(row, url.searchParams.get("category"));
    applySeries(row, url.searchParams);
    const next = mergeWordListCatalog(live, row);
    const catalogBytes = new TextEncoder().encode(`${JSON.stringify(next, null, 1)}\n`);

    // The glossary goes first, the catalog last. If the catalog write fails the old glossary is
    // put back, so the file always matches the hash the catalog names.
    await publishWithCatalog(bucket, [{ key: `word-lists/${id}/glossary.json`, bytes }], "word-lists/catalog.json", catalogBytes);
    await clearGlossaryWork(bucket, "lists", id);
    return json({ row, lists: next.lists.length });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type PublicPack = Record<string, unknown> & {
  id: string;
  title?: string;
  rev?: string;
  words?: number;
  paragraphs?: number;
  sentences?: number;
  phrases?: number;
  updated?: string;
  previousUpdated?: string;
  epub?: unknown;
  glossary?: { url?: string; bytes?: number; sha256?: string; rev?: string };
};

/**
 * Replace the glossary of a public-domain book that is already on the host.
 * The EPUB stays. The catalog revision changes so a reader who has the book
 * is offered Update.
 */
async function updatePublicGlossary(
  bucket: NonNullable<Env["BOOKS"]>,
  id: string,
  bytes: Uint8Array,
  counts: { words: number; paragraphs: number; sentences: number; phrases: number; bytes: number; sha256: string },
  params: URLSearchParams,
  data: unknown,
): Promise<PublicPack> {
  const current = await bucket.get("public-books/catalog.json");
  if (!current) throw new HttpError(500, "no-catalog");
  const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as { packs?: PublicPack[]; updated?: string };
  const row = (live.packs ?? []).find((item) => item && item.id === id);
  if (!row) throw new HttpError(404, "unknown-id");
  await updatePublicRow(row, data, counts);
  applyIsbn(row, params);
  applyCategory(row, params.get("category"));
  applySeries(row, params);
  live.updated = row.updated;
  // The glossary goes first, the catalog last; a failed catalog write puts the old glossary back.
  await publishWithCatalog(
    bucket,
    [{ key: `public-books/${id}/glossary.json`, bytes }],
    "public-books/catalog.json",
    new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`),
  );
  return row;
}

async function publicTitleClash(bucket: NonNullable<Env["BOOKS"]>, titleKey: string): Promise<boolean> {
  const current = await bucket.get("public-books/catalog.json");
  if (!current) return false;
  const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as { packs?: PublicPack[] };
  return (live.packs ?? []).some((item) => typeof item?.title === "string" && normalizeTitle(item.title) === titleKey);
}
