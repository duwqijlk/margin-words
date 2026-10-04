/**
 * Decide how this device can fill a shelf card whose EPUB is not stored here.
 * The decision itself is `planFileOffer`. This file only loads the catalogs and the local pack record.
 */
import { bookFileExists, loadPackRecord, savePackRecord } from "@/lib/book-db";
import { planFileOffer, type FileOffer } from "@/lib/file-offer";
import { BUNDLED_CATALOG_URL, loadCatalog, type CatalogPack } from "@/lib/packs";
import { loadWordListCatalog } from "@/lib/word-list-catalog";

export type ResolvedOffer = {
  offer: FileOffer;
  classic: CatalogPack | null;
};

type ShelfCard = {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  needsEpub?: boolean;
};

export async function resolveFileOffer(book: ShelfCard): Promise<ResolvedOffer> {
  const fileHere = !book.needsEpub && (await bookFileExists(book.id).catch(() => false));
  let classics: CatalogPack[] = [];
  let lists: Awaited<ReturnType<typeof loadWordListCatalog>> = [];
  try {
    classics = (await loadCatalog(BUNDLED_CATALOG_URL)).catalog.packs;
  } catch {
    classics = [];
  }
  try {
    lists = await loadWordListCatalog();
  } catch {
    lists = [];
  }
  const known = await loadPackRecord(book.id).catch(() => null);
  const offer = planFileOffer({
    fileHere,
    needsEpub: book.needsEpub === true,
    book,
    classics,
    lists,
    knownPackId: known?.packId,
  });
  const classic = offer.kind === "download" ? (classics.find((pack) => pack.id === offer.packId) ?? null) : null;
  return { offer: classic || offer.kind !== "download" ? offer : { kind: "discover" }, classic };
}

/** So the own-EPUB dialog can find the word list for a card that arrived by sync. */
export async function rememberListPack(bookId: string, packId: string): Promise<void> {
  if (!packId) return;
  const existing = await loadPackRecord(bookId).catch(() => null);
  if (existing?.packId) return;
  await savePackRecord({
    packId,
    bookId,
    rev: "",
    sha256: "",
    installedAt: Date.now(),
  });
}
