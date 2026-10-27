import type { D1Database, R2BucketLike } from "./db.ts";
import { normalizeTitle } from "../../src/lib/book-title.ts";
import { catalogRef, cleanCatalogRef, type CatalogName } from "../../src/lib/catalog-id.ts";
import type { ContributorRow } from "./contributors.ts";

/**
 * Who maintains each catalog book: the readers whose explanations were accepted into its word
 * list, most help first. Written into contributors.json beside `people` (see contributors.ts), so a
 * cover shows its maintainers from the one cached file every page already loads.
 *
 *   "books": { "word-lists:wonder": { "count": 12, "top": ["<public_id>", "<public_id>", "<public_id>"] } }
 *
 * A report names its book by `catalog_id`. Reports made before that column existed have none; they
 * are matched by title, and only when the title names exactly ONE catalog book, so an unclear title
 * never credits the wrong book.
 */
export type BookMaintainers = { count: number; top: string[] };

/** How many maintainers a cover shows by face; the rest are a number. */
export const TOP_MAINTAINERS = 3;

type CatalogRow = { id?: unknown; title?: unknown };

/** Normalised title -> the one catalog book it names, or null when two books share it. */
async function titleIndex(bucket: R2BucketLike): Promise<Map<string, string | null>> {
  const index = new Map<string, string | null>();
  const sources: [CatalogName, string, "lists" | "packs"][] = [
    ["word-lists", "word-lists/catalog.json", "lists"],
    ["public-books", "public-books/catalog.json", "packs"],
  ];
  for (const [catalog, key, field] of sources) {
    try {
      const object = await bucket.get(key);
      if (!object) throw new Error(`Missing catalog: ${key}`);
      const data = JSON.parse(await new Response(object.body).text()) as Record<string, unknown>;
      if (!Array.isArray(data[field])) throw new Error(`Invalid catalog: ${key}`);
      const rows = data[field] as CatalogRow[];
      for (const row of rows) {
        const ref = catalogRef(catalog, row?.id);
        const title = typeof row?.title === "string" ? normalizeTitle(row.title) : "";
        if (!ref || !title) continue;
        index.set(title, index.has(title) && index.get(title) !== ref ? null : ref);
      }
    } catch (error) {
      throw new Error(`Cannot read catalog ${key}`, { cause: error });
    }
  }
  return index;
}

/** Per catalog book: how many readers maintained it, and the first few, most help first. */
export async function bookMaintainers(
  db: D1Database,
  bucket: R2BucketLike,
): Promise<{ books: Record<string, BookMaintainers>; readers: Map<string, ContributorRow> }> {
  const rows = await db
    .prepare(
      `WITH accepted AS (
         SELECT user_id, catalog_id, book_title,
                'w:' || book_id || ':' || word || ':' || chapter || ':' || occurrence AS place, accepted_at
           FROM word_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
         UNION ALL
         SELECT user_id, catalog_id, book_title,
                'p:' || book_id || ':' || chapter || ':' || paragraph || ':' || selected AS place, accepted_at
           FROM passage_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
       )
       SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
              a.catalog_id AS ref, a.book_title AS title,
              a.place AS place, MIN(a.accepted_at) AS first
         FROM accepted a JOIN users u ON u.id = a.user_id
        WHERE u.public_id IS NOT NULL
        GROUP BY u.id, a.catalog_id, a.book_title, a.place`,
    )
    .all<{ id: string; name: string; avatar: number | null; ref: string; title: string; place: string; first: number }>();
  // Count distinct places across all rows, just as contributorRows does, even when the same
  // place was reported with different titles or catalog references.
  const readerRows = new Map<string, ContributorRow>();
  const readerPlaces = new Map<string, Set<string>>();
  const needsTitles = rows.results.some((row) => !row.ref);
  const byTitle = needsTitles ? await titleIndex(bucket) : new Map<string, string | null>();
  // book -> reader -> distinct places and earliest acceptance
  const books = new Map<string, Map<string, { places: Set<string>; first: number }>>();
  for (const row of rows.results) {
    const places = readerPlaces.get(row.id) ?? new Set<string>();
    if (row.place !== null) places.add(row.place);
    readerPlaces.set(row.id, places);
    readerRows.set(row.id, {
      id: row.id, name: row.name, helped: places.size,
      ...(row.avatar ? { avatar: row.avatar } : {}),
    });
    const ref = row.ref ? cleanCatalogRef(row.ref) : byTitle.get(normalizeTitle(row.title ?? "")) || "";
    if (!ref) continue;
    const readers = books.get(ref) ?? new Map<string, { places: Set<string>; first: number }>();
    const seen = readers.get(row.id) ?? { places: new Set<string>(), first: Number.POSITIVE_INFINITY };
    if (row.place !== null) seen.places.add(row.place);
    seen.first = Math.min(seen.first, row.first);
    readers.set(row.id, seen);
    books.set(ref, readers);
  }
  const out: Record<string, BookMaintainers> = {};
  for (const [ref, readers] of [...books.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Most help first, then who helped first; the public id last, so two runs on the same data
    // always show the same faces.
    const ranked = [...readers.entries()].sort(
      ([idA, a], [idB, b]) => b.places.size - a.places.size || a.first - b.first || idA.localeCompare(idB),
    );
    out[ref] = { count: ranked.length, top: ranked.slice(0, TOP_MAINTAINERS).map(([id]) => id) };
  }
  return { books: out, readers: readerRows };
}
