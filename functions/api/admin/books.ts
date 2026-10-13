import { requireAdmin } from "../../lib/admin.ts";
import { replacesSameBook } from "../../lib/book-title.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import { sha256HexBytes } from "../../lib/password.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";

const EPUB_MAX = 80_000_000;
const COVER_MAX = 5_000_000;
const GLOSSARY_MAX = 4_000_000;

/**
 * The Discover card reads its picture from the books host
 * (`word-lists/<id>/cover.jpg` + the row's cover field). The word-list row
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
  const catalogObject = await env.BOOKS.get("word-lists/catalog.json");
  if (!catalogObject) throw new HttpError(500, "no-catalog");
  const live = JSON.parse(new TextDecoder().decode(await catalogObject.arrayBuffer())) as {
    lists?: { id: string; cover?: unknown }[];
  };
  const row = (live.lists ?? []).find((item) => item && item.id === id);
  if (!row) throw new HttpError(409, "cover-not-saved");
  await env.BOOKS.put(`word-lists/${id}/cover.jpg`, coverBytes);
  row.cover = { url: `${id}/cover.jpg`, bytes: coverBytes.length, sha256: await sha256HexBytes(coverBytes) };
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
 * in place. A brand-new public book still needs the local build, because its
 * catalog row carries fields (rev, version, chapters, coined) that come from the
 * offline pipeline.
 */
export const onRequestPost = (context: { request: Request; env: Env }) => handleUpload(context.request, context.env);

export async function handleUpload(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(400, "bad-id");
    const kind = url.searchParams.get("kind") === "public" ? "public" : "private";

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
    const glossarySha = await sha256HexBytes(glossaryBytes);

    const catalogObject = await bucket.get("public-books/catalog.json");
    if (!catalogObject) throw new HttpError(500, "no-catalog");
    const live = JSON.parse(new TextDecoder().decode(await catalogObject.arrayBuffer())) as {
      packs?: { id: string; epub?: unknown; glossary?: unknown; cover?: unknown; updated?: string }[];
    };
    const row = (live.packs ?? []).find((item) => item && item.id === id);
    if (!row) throw new HttpError(404, "unknown-id");

    await bucket.put(epubKey, epubBytes);
    await bucket.put(`public-books/${id}/glossary.json`, glossaryBytes);
    if (coverBytes) await bucket.put(coverKey, coverBytes);
    row.epub = { url: `${id}/book.epub`, bytes: epubBytes.length, sha256: epubSha };
    row.glossary = { url: `${id}/glossary.json`, bytes: glossaryBytes.length, sha256: glossarySha, rev: glossarySha.slice(0, 12) };
    if (coverBytes) row.cover = { url: `${id}/cover.jpg`, bytes: coverBytes.length, sha256: coverSha };
    row.updated = new Date().toISOString();
    await bucket.put("public-books/catalog.json", new TextEncoder().encode(`${JSON.stringify(live, null, 1)}\n`));
    return json({
      kind,
      epub: { bytes: epubBytes.length, sha256: epubSha },
      glossary: { bytes: glossaryBytes.length, sha256: glossarySha },
      cover: coverBytes ? { bytes: coverBytes.length, sha256: coverSha } : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
