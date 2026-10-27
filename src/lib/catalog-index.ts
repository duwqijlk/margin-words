/**
 * Which of the site's two catalogs a book id is a row of. The app already downloads both catalogs at
 * start (Discover and the word-list update check), so the ids they hold are remembered here as they
 * arrive and a book open costs no extra request. Only when neither has answered yet does a lookup
 * load them itself (once per page).
 *
 * The answer is null for an id that is in neither catalog: a pack from another catalog address, or
 * a book that has left the catalog. Reports about it then carry no catalog reference, which is right:
 * there is no catalog row for the patrol to fix.
 */
import type { CatalogName } from "@/lib/catalog-id";

const known: Record<CatalogName, Set<string> | null> = { "word-lists": null, "public-books": null };

/** Called by the two catalog loaders with the ids they just read. */
export function noteCatalogIds(catalog: CatalogName, ids: Iterable<string>): void {
  known[catalog] = new Set(ids);
}

/** The answer from what is already known, or undefined while a catalog has not been read. */
function fromKnown(id: string): CatalogName | null | undefined {
  if (known["word-lists"]?.has(id)) return "word-lists";
  if (known["public-books"]?.has(id)) return "public-books";
  return known["word-lists"] && known["public-books"] ? null : undefined;
}

type Loaders = { wordLists: () => Promise<unknown>; publicBooks: () => Promise<unknown> };

/** The app's own catalog loaders, imported only when a lookup needs them (each notes its ids). */
const appLoaders: Loaders = {
  wordLists: async () => (await import("@/lib/word-list-catalog")).loadWordListCatalog(),
  publicBooks: async () => {
    const { loadCatalog, BUNDLED_CATALOG_URL } = await import("@/lib/packs");
    return loadCatalog(BUNDLED_CATALOG_URL);
  },
};
let loaders = appLoaders;

/** Tests only: replace the catalog loaders and forget what is known. */
export function setCatalogLoadersForTest(next: Loaders | null): void {
  loaders = next ?? appLoaders;
  known["word-lists"] = null;
  known["public-books"] = null;
  loading = null;
}

let loading: Promise<void> | null = null;

/** Read both catalogs once, if the app has not already. A failure leaves that catalog unknown. */
function loadBoth(): Promise<void> {
  loading ??= Promise.all([
    known["word-lists"] ? null : loaders.wordLists().catch(() => null),
    known["public-books"] ? null : loaders.publicBooks().catch(() => null),
  ])
    .then(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * Which catalog `id` is a row of, or null when it is in neither. When a catalog could not be read,
 * an id found in the other one still answers; an id found in neither is null (not known to be one).
 */
export async function catalogOfId(id: string): Promise<CatalogName | null> {
  const now = fromKnown(id);
  if (now !== undefined) return now;
  await loadBoth();
  return fromKnown(id) ?? null;
}
