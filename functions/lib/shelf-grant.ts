import { sameBook, type BookIdentity } from "./book-match.ts";
import type { D1Database, R2BucketLike } from "./db.ts";

const CATALOG_MS = 60_000;

type Cache = { at: number; byId: Map<string, BookIdentity> };

const catalogs = new WeakMap<object, Cache>();

function addBooks(map: Map<string, BookIdentity>, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; title?: unknown; author?: unknown; isbn?: unknown };
    if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id) || map.has(row.id)) continue;
    map.set(row.id, {
      title: typeof row.title === "string" ? row.title : "",
      author: typeof row.author === "string" ? row.author : "",
      isbn: typeof row.isbn === "string" ? row.isbn : "",
    });
  }
}

async function readCatalog(bucket: R2BucketLike, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) return null;
  const text = await new Response(object.body).text();
  return JSON.parse(text) as unknown;
}

async function loadCatalogs(bucket: R2BucketLike): Promise<Map<string, BookIdentity>> {
  const map = new Map<string, BookIdentity>();
  for (const key of ["word-lists/catalog.json", "public-books/catalog.json"]) {
    try {
      const catalog = await readCatalog(bucket, key);
      if (!catalog || typeof catalog !== "object") continue;
      const record = catalog as { lists?: unknown; packs?: unknown };
      addBooks(map, record.lists);
      addBooks(map, record.packs);
    } catch {
      // One catalog can be missing. The other may still name the book.
    }
  }
  return map;
}

async function catalogBook(bucket: R2BucketLike, id: string): Promise<BookIdentity | null> {
  const now = Date.now();
  let entry = catalogs.get(bucket);
  if (!entry || now - entry.at > CATALOG_MS) {
    entry = { at: now, byId: await loadCatalogs(bucket) };
    catalogs.set(bucket, entry);
  }
  return entry.byId.get(id) ?? null;
}

/**
 * True when this word list is a book already on the reader's shelf before the
 * weekly cap. The snapshot is taken once, in migration 0006. A shelf card
 * uploaded later does not unlock a list, so the cap still stops a bulk download.
 */
export async function shelfGrantsBook(
  db: D1Database,
  bucket: R2BucketLike,
  userId: string,
  bookId: string,
): Promise<boolean> {
  const book = await catalogBook(bucket, bookId);
  if (!book?.title.trim()) return false;
  const rows = await db
    .prepare(
      "SELECT grant_title, grant_author, grant_isbn FROM sync_items WHERE user_id = ? AND kind = 'shelf' AND deleted = 0 AND grant_title != ''",
    )
    .bind(userId)
    .all<{ grant_title: string; grant_author: string; grant_isbn: string }>();
  return rows.results.some((row) =>
    sameBook(book, { title: row.grant_title, author: row.grant_author ?? "", isbn: row.grant_isbn ?? "" }),
  );
}
