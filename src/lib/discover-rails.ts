/**
 * The browse rows of Discover, before any search or filter: free classics, the largest series,
 * then reading levels. Each row keeps every book it holds (`all`, for "See all") and a short
 * slice for the sideways strip (`rows`). Pure, so the order is tested without a page.
 */
import { compareLexile, difficultyBand, type DifficultyBand } from "./lexile.ts";

/** Covers in one sideways strip. "See all" shows the rest. */
export const RAIL_SIZE = 18;
/** A series needs this many books in the current tab for its own row. */
export const SERIES_RAIL_MIN = 3;
/** Series rows, largest first. */
export const SERIES_RAILS = 3;
/** A row shorter than this is left out: a strip of one or two covers looks broken. */
export const RAIL_MIN = 3;

type Railed = {
  kind: "classic" | "list";
  title: string;
  lexile: string;
  series: string;
  seriesNumber: number;
};

export type Rail<T> =
  | { id: "classic"; kind: "classic"; rows: T[]; all: T[] }
  | { id: `series:${string}`; kind: "series"; name: string; rows: T[]; all: T[] }
  | { id: `band:${DifficultyBand}`; kind: "band"; band: Exclude<DifficultyBand, "unrated">; rows: T[]; all: T[] };

const BANDS = ["under800", "mid", "high"] as const;

/**
 * Where a book stands in its series. A book with no number (an omnibus such as
 * "Magic Tree House Books 1-4 Collection") takes the first number in its title, so it comes
 * before book 5. No number at all goes last.
 */
export function seriesPlace(book: { title: string; seriesNumber?: number }): number {
  if (book.seriesNumber && book.seriesNumber > 0) return book.seriesNumber;
  const range = /\b(\d{1,3})\s*(?:-|\u2013|to|&|and)\s*\d{1,3}\b/i.exec(book.title);
  if (range) return Number(range[1]) - 0.5;
  return 999;
}

/** Series order, then title. */
export function compareSeriesPlace(
  a: { title: string; seriesNumber?: number },
  b: { title: string; seriesNumber?: number },
): number {
  return seriesPlace(a) - seriesPlace(b) || a.title.localeCompare(b.title);
}

export function browseRails<T extends Railed>(books: readonly T[]): Rail<T>[] {
  const out: Rail<T>[] = [];
  const classics = books.filter((book) => book.kind === "classic");
  if (classics.length >= RAIL_MIN) out.push({ id: "classic", kind: "classic", rows: classics.slice(0, RAIL_SIZE), all: classics });

  const bySeries = new Map<string, T[]>();
  for (const book of books) {
    if (!book.series) continue;
    const list = bySeries.get(book.series) ?? [];
    list.push(book);
    bySeries.set(book.series, list);
  }
  const series = [...bySeries.entries()]
    .filter(([, list]) => list.length >= SERIES_RAIL_MIN)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, SERIES_RAILS);
  for (const [name, list] of series) {
    const all = [...list].sort(compareSeriesPlace);
    out.push({ id: `series:${name}`, kind: "series", name, rows: all.slice(0, RAIL_SIZE), all });
  }

  for (const band of BANDS) {
    const all = books
      .filter((book) => difficultyBand(book.lexile) === band)
      .sort((a, b) => compareLexile(a.lexile, b.lexile, "easy") || a.title.localeCompare(b.title));
    if (all.length >= RAIL_MIN) out.push({ id: `band:${band}`, kind: "band", band, rows: all.slice(0, RAIL_SIZE), all });
  }
  return out;
}
