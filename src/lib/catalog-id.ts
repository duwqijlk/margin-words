/**
 * The catalog book a report names: which catalog (the word lists or the public-domain books) and the
 * `id` of its row there. Shared by the reader that sends it and the Functions that store it, so the
 * two sides cannot disagree about what is accepted.
 *
 * Stored as `<catalog>:<id>`: `word-lists:wonder`, `public-books:alice`. The two catalogs give out
 * ids on their own and nothing stops one id from appearing in both, so the prefix is what makes the
 * value name one book. A report's `book_id` is the reader's own device id for the book and means
 * nothing on another device; this is what the patrol and the per-book credits use to find the book.
 */
export const CATALOGS = ["word-lists", "public-books"] as const;
export type CatalogName = (typeof CATALOGS)[number];

/** Is `value` one of the site's catalogs? */
export function isCatalogName(value: unknown): value is CatalogName {
  return typeof value === "string" && (CATALOGS as readonly string[]).includes(value);
}

/** The id rule both catalogs use for their rows. */
export const CATALOG_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** One catalog book as stored, or "" when the value is not one. */
export function cleanCatalogRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = value.indexOf(":");
  if (at < 0) return "";
  const catalog = value.slice(0, at);
  return isCatalogName(catalog) ? catalogRef(catalog, value.slice(at + 1)) : "";
}

/** The reference for one catalog's row, or "" for a list the reader added ("custom") or a bad id. */
export function catalogRef(catalog: CatalogName, id: unknown): string {
  if (typeof id !== "string" || id === "custom" || !CATALOG_ID.test(id)) return "";
  return `${catalog}:${id}`;
}

/**
 * The catalog book a report about this book's list names, from what the device knows:
 * - `source`: the list in use (`BookExtras.source`; "custom" for a list the reader added);
 * - `recorded`: the catalog the install recorded (`BookExtras.catalog`; absent on older installs);
 * - `packId`: the install record of the book (`PackRecord.packId`), which every install writes;
 * - `catalogOf`: which catalog holds an id, for books installed before the catalog was recorded.
 * A list the reader added names no catalog book, even on a book that came from a catalog.
 */
export async function bookCatalogRef(input: {
  source?: string;
  recorded?: CatalogName;
  packId?: string;
  catalogOf: (id: string) => Promise<CatalogName | null>;
}): Promise<string> {
  if (input.source === "custom") return "";
  const id = input.source || input.packId || "";
  if (!CATALOG_ID.test(id)) return "";
  const catalog = input.recorded ?? (await input.catalogOf(id).catch(() => null));
  return catalog ? catalogRef(catalog, id) : "";
}
