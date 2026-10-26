/**
 * One writer at a time for each catalog file on the books host.
 *
 * A catalog is a single JSON file: a publish reads it, changes one row and writes all of it back.
 * Two publishes at the same moment would each write a copy that lacks the other's row. Each
 * writer holds this lock (a row in D1) from reading the catalog to writing it back, so a second
 * writer waits for the first instead of overwriting it.
 *
 * A lock left by a request that died ends by itself after LOCK_MS.
 */
import type { D1Database, R2BucketLike } from "./db.ts";
import { HttpError } from "./http.ts";

export const CATALOG_LOCK_MS = 60_000;
const WAIT_MS = 15_000;
const STEP_MS = 250;

export type CatalogName = "word-lists/catalog.json" | "public-books/catalog.json";

/** Take the lock on `catalog`, waiting up to WAIT_MS for another writer to finish. */
async function lock(db: D1Database, catalog: CatalogName, owner: string, now: () => number): Promise<void> {
  const deadline = now() + WAIT_MS;
  for (;;) {
    const at = now();
    // One statement: take a free or expired lock, never one another writer holds.
    const taken = await db
      .prepare(
        `INSERT INTO catalog_locks (name, owner, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
           WHERE catalog_locks.expires_at <= ?4
         RETURNING owner`,
      )
      .bind(catalog, owner, at + CATALOG_LOCK_MS, at)
      .first<{ owner: string }>();
    if (taken?.owner === owner) return;
    if (now() >= deadline) throw new HttpError(409, "catalog-busy");
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
  }
}

async function unlock(db: D1Database, catalog: CatalogName, owner: string): Promise<void> {
  await db.prepare("DELETE FROM catalog_locks WHERE name = ? AND owner = ?").bind(catalog, owner).run();
}

type FileWrite = { key: string; bytes: Uint8Array; options?: Parameters<R2BucketLike["put"]>[2] };

/**
 * Write the book's files, then the catalog that names their hashes. Readers check a file against
 * the catalog's sha256, so a file must never change without the catalog: when the catalog write
 * fails, each file is put back the way it was (a file that was not there before stays new, which
 * nothing points at). The error is passed on.
 */
export async function publishWithCatalog(
  bucket: R2BucketLike,
  files: FileWrite[],
  catalog: CatalogName,
  catalogBytes: Uint8Array,
): Promise<void> {
  const before: { key: string; bytes: Uint8Array | null; options?: FileWrite["options"] }[] = [];
  for (const file of files) {
    const old = await bucket.get(file.key);
    before.push({ key: file.key, bytes: old ? new Uint8Array(await old.arrayBuffer()) : null, options: file.options });
  }
  try {
    for (const file of files) await bucket.put(file.key, file.bytes, file.options);
    await bucket.put(catalog, catalogBytes);
  } catch (error) {
    for (const old of before) {
      if (old.bytes) await bucket.put(old.key, old.bytes, old.options).catch(() => undefined);
    }
    throw error;
  }
}

/** Run `work` while holding the lock on `catalog`. The lock is released even when `work` throws. */
export async function withCatalogLock<T>(
  db: D1Database,
  catalog: CatalogName,
  work: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const owner = crypto.randomUUID();
  await lock(db, catalog, owner, now);
  try {
    return await work();
  } finally {
    await unlock(db, catalog, owner);
  }
}
