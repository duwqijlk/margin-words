import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import { sha256HexBytes } from "../../lib/password.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { mergeWordListCatalog, type CatalogRow, type WordListCatalog } from "../../lib/word-list-publish.ts";

/**
 * Publish word lists from the admin page: the request body is the glossary
 * JSON file exactly as it should live on the books host. The server hashes
 * those bytes, writes the glossary, and rewrites word-lists/catalog.json with
 * only this row changed, so the hash and the file can never drift apart.
 *
 *   POST /api/admin/word-lists?id=<book id>   body: raw glossary JSON text
 *   POST /api/admin/word-lists?id=<book id>&catalog=public
 *
 * A book that is already in the catalog is updated in place. A new id is
 * onboarded from the glossary's own metadata (title, author, lexile, isbn,
 * series, category) — no cover, so the app keeps its generated one.
 * catalog=public updates the glossary of a public-domain book already in
 * public-books/catalog.json. It does not add a new public book, and it does
 * not write the word-list catalog.
 */
export const onRequestPost = (context: { request: Request; env: Env }) => handlePublish(context.request, context.env);

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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
    const text = await request.text();
    if (!text || text.length > 4_000_000) throw new HttpError(413, "too-large");
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

    const bytes = new TextEncoder().encode(text);
    const sha256 = await sha256HexBytes(bytes);
    const counts = { words, paragraphs, sentences, phrases, bytes: bytes.byteLength, sha256 };

    if (url.searchParams.get("catalog") === "public") {
      const row = await updatePublicGlossary(bucket, id, bytes, counts);
      return json({ row, catalog: "public" });
    }

    const current = await bucket.get("word-lists/catalog.json");
    if (!current) throw new HttpError(500, "no-catalog");
    const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as WordListCatalog;
    const existing = (live.lists ?? []).find((item) => item && item.id === id) as CatalogRow | undefined;
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
          glossary: { url: `${id}/glossary.json`, bytes: bytes.byteLength, sha256 },
        }
      : rowFromGlossary(id, record as Record<string, unknown>, {
          words,
          paragraphs,
          sentences,
          phrases,
          bytes: bytes.byteLength,
          sha256,
        });
    // ?isbn= overrides the edition number: a value sets it, an empty value clears it.
    if (url.searchParams.has("isbn")) {
      const isbn = (url.searchParams.get("isbn") ?? "").trim();
      if (isbn) row.isbn = isbn;
      else delete row.isbn;
    }
    const next = mergeWordListCatalog(live, row);
    const catalogBytes = new TextEncoder().encode(`${JSON.stringify(next, null, 1)}\n`);

    // The glossary goes first: if the catalog write fails, Discover keeps
    // pointing at the previous file, which is still on the host.
    await bucket.put(`word-lists/${id}/glossary.json`, bytes);
    await bucket.put("word-lists/catalog.json", catalogBytes);
    return json({ row, lists: next.lists.length });
  } catch (error) {
    return errorResponse(error);
  }
}

type PublicPack = {
  id: string;
  title?: string;
  rev?: string;
  words?: number;
  paragraphs?: number;
  sentences?: number;
  phrases?: number;
  updated?: string;
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
): Promise<PublicPack> {
  const current = await bucket.get("public-books/catalog.json");
  if (!current) throw new HttpError(500, "no-catalog");
  const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as { packs?: PublicPack[]; updated?: string };
  const row = (live.packs ?? []).find((item) => item && item.id === id);
  if (!row) throw new HttpError(404, "unknown-id");
  const rev = counts.sha256.slice(0, 12);
  row.words = counts.words;
  row.paragraphs = counts.paragraphs;
  row.sentences = counts.sentences;
  row.phrases = counts.phrases;
  row.updated = new Date().toISOString();
  row.rev = rev;
  row.glossary = { url: `${id}/glossary.json`, bytes: counts.bytes, sha256: counts.sha256, rev };
  live.updated = row.updated;
  // The glossary goes first: if the catalog write fails, Discover keeps the previous file.
  await bucket.put(`public-books/${id}/glossary.json`, bytes);
  await bucket.put("public-books/catalog.json", new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`));
  return row;
}

async function publicTitleClash(bucket: NonNullable<Env["BOOKS"]>, titleKey: string): Promise<boolean> {
  const current = await bucket.get("public-books/catalog.json");
  if (!current) return false;
  const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as { packs?: PublicPack[] };
  return (live.packs ?? []).some((item) => typeof item?.title === "string" && normalizeTitle(item.title) === titleKey);
}
