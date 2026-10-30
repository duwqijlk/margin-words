/**
 * Which cover a shelf card shows: the picture in the live catalog, always. The cloud is the one
 * source; nothing is copied into the device or taken from the EPUB. Pure, so it is tested alone.
 *
 * The address carries the picture's version (`?v=<first 12 hex of its sha256>`), so a replaced
 * cover is a new address and every cached copy of the old one is simply never asked for again.
 * That lets the browser and the CDN keep covers for a long time.
 */
import { coverAddress } from "@/lib/covers";
import { matchWordListPack } from "@/lib/book-meta";

export type CatalogCover = { url: string; sha256: string } | null;

/** One book in a live catalog, as far as covers are concerned. */
export type CoverRow = {
  id: string;
  title: string;
  author: string;
  isbn: string;
  cover: CatalogCover;
  /** "speech" draws the talk cover when there is no picture. Missing is a book. */
  category?: "novel" | "speech";
  /** The catalog series ("TED" gives a speech the TED tag on its drawn cover). */
  series?: string;
};

export type CoverSources = {
  /** Public-domain books, with cover urls already absolute. */
  classics: readonly CoverRow[];
  /** Word-list books, with cover urls already absolute. */
  lists: readonly CoverRow[];
};

/**
 * The cover address for one shelf book, or "" when the catalog has none (the card then draws its
 * title-and-author cover). `packId` is the catalog id this device installed the book from, when
 * it knows one; a book that only arrived by sync is found by title, author and ISBN.
 */
export function cloudCover(
  book: { title: string; author: string; isbn?: string },
  packId: string | undefined,
  sources: CoverSources,
): string {
  const row = catalogRowOf(book, packId, sources);
  if (!row?.cover?.url) return "";
  return coverAddress(row.cover.url, row.cover.sha256);
}

/** The live catalog row of one shelf book: by the pack id it was installed from, else by title, author and ISBN. */
export function catalogRowOf(
  book: { title: string; author: string; isbn?: string },
  packId: string | undefined,
  sources: CoverSources,
): CoverRow | undefined {
  const byId = (rows: readonly CoverRow[]) => (packId ? rows.find((row) => row.id === packId) : undefined);
  const identity = { title: book.title, author: book.author, isbn: book.isbn ?? "" };
  return (
    byId(sources.classics) ??
    byId(sources.lists) ??
    matchWordListPack([...sources.classics], identity) ??
    matchWordListPack([...sources.lists], identity) ??
    undefined
  );
}
