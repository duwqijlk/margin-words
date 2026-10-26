/**
 * The catalog id a report names: the `id` of a row in word-lists/catalog.json or
 * public-books/catalog.json (the same rule both catalogs use). Shared by the reader that sends it
 * and the Functions that store it, so the two sides cannot disagree about what is accepted.
 *
 * A report's `book_id` is the reader's own device id for the book and means nothing on another
 * device; `catalog_id` is what the patrol and the per-book credits use to find the book.
 */
export const CATALOG_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The catalog id, or "" when there is none (a list added by hand, a book without a catalog row). */
export function cleanCatalogId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id !== "custom" && CATALOG_ID.test(id) ? id : "";
}
