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
    const all = [...list].sort((a, b) => (a.seriesNumber || 999) - (b.seriesNumber || 999) || a.title.localeCompare(b.title));
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
