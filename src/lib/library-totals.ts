/**
 * Totals for the Dashboard: every book on Discover (public-domain classics and word lists),
 * the words those lists mark, and the paragraph notes they include.
 * A missing count is zero, so an older catalog row still adds its book.
 */
export type LibraryTotals = {
  books: number;
  words: number;
  paragraphs: number;
};

type Counted = {
  words?: number;
  paragraphs?: number;
};

function add(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function libraryTotals(packs: readonly Counted[], lists: readonly Counted[]): LibraryTotals {
  let words = 0;
  let paragraphs = 0;
  for (const row of packs) {
    words += add(row.words);
    paragraphs += add(row.paragraphs);
  }
  for (const row of lists) {
    words += add(row.words);
    paragraphs += add(row.paragraphs);
  }
  return { books: packs.length + lists.length, words, paragraphs };
}

/** Group digits so a large total is easy to read: 12345 -> "12,345". */
export function groupDigits(n: number): string {
  const whole = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return whole.toLocaleString("en-US");
}
