/**
 * What to do when a shelf card has no book file on this device.
 * Sync copies the card, the progress and the notebook. It does not copy the EPUB.
 * Pure: no network, no storage.
 */
import { sameBook } from "./shelf-identity.ts";

export type OfferBook = { id: string; title: string; author: string; isbn?: string };

export type FileOffer =
  | { kind: "ready" }
  | { kind: "download"; packId: string }
  | { kind: "epub"; packId: string }
  | { kind: "discover" };

/** A classic with a file we can download wins over a word list. The card stays the same. */
export function planFileOffer(input: {
  fileHere: boolean;
  needsEpub: boolean;
  book: { title: string; author: string; isbn?: string };
  classics: readonly OfferBook[];
  lists: readonly OfferBook[];
  /** pack id already stored on this device, if any */
  knownPackId?: string;
}): FileOffer {
  if (input.fileHere && !input.needsEpub) return { kind: "ready" };
  const want = { title: input.book.title, author: input.book.author, isbn: input.book.isbn ?? "" };
  const classic =
    input.classics.find((pack) => sameBook(want, pack)) ??
    input.classics.find((pack) => pack.id === input.knownPackId);
  if (classic) return { kind: "download", packId: classic.id };
  const list =
    input.lists.find((pack) => sameBook(want, pack)) ??
    input.lists.find((pack) => pack.id === input.knownPackId);
  if (list) return { kind: "epub", packId: list.id };
  // A pack id with no catalog (offline) is only an EPUB prompt when this card is already waiting for one.
  if (input.knownPackId && (input.needsEpub || input.classics.length > 0 || input.lists.length > 0))
    return { kind: "epub", packId: input.knownPackId };
  return { kind: "discover" };
}
