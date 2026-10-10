import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { mergeWordListCatalog, type CatalogRow, type WordListCatalog } from "../../lib/word-list-publish.ts";

/**
 * Publish one word list from the admin page: the request body is the glossary
 * JSON file exactly as it should live on the books host. The server hashes
 * those bytes, writes the glossary, and rewrites word-lists/catalog.json with
 * only this row changed, so the hash and the file can never drift apart.
 *
 *   POST /api/admin/word-lists?id=<book id>   body: raw glossary JSON text
 *
 * The book must already exist in the live catalog; a brand-new book still goes
 * through scripts/publish-word-list.mjs, which also brings its metadata.
 */
export const onRequestPost = (context: { request: Request; env: Env }) => handlePublish(context.request, context.env);

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
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    const current = await bucket.get("word-lists/catalog.json");
    if (!current) throw new HttpError(500, "no-catalog");
    const live = JSON.parse(new TextDecoder().decode(await current.arrayBuffer())) as WordListCatalog;
    const existing = (live.lists ?? []).find((item) => item && item.id === id) as CatalogRow | undefined;
    if (!existing) throw new HttpError(404, "unknown-id");

    const row: CatalogRow = {
      ...existing,
      words,
      paragraphs,
      sentences,
      phrases,
      updated: new Date().toISOString(),
      glossary: { url: `${id}/glossary.json`, bytes: bytes.byteLength, sha256 },
    };
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
