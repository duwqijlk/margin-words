import { isbnDigits } from "@/lib/book-meta";
import { normalizeTitle } from "@/lib/book-title";
import { rankEntries, sameAuthor, type Identity, type MergePlan, type ShelfEntry } from "@/lib/shelf-identity";

/** Catalog recovery must not use the broad main-title keys used by older import flows. */
export function sameCatalogBook(a: Identity, b: Identity): boolean {
  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  if (!titleA || !titleB) return false;
  const isbnA = isbnDigits(a.isbn);
  const isbnB = isbnDigits(b.isbn);
  if (isbnA && isbnB && isbnA !== isbnB) return false;
  return titleA === titleB && sameAuthor(a.author, b.author);
}

type RecordIdentity = { bookId: string; packId: string };

/** Multiple rows for one target are harmless; conflicting identities are not. */
export function uniqueBookRecord<R extends RecordIdentity>(records: R[], bookId: string): R | undefined {
  const matches = records.filter((record) => record.bookId === bookId);
  return new Set(matches.map((record) => record.packId)).size === 1 ? matches[0] : undefined;
}

type RepairEntry = ShelfEntry & { catalogIds: { id: string; catalog?: string }[] };

function compatible(a: RepairEntry, b: RepairEntry): boolean {
  if (!sameCatalogBook(a, b)) return false;
  const identities = [...a.catalogIds, ...b.catalogIds];
  if (new Set(identities.map((identity) => identity.id)).size > 1) return false;
  const catalogs = identities.map((identity) => identity.catalog).filter(Boolean);
  if (new Set(catalogs).size > 1) return false;
  return true;
}

/** Every pair must agree: a metadata-poor card must not bridge two distinct volumes. */
export function planSafeShelfMerges(entries: RepairEntry[]): MergePlan[] {
  const groups: RepairEntry[][] = [];
  for (const entry of entries) {
    const matches = groups.filter((group) => group.some((other) => compatible(entry, other)));
    if (matches.length === 0) groups.push([entry]);
    else {
      const joined = [entry, ...matches.flat()];
      for (const group of matches) groups.splice(groups.indexOf(group), 1);
      groups.push(joined);
    }
  }
  return groups.filter((group) => group.length > 1 && group.every((entry, index) =>
    group.slice(index + 1).every((other) => compatible(entry, other)),
  )).map((group) => {
    const [keep, ...drop] = rankEntries(group) as [ShelfEntry, ...ShelfEntry[]];
    return { keep, drop };
  });
}
