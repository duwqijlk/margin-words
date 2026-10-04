/**
 * Totals for the Dashboard: every book on Discover (public-domain classics and word lists),
 * the words, phrases, and notes those lists mark, and which books share a series.
 * A missing count is zero, so an older catalog row still adds its book.
 */
export type SeriesTotal = { name: string; books: number };

export type LibraryTotals = {
  books: number;
  classics: number;
  lists: number;
  words: number;
  paragraphs: number;
  sentences: number;
  phrases: number;
  /** Named series, most books first. A series of one book is kept. */
  series: SeriesTotal[];
  /** Books with no series name. */
  standalone: number;
};

type Counted = {
  words?: number;
  paragraphs?: number;
  sentences?: number;
  phrases?: number;
  series?: string;
};

function add(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function libraryTotals(packs: readonly Counted[], lists: readonly Counted[]): LibraryTotals {
  let words = 0;
  let paragraphs = 0;
  let sentences = 0;
  let phrases = 0;
  const series = new Map<string, number>();
  let standalone = 0;
  for (const row of [...packs, ...lists]) {
    words += add(row.words);
    paragraphs += add(row.paragraphs);
    sentences += add(row.sentences);
    phrases += add(row.phrases);
    const name = (row.series ?? "").replace(/\s+/g, " ").trim();
    if (!name) standalone += 1;
    else series.set(name, (series.get(name) ?? 0) + 1);
  }
  const named = [...series.entries()]
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => b.books - a.books || a.name.localeCompare(b.name));
  return {
    books: packs.length + lists.length,
    classics: packs.length,
    lists: lists.length,
    words,
    paragraphs,
    sentences,
    phrases,
    series: named,
    standalone,
  };
}

/** Group digits so a large total is easy to read: 12345 -> "12,345". */
export function groupDigits(n: number): string {
  const whole = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return whole.toLocaleString("en-US");
}
