/**
 * Series stacks on the bookshelf. Books of one series that are on the shelf together become ONE stacked
 * card; a book that is alone in its series, or has no series, stays a single card. Pure, so it is tested alone.
 */

type Seriesed = { book: { series?: string; seriesNumber?: number; title: string } };

export type ShelfItem<T extends Seriesed> =
  | { kind: "book"; row: T }
  | { kind: "stack"; key: string; name: string; rows: T[] };

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Reading order inside a series: by number (a book with no number goes last), then by title. */
export function inSeriesOrder<T extends Seriesed>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.book.seriesNumber || Number.MAX_SAFE_INTEGER) - (b.book.seriesNumber || Number.MAX_SAFE_INTEGER) ||
      a.book.title.localeCompare(b.book.title),
  );
}

/**
 * The list of cards for a shelf. The order of `rows` is kept: a stack sits where the first of its books
 * would have been, and the books inside it are in series order.
 */
export function stackShelf<T extends Seriesed>(rows: readonly T[]): ShelfItem<T>[] {
  const bySeries = new Map<string, T[]>();
  for (const row of rows) {
    const name = row.book.series?.trim();
    if (!name) continue;
    bySeries.set(keyOf(name), [...(bySeries.get(keyOf(name)) ?? []), row]);
  }
  const out: ShelfItem<T>[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const name = row.book.series?.trim();
    const group = name ? bySeries.get(keyOf(name)) : undefined;
    if (!name || !group || group.length < 2) {
      out.push({ kind: "book", row });
      continue;
    }
    const key = keyOf(name);
    if (placed.has(key)) continue;
    placed.add(key);
    out.push({ kind: "stack", key, name: group[0]?.book.series?.trim() ?? name, rows: inSeriesOrder(group) });
  }
  return out;
}
