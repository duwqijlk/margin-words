/**
 * The global wordbook: one list of saved words across every book.
 *
 * A word is one card (one place in the spaced-repetition schedule, `srs.ts`, unchanged). Where it was met is a
 * list of sources, one per book (and sentence) it was saved from. Two saves of the same lemma become one card
 * with both sources. Pure: no store, no DOM. Used by the store, by the one-time migration of per-book data, by the
 * sync merge and by the tests.
 */
import { bookSyncKey, sourceKey } from "./sync-merge.ts";
import type { VocabEntry, WordSource } from "./vocab-model.ts";

/** A word keeps at most this many sources. The newest ones stay. */
export const MAX_SOURCES = 12;

export const lemmaKey = (lemma: string): string => lemma.trim().toLowerCase();

export { sourceKey };

export const hasSourceFrom = (word: Pick<VocabEntry, "sources">, bookKey: string): boolean =>
  word.sources.some((source) => source.book === bookKey);

export function wordsFromBook<T extends Pick<VocabEntry, "sources">>(words: readonly T[], bookKey: string): T[] {
  return words.filter((word) => hasSourceFrom(word, bookKey));
}

/** How much a source tells: a stored place and a chapter are worth more than a bare sentence. */
function detail(source: WordSource): number {
  return (source.at ? 2 : 0) + (source.chapter !== undefined ? 1 : 0) + (source.chapterTitle ? 1 : 0);
}

/** Keep a sense that only one of the two copies stored. */
function withSense(winner: WordSource, other: WordSource | undefined): WordSource {
  if (!other) return winner;
  const next = { ...winner };
  if (!next.meaning && other.meaning) next.meaning = other.meaning;
  if (!next.pos && other.pos) next.pos = other.pos;
  return next;
}

/** Union of two source lists. The same save (see `sourceKey`) keeps the more detailed copy. Oldest first. */
export function mergeSources(a: readonly WordSource[], b: readonly WordSource[], cap = MAX_SOURCES): WordSource[] {
  const map = new Map<string, WordSource>();
  for (const source of [...a, ...b]) {
    const key = sourceKey(source);
    const prior = map.get(key);
    if (!prior || detail(source) > detail(prior)) {
      map.set(key, withSense(prior ? { ...source, savedAt: Math.min(source.savedAt, prior.savedAt) } : source, prior));
    } else {
      const next = withSense(prior, source);
      if (source.savedAt < prior.savedAt) next.savedAt = source.savedAt;
      map.set(key, next);
    }
  }
  const list = [...map.values()].sort((x, y) => x.savedAt - y.savedAt);
  return list.length > cap ? list.slice(list.length - cap) : list;
}

/** Which of two cards of one word has the review state worth keeping: more reviews, then a later stage, then newer. */
export function betterCard<T extends Pick<VocabEntry, "reps" | "stage" | "lastReviewedAt" | "createdAt">>(a: T, b: T): T {
  if (a.reps !== b.reps) return a.reps > b.reps ? a : b;
  if (a.stage !== b.stage) return a.stage > b.stage ? a : b;
  const ra = a.lastReviewedAt ?? 0;
  const rb = b.lastReviewedAt ?? 0;
  if (ra !== rb) return ra > rb ? a : b;
  return a.createdAt <= b.createdAt ? a : b;
}

/** Two cards of one word become one: the better review state, every source, the earliest save date. */
export function mergeCards(a: VocabEntry, b: VocabEntry): VocabEntry {
  const winner = betterCard(a, b);
  const other = winner === a ? b : a;
  const sources = mergeSources(a.sources, b.sources);
  const merged: VocabEntry = {
    ...winner,
    sources,
    createdAt: Math.min(a.createdAt, b.createdAt),
  };
  if (!merged.sentence && other.sentence) merged.sentence = other.sentence;
  if (!merged.bookId && other.bookId) merged.bookId = other.bookId;
  const seen = Math.max(a.seen ?? 0, b.seen ?? 0);
  if (seen > 0) merged.seen = seen;
  return merged;
}

type BookLike = { id: string; title: string; author: string };

/** The source that an old per-book card stands for. */
export function legacySource(word: VocabEntry, book: BookLike | undefined): WordSource {
  const bookId = word.bookId ?? "";
  return {
    book: book ? bookSyncKey(book) : bookSyncKey({ id: bookId, title: "", author: "" }),
    title: book?.title ?? "",
    author: book?.author ?? "",
    sentence: word.sentence,
    surface: word.surface,
    savedAt: word.createdAt,
  };
}

/**
 * Per-book cards (the old shape: `bookId`, no `sources`) become one global list. Cards of the same lemma from
 * different books are merged by `mergeCards`, so no review state is lost beyond keeping the better one, and every
 * book stays a source. Cards that already have sources pass through. Safe to run again on its own output.
 */
export function migrateWords(
  words: ReadonlyArray<Omit<VocabEntry, "sources"> & { sources?: WordSource[] }>,
  books: readonly BookLike[],
): VocabEntry[] {
  const byId = new Map(books.map((book) => [book.id, book]));
  const out = new Map<string, VocabEntry>();
  const order: string[] = [];
  for (const raw of words) {
    const sources = Array.isArray(raw.sources) && raw.sources.length > 0 ? raw.sources : null;
    const card: VocabEntry = {
      ...raw,
      sources: sources ?? [legacySource({ ...raw, sources: [] }, raw.bookId ? byId.get(raw.bookId) : undefined)],
    };
    const key = lemmaKey(card.lemma);
    const prior = out.get(key);
    if (!prior) {
      out.set(key, card);
      order.push(key);
    } else out.set(key, mergeCards(prior, card));
  }
  return order.map((key) => out.get(key) as VocabEntry);
}

/** Add one source to a word (same lemma already saved), or start a new card. The schedule is untouched. */
export function addSourceTo(card: VocabEntry, source: WordSource): VocabEntry {
  return { ...card, sources: mergeSources(card.sources, [source]) };
}

/** Take away the sources from one book. Returns null when no source is left (the word goes with it). */
export function withoutBook(card: VocabEntry, bookKey: string): VocabEntry | null {
  const sources = card.sources.filter((source) => source.book !== bookKey);
  if (sources.length === card.sources.length) return card;
  if (sources.length === 0) return null;
  const first = sources[0];
  return { ...card, sources, sentence: first?.sentence || card.sentence };
}

/** The shelf card a source belongs to, if that book is on this shelf (matched by title and author, like sync). */
export function bookForSource<B extends BookLike>(source: Pick<WordSource, "book">, books: readonly B[]): B | undefined {
  return books.find((book) => bookSyncKey(book) === source.book);
}

/** Saved words that have a source in this book. */
export const countFromBook = (words: readonly Pick<VocabEntry, "sources">[], book: BookLike): number =>
  words.filter((word) => hasSourceFrom(word, bookSyncKey(book))).length;
