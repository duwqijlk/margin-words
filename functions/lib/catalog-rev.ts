import type { R2BucketLike } from "./db.ts";

const CATALOG_MS = 60_000;

type CatalogCache = { at: number; revById: Map<string, string> };

const catalogRevs = new WeakMap<object, CatalogCache>();

function addRevs(map: Map<string, string>, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      glossary?: { sha256?: unknown };
    };
    if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)) continue;
    const sha = typeof row.glossary?.sha256 === "string" ? row.glossary.sha256 : "";
    const rev = sha.slice(0, 12) || row.id;
    map.set(row.id, rev);
  }
}

async function readCatalogJson(bucket: R2BucketLike, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) return null;
  const text = await new Response(object.body).text();
  return JSON.parse(text) as unknown;
}

async function loadRevs(bucket: R2BucketLike): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const key of ["word-lists/catalog.json", "public-books/catalog.json"]) {
    try {
      const catalog = await readCatalogJson(bucket, key);
      if (!catalog || typeof catalog !== "object") continue;
      const record = catalog as { lists?: unknown; packs?: unknown };
      addRevs(map, record.lists);
      addRevs(map, record.packs);
    } catch {
      // One catalog may be missing or invalid
    }
  }
  return map;
}

export async function catalogGlossaryRev(bucket: R2BucketLike | undefined, bookId: string): Promise<string> {
  if (!bucket) return "";
  const now = Date.now();
  let entry = catalogRevs.get(bucket);
  if (!entry || now - entry.at > CATALOG_MS) {
    entry = { at: now, revById: await loadRevs(bucket) };
    catalogRevs.set(bucket, entry);
  }
  return entry.revById.get(bookId) ?? "";
}
