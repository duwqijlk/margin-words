import type { D1Database, R2BucketLike } from "./db.ts";
import { bookMaintainers } from "./book-maintainers.ts";

/**
 * The public file that credits readers: `contributors.json` on the books host.
 *
 *   { "format": 1, "updated": "<ISO>", "people": [
 *       { "id": "<public_id>", "name": "<nickname>", "helped": 3, "avatar": 2 }, ... ],
 *     "books": { "word-lists:wonder": { "count": 12, "top": ["<public_id>", ...] }, ... } }
 *
 * One row per reader with at least one accepted meaning, most help first. `avatar` is the version
 * of `avatars/<id>-<avatar>.webp` (absent when there is none). No email, no internal id.
 *
 * The card (credit on a meaning) and the Overview rank both read this one cached file, so showing
 * a credit costs no D1 read and no Function call. It is rebuilt after the daily patrol accepts
 * meanings (POST /api/contributors/rebuild by an admin, or this function from a script) and when a
 * credited reader changes their nickname or avatar.
 *
 * `books` (book-maintainers.ts) lists, per catalog book, how many readers maintained it and the
 * first three; a cover shows them, and their names and pictures come from `people`.
 */
export const CONTRIBUTORS_KEY = "contributors.json";

export type ContributorRow = { id: string; name: string; helped: number; avatar?: number; rank?: number };

export async function contributorRows(db: D1Database): Promise<ContributorRow[]> {
  const rows = await db
    .prepare(
      `WITH accepted AS (
         SELECT user_id, 'w:' || book_id || ':' || word || ':' || chapter || ':' || occurrence AS place, accepted_at
           FROM word_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
         UNION ALL
         SELECT user_id, 'p:' || book_id || ':' || chapter || ':' || paragraph || ':' || selected AS place, accepted_at
           FROM passage_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
       )
       SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
              COUNT(DISTINCT a.place) AS helped
         FROM accepted a JOIN users u ON u.id = a.user_id
        WHERE u.public_id IS NOT NULL
        GROUP BY u.id
        ORDER BY helped DESC, MIN(a.accepted_at) ASC
        LIMIT 500`,
    )
    .all<{ id: string; name: string; avatar: number | null; helped: number }>();
  return rows.results.map((row) => ({
    id: row.id,
    // A reader with no nickname is credited as anonymous on the page, never by email.
    name: row.name,
    helped: row.helped,
    ...(row.avatar ? { avatar: row.avatar } : {}),
  }));
}

/**
 * Five minutes in the browser and the CDN: a new credit shows up to five minutes late, and a page
 * open is not an R2 read for every reader.
 */
export const CONTRIBUTORS_HTTP = { contentType: "application/json", cacheControl: "public, max-age=300" };

/** Write contributors.json. Returns how many readers it lists. */
export async function publishContributors(db: D1Database, bucket: R2BucketLike, now = Date.now()): Promise<number> {
  const [people, { books, readers }] = await Promise.all([contributorRows(db), bookMaintainers(db, bucket)]);
  // `people` keeps the top 500 by help; a maintainer a cover shows must be named there too.
  const listed = new Set(people.map((person) => person.id));
  const required = new Set(Object.values(books).flatMap((book) => book.top));
  // Keep the original SQL top 500 and its tie order. Rank every remaining reader, including
  // those not selected for a cover, before filtering; an extra's array index is not its rank.
  let rank = people.length;
  for (const [id, reader] of readers) {
    if (listed.has(id)) continue;
    rank++;
    if (required.has(id)) {
      people.push({ ...reader, rank });
      listed.add(id);
    }
  }
  // Stable sorting preserves the original top 500 tie order ahead of added maintainers.
  people.sort((a, b) => b.helped - a.helped);
  const file = { format: 1, updated: new Date(now).toISOString(), people, books };
  await bucket.put(CONTRIBUTORS_KEY, `${JSON.stringify(file)}\n`, { httpMetadata: CONTRIBUTORS_HTTP });
  return people.length;
}

/** Is this reader credited anywhere? Only then does a nickname or avatar change rebuild the file. */
export async function isContributor(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS yes FROM word_feedback WHERE user_id = ?1 AND accepted_at > 0
       UNION ALL
       SELECT 1 AS yes FROM passage_feedback WHERE user_id = ?1 AND accepted_at > 0
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ yes: number }>();
  return Boolean(row);
}
