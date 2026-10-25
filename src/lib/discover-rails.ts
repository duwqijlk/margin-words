/**
 * The browse rows of Discover, before any search or filter: free classics, then the largest
 * series. A reading level is chosen in the Filter menu, not in a row. Each row keeps every book it holds (`all`, for "See all") and a short
 * slice for the sideways strip (`rows`). Pure, so the order is tested without a page.
 */

/** Covers in one sideways strip. "See all" shows the rest. */
export const RAIL_SIZE = 18;
/** A series needs this many books in the current tab for its own row. */
export const SERIES_RAIL_MIN = 3;
/** Series rows, largest first. */
export const SERIES_RAILS = 3;
/** A row shorter than this is left out: a strip of one or two covers looks broken. */
export const RAIL_MIN = 3;
/** Saved Discover rows. An admin list longer than this is refused. */
export const DISCOVER_RAIL_LIMIT = 12;
/** Books in one admin-picked row. */
export const DISCOVER_RAIL_BOOKS = 60;

const BOOK_KEY = /^(?:list|classic):[a-z0-9][a-z0-9_-]{0,63}$/;

/** The Discover tab a saved row belongs to. A row saved before tabs had rows has none: Novels. */
export type RailCategory = "novel" | "speech";

export function railCategory(spec: { category?: RailCategory }): RailCategory {
  return spec.category === "speech" ? "speech" : "novel";
}

/** The saved rows of one Discover tab, in their saved order. */
export function railsFor(specs: readonly DiscoverRailSpec[], category: RailCategory): DiscoverRailSpec[] {
  return specs.filter((spec) => railCategory(spec) === category);
}

/** Keep a saved row list, or refuse it. An empty list is allowed. */
export function normalizeDiscoverRails(value: unknown): { ok: true; rails: DiscoverRailSpec[] } | { ok: false } {
  if (!value || typeof value !== "object") return { ok: false };
  const rails = (value as { rails?: unknown }).rails;
  if (!Array.isArray(rails) || rails.length > DISCOVER_RAIL_LIMIT) return { ok: false };
  const out: DiscoverRailSpec[] = [];
  const names = new Set<string>();
  for (const item of rails) {
    if (!item || typeof item !== "object") return { ok: false };
    const row = item as { source?: unknown; name?: unknown; books?: unknown; category?: unknown };
    const name = typeof row.name === "string" ? row.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (row.category !== undefined && row.category !== "novel" && row.category !== "speech") return { ok: false };
    // Only a speech row writes its tab, so a file saved before tabs reads the same.
    const tab = row.category === "speech" ? { category: "speech" as const } : {};
    const scoped = `${row.category === "speech" ? "speech" : "novel"}:${name}`;
    if (!name || names.has(scoped)) return { ok: false };
    names.add(scoped);
    if (row.source === "series") {
      out.push({ source: "series", name, ...tab });
      continue;
    }
    if (row.source !== "custom" || !Array.isArray(row.books) || row.books.length === 0 || row.books.length > DISCOVER_RAIL_BOOKS) {
      return { ok: false };
    }
    const books: string[] = [];
    const seen = new Set<string>();
    for (const key of row.books) {
      if (typeof key !== "string" || !BOOK_KEY.test(key) || seen.has(key)) return { ok: false };
      seen.add(key);
      books.push(key);
    }
    out.push({ source: "custom", name, books, ...tab });
  }
  return { ok: true, rails: out };
}

type Railed = {
  kind: "classic" | "list";
  title: string;
  lexile: string;
  series: string;
  seriesNumber: number;
  /** `classic:<id>` or `list:<id>`, used by an admin-picked row. */
  key?: string;
};

export type DiscoverRailSpec =
  | { source: "series"; name: string; category?: RailCategory }
  | { source: "custom"; name: string; books: string[]; category?: RailCategory };

export type Rail<T> =
  | { id: "classic"; kind: "classic"; rows: T[]; all: T[] }
  | { id: `series:${string}`; kind: "series"; name: string; rows: T[]; all: T[] }
  | { id: `curated:${string}`; kind: "curated"; name: string; rows: T[]; all: T[] };

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

function booksInOrder<T extends Railed>(books: readonly T[], keys: readonly string[]): T[] {
  const byKey = new Map<string, T>();
  for (const book of books) {
    if (book.key && !byKey.has(book.key)) byKey.set(book.key, book);
  }
  const out: T[] = [];
  for (const key of keys) {
    const book = byKey.get(key);
    if (book) out.push(book);
  }
  return out;
}

function automaticSeries<T extends Railed>(books: readonly T[]): Rail<T>[] {
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
  return series.map(([name, list]) => {
    const all = [...list].sort(compareSeriesPlace);
    return { id: `series:${name}` as const, kind: "series" as const, name, rows: all.slice(0, RAIL_SIZE), all };
  });
}

/**
 * `specs === null` keeps the automatic series rows. An array, including an
 * empty one, is the admin's list: those rows, in that order, and no others.
 */
export function browseRails<T extends Railed>(books: readonly T[], specs: readonly DiscoverRailSpec[] | null = null): Rail<T>[] {
  const out: Rail<T>[] = [];
  const classics = books.filter((book) => book.kind === "classic");
  if (classics.length >= RAIL_MIN) out.push({ id: "classic", kind: "classic", rows: classics.slice(0, RAIL_SIZE), all: classics });

  if (specs === null) {
    out.push(...automaticSeries(books));
  } else {
    for (const spec of specs) {
      if (spec.source === "series") {
        const all = books.filter((book) => book.series === spec.name).sort(compareSeriesPlace);
        if (all.length === 0) continue;
        out.push({ id: `series:${spec.name}`, kind: "series", name: spec.name, rows: all.slice(0, RAIL_SIZE), all });
        continue;
      }
      const all = booksInOrder(books, spec.books);
      if (all.length === 0) continue;
      out.push({ id: `curated:${spec.name}`, kind: "curated", name: spec.name, rows: all.slice(0, RAIL_SIZE), all });
    }
  }

  // No difficulty rows: the Filter menu already chooses a level, and three more rows made the page long.
  return out;
}
