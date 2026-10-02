/**
 * One book = one shelf card.
 *
 * The same book can reach the shelf by several doors: added from Discover (a "needs your e-book" card),
 * imported from a book pack .zip whose pack id is a made-up one, or downloaded. The pack id alone cannot
 * tell they are the same book, so these rules compare what the book IS: the ISBN, or the title and author.
 * Pure functions only (no storage), so the rules can be tested alone.
 */
import { isbnDigits } from "@/lib/book-meta";

export type Identity = { title: string; author: string; isbn?: string };

const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Keys a title can be known by: the whole title, and the main title without a subtitle, a
 * "(series #n)" tail or a leading article. "The BFG" and "BFG", or "Ghost Town at Sundown (Magic Tree
 * House #10)" and "Ghost Town at Sundown", are the same book.
 */
export function titleKeys(title: string): string[] {
  const whole = plain(title);
  if (!whole) return [];
  const main = title
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .split(/\s[:\u2013\u2014-]\s|:\s/)[0]
    ?.replace(/^\s*(?:the|a|an)\s+/i, "");
  const short = plain(main ?? "");
  return short && short !== whole ? [whole, short] : [whole];
}

const nameWords = (value: string): string[] =>
  value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0);

/**
 * Do these two author lines name the same person (or group)? "Dahl, Roald" and "Roald Dahl" do, and so do
 * "Roald Dahl" and "Roald Dahl, Quentin Blake": every word of the shorter line is in the longer one.
 * An empty author matches anything (a pack may not give one).
 */
export function sameAuthor(a: string, b: string): boolean {
  const first = nameWords(a);
  const second = nameWords(b);
  if (first.length === 0 || second.length === 0) return true;
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  return short.every((word) => long.includes(word));
}

/** Do these two descriptions name the same book? Different authors never match. */
export function sameBook(a: Identity, b: Identity): boolean {
  const isbnA = isbnDigits(a.isbn ?? "");
  const isbnB = isbnDigits(b.isbn ?? "");
  if (isbnA && isbnA === isbnB) return true;
  const keysA = titleKeys(a.title);
  const keysB = titleKeys(b.title);
  if (!keysA.some((key) => keysB.includes(key))) return false;
  return sameAuthor(a.author, b.author);
}

export type ShelfEntry = Identity & {
  id: string;
  /** an e-book is stored for this card (an imported or downloaded book) */
  stored: boolean;
  needsEpub: boolean;
  /** saved words, plus 1 when the card has a reading place */
  work: number;
  createdAt: number;
  updatedAt: number;
};

/** Which card of a duplicate group is kept: the one with the e-book, then the one with work in it. */
export function rankEntries(entries: ShelfEntry[]): ShelfEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.stored) - Number(a.stored) ||
      Number(b.work > 0) - Number(a.work > 0) ||
      Number(a.needsEpub) - Number(b.needsEpub) ||
      b.work - a.work ||
      b.updatedAt - a.updatedAt ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
}

export type MergePlan = { keep: ShelfEntry; drop: ShelfEntry[] };

/** Groups of cards that are the same book. Groups of one are left out. */
export function planMerges(entries: ShelfEntry[]): MergePlan[] {
  const parent = entries.map((_, index) => index);
  const find = (index: number): number => {
    let at = index;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at] as number] as number;
      at = parent[at] as number;
    }
    return at;
  };
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (sameBook(entries[i] as ShelfEntry, entries[j] as ShelfEntry)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, ShelfEntry[]>();
  entries.forEach((entry, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });
  const plans: MergePlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [keep, ...drop] = rankEntries(group) as [ShelfEntry, ...ShelfEntry[]];
    plans.push({ keep, drop });
  }
  return plans;
}

/** The first card of the shelf that is this book. Cards with an e-book come first. */
export function findOnShelf<T extends Identity & { stored?: boolean }>(
  shelf: T[],
  wanted: Identity | Identity[],
): T | null {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  const hits = shelf.filter((book) => list.some((one) => one.title.trim() && sameBook(book, one)));
  return hits.find((book) => book.stored) ?? hits[0] ?? null;
}
