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

/** Keep a sense that only one of the two copies stored. A word-list pointer does not take a copied meaning. */
function withSense(winner: WordSource, other: WordSource | undefined): WordSource {
  if (!other) return winner;
  if (winner.ref) {
    const next = { ...winner };
    if (!next.pos && other.pos) next.pos = other.pos;
    return next;
  }
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
  return rehomeForeignSources(order.map((key) => out.get(key) as VocabEntry));
}

/** True when `surface` stands on its own in `text` (not inside a longer word). Same rule as `sentenceHasWord` in text.ts. */
function containsWord(text: string, surface: string): boolean {
  const word = surface.trim();
  if (!word || !text) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, "iu").test(text);
}

/**
 * Two forms of one word ("cry" / "cried", "shed" / "shedding"). Unrelated words
 * ("queer" / "fortunately") are not the same.
 */
function sameWord(lemma: string, surface: string): boolean {
  const a = lemma.trim().toLowerCase();
  const b = surface.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const yForm = (left: string, right: string) =>
    left.endsWith("y") &&
    (right.endsWith("ied") || right.endsWith("ies")) &&
    left.slice(0, -1) === right.slice(0, -3);
  if (yForm(a, b) || yForm(b, a)) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (shorter.length < 3 || !longer.startsWith(shorter)) return false;
  const rest = longer.slice(shorter.length);
  return /^(s|es|ed|ing|ly|er|est|ied|ies|'s)$/.test(rest) || /^(.)\1?(s|es|ed|ing|ly|er|est)$/.test(rest);
}

/**
 * A saved place belongs on this card when the sentence is about this word.
 * A second form ("went" on "go") stays when it carries the same meaning.
 * A place whose sentence and meaning are another word's ("fortunately" on "queer") does not.
 */
export function sourceBelongsTo(
  card: Pick<VocabEntry, "lemma" | "surface" | "meaning" | "sources">,
  source: WordSource,
): boolean {
  if (source.ref) return true;
  const lemma = card.lemma.trim();
  const sentence = source.sentence ?? "";
  if (lemma && containsWord(sentence, lemma)) return true;
  const cardSurface = card.surface.trim();
  if (cardSurface && sameWord(lemma, cardSurface) && containsWord(sentence, cardSurface)) return true;
  const surface = (source.surface ?? "").trim();
  if (surface && sameWord(lemma, surface) && containsWord(sentence, surface)) return true;
  const own = card.sources.find(
    (item) =>
      (lemma && containsWord(item.sentence ?? "", lemma)) ||
      (cardSurface && sameWord(lemma, cardSurface) && containsWord(item.sentence ?? "", cardSurface)),
  );
  if (!own) return true;
  const ownMeaning = (own.meaning ?? "").trim();
  const meaning = (source.meaning ?? "").trim();
  // Same gloss, including an irregular form such as "went" on "go".
  if (!ownMeaning || !meaning || meaning === ownMeaning) return true;
  return false;
}

function alignCard(card: VocabEntry): VocabEntry {
  const own =
    card.sources.find((source) => source.sentence && containsWord(source.sentence, card.lemma)) ??
    card.sources.find((source) => !source.ref && source.sentence) ??
    card.sources[0];
  if (!own || own.ref) return card;
  const sentenceOk =
    containsWord(card.sentence, card.lemma) ||
    (sameWord(card.lemma, card.surface) && containsWord(card.sentence, card.surface));
  const surfaceOk = sameWord(card.lemma, card.surface);
  const meaningOk = !own.meaning || card.meaning === own.meaning;
  if (sentenceOk && surfaceOk && meaningOk) return card;
  return {
    ...card,
    sentence: sentenceOk ? card.sentence : own.sentence || card.sentence,
    surface: surfaceOk ? card.surface : own.surface || card.lemma,
    meaning: own.meaning || card.meaning,
    pos: own.pos || card.pos,
  };
}

function cardForDisplaced(source: WordSource): VocabEntry {
  const surface = source.surface.trim();
  const now = source.savedAt || Date.now();
  return {
    id: crypto.randomUUID(),
    surface,
    lemma: surface,
    pos: source.pos ?? "",
    meaning: source.meaning ?? "",
    whyHard: "",
    recommend: true,
    sentence: source.sentence ?? "",
    sources: [source],
    stage: 0,
    dueAt: now,
    createdAt: now,
    reps: 0,
    lapses: 0,
  };
}

/**
 * A place that is really another word moves onto that word's card (a new card when
 * that word was not saved on its own). Cards that are already right are left as they are.
 */
export function rehomeForeignSources(words: readonly VocabEntry[]): VocabEntry[] {
  const displaced: WordSource[] = [];
  let changed = false;
  const kept: VocabEntry[] = [];
  for (const word of words) {
    const sources: WordSource[] = [];
    for (const source of word.sources) {
      if (sourceBelongsTo(word, source)) sources.push(source);
      else {
        displaced.push(source);
        changed = true;
      }
    }
    if (sources.length === word.sources.length) {
      kept.push(word);
      continue;
    }
    changed = true;
    if (sources.length === 0) continue;
    kept.push(alignCard({ ...word, sources }));
  }
  if (!changed) return words as VocabEntry[];
  for (const source of displaced) {
    const surface = source.surface.trim();
    if (!surface) continue;
    const key = lemmaKey(surface);
    const at = kept.findIndex((word) => lemmaKey(word.lemma) === key);
    if (at >= 0) {
      kept[at] = addSourceTo(kept[at] as VocabEntry, source);
      continue;
    }
    kept.push(cardForDisplaced(source));
  }
  return kept;
}

/**
 * What the notebook stores from the open card.
 * A phrase card stores the phrase (`tune in`, as written `tuning in`), not the single word
 * that was tapped (`in`). A card with no phrase stores that word.
 */
export function savedFromCard(
  word: { surface: string; key: string; pos: string; meaning: string },
  phrase: { key: string; matched: string; pos?: string; meaning: string } | null,
): { lemma: string; surface: string; pos: string; meaning: string } {
  const key = phrase?.key.trim() ?? "";
  if (key) {
    const matched = phrase?.matched.trim() ?? "";
    return {
      lemma: key,
      surface: matched || key,
      pos: phrase?.pos?.trim() || "phrase",
      meaning: phrase?.meaning ?? "",
    };
  }
  return {
    lemma: word.key,
    surface: word.surface,
    pos: word.pos,
    meaning: word.meaning,
  };
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
