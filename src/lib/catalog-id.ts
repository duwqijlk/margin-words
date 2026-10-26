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

/** The id rule both catalogs use for their rows. */
export const CATALOG_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** One catalog book as stored, or "" when the value is not one. */
export function cleanCatalogRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = value.indexOf(":");
  if (at < 0) return "";
  const catalog = value.slice(0, at);
  return (CATALOGS as readonly string[]).includes(catalog)
    ? catalogRef(catalog as CatalogName, value.slice(at + 1))
    : "";
}

/** The reference for one catalog's row, or "" for a list the reader added ("custom") or a bad id. */
export function catalogRef(catalog: CatalogName, id: unknown): string {
  if (typeof id !== "string" || id === "custom" || !CATALOG_ID.test(id)) return "";
  return `${catalog}:${id}`;
}
