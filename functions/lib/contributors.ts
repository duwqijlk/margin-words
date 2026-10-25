import type { D1Database, R2BucketLike } from "./db.ts";

/**
 * The public file that credits readers: `contributors.json` on the books host.
 *
 *   { "format": 1, "updated": "<ISO>", "people": [
 *       { "id": "<public_id>", "name": "<nickname>", "helped": 3, "avatar": 2 }, ... ] }
 *
 * One row per reader with at least one accepted meaning, most help first. `avatar` is the version
 * of `avatars/<id>.webp` (absent when there is none). No email, no internal id.
 *
 * The card (credit on a meaning) and the Overview rank both read this one cached file, so showing
 * a credit costs no D1 read and no Function call. It is rebuilt after the daily patrol accepts
 * meanings (POST /api/contributors/rebuild by an admin, or this function from a script) and when a
 * credited reader changes their nickname or avatar.
 */
export const CONTRIBUTORS_KEY = "contributors.json";

export type ContributorRow = { id: string; name: string; helped: number; avatar?: number };

export async function contributorRows(db: D1Database): Promise<ContributorRow[]> {
  const rows = await db
    .prepare(
      `SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
              COUNT(DISTINCT f.book_id || ':' || f.word || ':' || f.chapter || ':' || f.occurrence) AS helped
         FROM word_feedback f JOIN users u ON u.id = f.user_id
        WHERE f.accepted_at > 0 AND u.public_id IS NOT NULL
        GROUP BY u.id
        ORDER BY helped DESC, MIN(f.accepted_at) ASC
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
  const people = await contributorRows(db);
  const file = { format: 1, updated: new Date(now).toISOString(), people };
  await bucket.put(CONTRIBUTORS_KEY, `${JSON.stringify(file)}\n`, { httpMetadata: CONTRIBUTORS_HTTP });
  return people.length;
}

/** Is this reader credited anywhere? Only then does a nickname or avatar change rebuild the file. */
export async function isContributor(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS yes FROM word_feedback WHERE user_id = ? AND accepted_at > 0 LIMIT 1")
    .bind(userId)
    .first<{ yes: number }>();
  return Boolean(row);
}
