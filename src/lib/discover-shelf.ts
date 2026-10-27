import { sameCatalogBook, uniqueBookRecord } from "@/lib/catalog-shelf-identity";
import type { Identity } from "@/lib/shelf-identity";
import type { CatalogName } from "@/lib/catalog-id";

type ShelfBook = Identity & { id: string; source?: string; needsEpub?: boolean };
type InstallRecord = { bookId: string; packId: string; catalog?: CatalogName; listSource?: string };
type Wanted = Identity & { id: string; catalog?: CatalogName; catalogCollision?: boolean };

/** Shelf membership survives sync; an ambiguous target is not an invitation to install. */
export function discoverShelfBook<B extends ShelfBook, R extends InstallRecord>(
  shelf: B[], records: R[], wanted: Wanted,
): { book: B | undefined; record: R | undefined; ambiguous?: boolean } {
  const absent = { book: undefined, record: undefined };
  const ambiguous = { ...absent, ambiguous: true };
  const live = new Map(shelf.map((book) => [book.id, book]));
  const sameCatalog = (record: R) => !wanted.catalog || !record.catalog || wanted.catalog === record.catalog;
  const candidates = records.filter((record) =>
    (record.listSource && record.listSource !== "custom" ? record.listSource : record.packId) === wanted.id && live.has(record.bookId) && sameCatalog(record),
  );
  if (wanted.catalogCollision && candidates.some((record) => !record.catalog)) return ambiguous;
  const directIds = new Set(candidates.map((record) => record.bookId));
  if (directIds.size > 1) return ambiguous;
  if (directIds.size === 1) {
    const bookId = [...directIds][0]!;
    const record = uniqueBookRecord(records, bookId);
    return record ? { book: live.get(bookId), record } : ambiguous;
  }
  const known = new Set(records.filter((record) => live.has(record.bookId)).map((record) => record.bookId));
  const hits = [...live.values()].filter((book) => {
    const own = records.filter((record) => record.bookId === book.id);
    if (own.some((record) => !sameCatalog(record))) return false;
    return (known.has(book.id) || book.source === "epub" || book.needsEpub) && sameCatalogBook(book, wanted);
  });
  if (hits.length > 1) return ambiguous;
  if (hits.length === 0) return absent;
  if (wanted.catalogCollision) return ambiguous;
  const book = hits[0]!;
  if (known.has(book.id) && !uniqueBookRecord(records, book.id)) return ambiguous;
  return { book, record: uniqueBookRecord(records, book.id) };
}
