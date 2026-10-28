import { requireAdmin } from "../../lib/admin.ts";
import { applyIsbn, assertPublicPublishBudget, checkPublicGlossary, fileRef, updatePublicRow } from "../../lib/public-book-publish.ts";
import { clearGlossaryWork } from "../../lib/glossary-work-file.ts";
import { replacesSameBook } from "../../lib/book-title.ts";
import { LEGACY_ID } from "../../lib/book-id.ts";
import { GLOSSARY_MAX } from "../../lib/glossary-limit.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import { applyCategory, applySeries } from "../../lib/book-category.ts";
import { publishWithCatalog, withCatalogLock } from "../../lib/catalog-lock.ts";
import { sha256HexBytes } from "../../lib/password.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";

const EPUB_MAX = 80_000_000;
const COVER_MAX = 5_000_000;

/** Public host base for absolute cover addresses in the catalogs. */
const BOOKS_HOST = "https://books.inputread.site";

/**
 * Card covers live at covers/<kind>-<id>.jpg on the books host: outside word-lists/ and public-books/,
 * so no Worker runs on a cover load, and kept for a year. The catalog row gives the address with the
 * picture's sha256, and the page adds ?v=<sha>, so a new cover is a new address.
 */
async function putPublicCover(env: Env, kind: "lists" | "public", id: string, bytes: Uint8Array) {
  if (!env.BOOKS) throw new HttpError(500, "no-books-bucket");
  const key = `covers/${kind}-${id}.jpg`;
  await env.BOOKS.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
  });
  return { url: `${BOOKS_HOST}/${key}`, bytes: bytes.length, sha256: await sha256HexBytes(bytes) };
}

/**
 * The Discover card reads its picture from the books host
 * (`covers/lists-<id>.jpg`, named by the row's cover field). The word-list row
 * is written before the book upload, so a chosen cover that cannot land on
 * that row fails the upload instead of leaving the generated card.
 */
/**
 * The book upload follows the word-list upload and can replace the private EPUB.
 * Refuse before writing anything when the attached glossary names a different book
 * than the catalog row for this id.
 */
async function refuseDifferentBook(env: Env, id: string, glossary: FormDataEntryValue | null): Promise<void> {
  if (!(glossary instanceof File) || glossary.size === 0 || !env.BOOKS) return;
  const catalogObject = await env.BOOKS.get("word-lists/catalog.json");
  if (!catalogObject) return;
  const live = JSON.parse(new TextDecoder().decode(await catalogObject.arrayBuffer())) as {
    lists?: { id: string; title?: unknown }[];
  };
  const row = (live.lists ?? []).find((item) => item && item.id === id);
  if (!row) return;
  let data: unknown;
  try {
    data = JSON.parse(await glossary.text());
  } catch {
    throw new HttpError(400, "bad-json");
  }
  if (!replacesSameBook(row.title, (data as { title?: unknown })?.title)) throw new HttpError(409, "different-book");
}

async function putCardCover(env: Env, id: string, coverBytes: Uint8Array | null): Promise<void> {
  if (!coverBytes) return;
  if (!env.BOOKS) throw new HttpError(500, "no-books-bucket");
  await withCatalogLock(env.DB, "word-lists/catalog.json", () => putCardCoverLocked(env, id, coverBytes));
}

async function putCardCoverLocked(env: Env, id: string, coverBytes: Uint8Array): Promise<void> {
  if (!env.BOOKS) throw new HttpError(500, "no-books-bucket");
  const catalogObject = await env.BOOKS.get("word-lists/catalog.json");
  if (!catalogObject) throw new HttpError(500, "no-catalog");
  const live = JSON.parse(new TextDecoder().decode(await catalogObject.arrayBuffer())) as {
    lists?: { id: string; cover?: unknown }[];
  };
  const row = (live.lists ?? []).find((item) => item && item.id === id);
  if (!row) throw new HttpError(409, "cover-not-saved");
  row.cover = { ...fileRef(row.cover), ...await putPublicCover(env, "lists", id, coverBytes) };
  await env.BOOKS.put("word-lists/catalog.json", new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`));
}

/**
 * Upload the book file that belongs to a word list.
 *
 *   POST /api/admin/books?id=<id>&kind=private|public
 *   multipart/form-data: epub (required), glossary (required for public), cover (optional)
 *
 * kind=private puts the EPUB (and cover) into the PRIVATE bucket under
 * `<id>/book.epub`, where only trusted accounts can stream it.
 * kind=public puts `public-books/<id>/book.epub`, `glossary.json`, and the cover
 * into the BOOKS bucket and updates that book's row in public-books/catalog.json
 * in place, including revisions and counts. Only existing public ids are supported.
 */
export const onRequestPost = (context: { request: Request; env: Env }) => handleUpload(context.request, context.env);

export async function handleUpload(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    if (!LEGACY_ID.test(id)) throw new HttpError(400, "bad-id");
    const kind = url.searchParams.get("kind") === "public" ? "public" : "private";
    if (kind === "public") assertPublicPublishBudget(env);

    const form = await request.formData();
    const epub = form.get("epub");
    if (!(epub instanceof File) || epub.size === 0) throw new HttpError(400, "no-epub");
    if (epub.size > EPUB_MAX) throw new HttpError(413, "too-large");
    const coverFile = form.get("cover");
    if (coverFile instanceof Blob && coverFile.size > COVER_MAX) throw new HttpError(413, "too-large");
    const coverBytes =
      coverFile instanceof Blob && coverFile.size > 0 ? new Uint8Array(await coverFile.arrayBuffer()) : null;

    const epubBytes = new Uint8Array(await epub.arrayBuffer());
    const epubSha = await sha256HexBytes(epubBytes);
    const coverSha = coverBytes ? await sha256HexBytes(coverBytes) : null;
    const epubKey = kind === "public" ? `public-books/${id}/book.epub` : `${id}/book.epub`;
    const coverKey = kind === "public" ? `public-books/${id}/cover.jpg` : `${id}/cover.jpg`;

    if (kind === "private") {
      await refuseDifferentBook(env, id, form.get("glossary"));
      const bucket = env.PRIVATE;
      if (!bucket) throw new HttpError(500, "no-private-bucket");
      await bucket.put(epubKey, epubBytes);
      if (coverBytes) await bucket.put(coverKey, coverBytes);
      await putCardCover(env, id, coverBytes);
      return json({
        kind,
        epub: { bytes: epubBytes.length, sha256: epubSha },
        cover: coverBytes ? { bytes: coverBytes.length, sha256: coverSha } : null,
      });
    }

    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const glossary = form.get("glossary");
    if (!(glossary instanceof File) || glossary.size === 0) throw new HttpError(400, "no-glossary");
    if (glossary.size > GLOSSARY_MAX) throw new HttpError(413, "too-large");
    const glossaryBytes = new Uint8Array(await glossary.arrayBuffer());
    let glossaryData: unknown;
    try { glossaryData = JSON.parse(new TextDecoder().decode(glossaryBytes)); }
    catch { throw new HttpError(400, "bad-json"); }
    const counts = checkPublicGlossary(glossaryData);
    const glossarySha = await sha256HexBytes(glossaryBytes);

    return await withCatalogLock(env.DB, "public-books/catalog.json", async () => {
    const catalogObject = await bucket.get("public-books/catalog.json");
    if (!catalogObject) throw new HttpError(500, "no-catalog");
    const live = JSON.parse(new TextDecoder().decode(await catalogObject.arrayBuffer())) as {
      packs?: (Record<string, unknown> & { id: string })[];
      updated?: unknown;
    };
    const row = (live.packs ?? []).find((item) => item && item.id === id);
    if (!row) throw new HttpError(404, "unknown-id");

    await updatePublicRow(row, glossaryData, { ...counts, bytes: glossaryBytes.length, sha256: glossarySha }, { bytes: epubBytes.length, sha256: epubSha });
    if (coverBytes) row.cover = {
      ...fileRef(row.cover),
      url: `${BOOKS_HOST}/covers/public-${id}.jpg`, bytes: coverBytes.length, sha256: coverSha,
    };
    applyIsbn(row, url.searchParams);
    applyCategory(row, url.searchParams.get("category"));
    applySeries(row, url.searchParams);
    live.updated = row.updated;
    // Content (including the chosen cover) first, catalog last; restoration is best effort.
    await publishWithCatalog(
      bucket,
      [
        { key: epubKey, bytes: epubBytes },
        { key: `public-books/${id}/glossary.json`, bytes: glossaryBytes },
        ...(coverBytes ? [{ key: `covers/public-${id}.jpg`, bytes: coverBytes, options: {
          httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
        } }] : []),
      ],
      "public-books/catalog.json",
      new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`),
    );
    await clearGlossaryWork(bucket, "public", id);
    return json({
      row, rev: row.rev,
      kind,
      epub: { bytes: epubBytes.length, sha256: epubSha },
      glossary: { bytes: glossaryBytes.length, sha256: glossarySha },
      cover: coverBytes ? { bytes: coverBytes.length, sha256: coverSha } : null,
    });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
