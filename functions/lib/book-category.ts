import type { R2BucketLike } from "./db.ts";

const CATALOG_MS = 60_000;

type Cache = { at: number; speeches: Set<string> };

const catalogs = new WeakMap<object, Cache>();

function addSpeeches(set: Set<string>, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; category?: unknown };
    if (typeof row.id === "string" && row.category === "speech") set.add(row.id);
  }
}

async function loadSpeeches(bucket: R2BucketLike): Promise<Set<string>> {
  const set = new Set<string>();
  for (const key of ["word-lists/catalog.json", "public-books/catalog.json"]) {
    try {
      const object = await bucket.get(key);
      if (!object) continue;
      const catalog = JSON.parse(await new Response(object.body).text()) as { lists?: unknown; packs?: unknown };
      addSpeeches(set, catalog?.lists);
      addSpeeches(set, catalog?.packs);
    } catch {
      // One catalog can be missing. The other may still mark its speeches.
    }
  }
  return set;
}

/** Ids the live catalogs mark as speeches. Every other book counts as a novel. */
export async function speechIds(bucket: R2BucketLike | undefined): Promise<Set<string>> {
  if (!bucket) return new Set();
  const now = Date.now();
  let entry = catalogs.get(bucket);
  if (!entry || now - entry.at > CATALOG_MS) {
    entry = { at: now, speeches: await loadSpeeches(bucket) };
    catalogs.set(bucket, entry);
  }
  return entry.speeches;
}
