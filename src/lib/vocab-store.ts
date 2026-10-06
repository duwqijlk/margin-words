import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { saveNotes } from "@/lib/book-db";
import { applyReview, dayKey } from "@/lib/srs";
import {
  DEMO_BOOK_TITLE,
  MASTERED_STAGE,
  demoWords,
  type AnalyzedWord,
  type Book,
  type Cloth,
  type VocabEntry,
  type WordSource,
} from "@/lib/vocab-model";
import type { TextAnchor } from "@/lib/position";
import { bookSyncKey } from "@/lib/sync-merge";
import { adoptWord, type GlossFileView } from "@/lib/gloss-ref";
import {
  addSourceTo,
  lemmaKey,
  mergeSources,
  migrateWords,
  rehomeForeignSources,
  sourceKey,
  withoutBook,
} from "@/lib/wordbook";
import { isbnDigits, seriesName, seriesNumber } from "@/lib/book-meta";
import { lexileMeasure } from "@/lib/lexile";

/** The sample book saved by an older version had a Chinese title. Rename it to English. */
const HAS_CJK = new RegExp("[\\u3400-\\u9fff]");
function englishBook(book: Book): Book {
  const measure = lexileMeasure(book.lexile);
  const isbn = isbnDigits(book.isbn);
  const series = seriesName(book.series);
  const number = series ? seriesNumber(book.seriesNumber) : 0;
  const match =
    typeof book.matchRate === "number" && book.matchRate >= 0 && book.matchRate <= 100
      ? Math.round(book.matchRate)
      : undefined;
  const next: Book = { ...book };
  if (measure) next.lexile = measure;
  else delete next.lexile;
  if (isbn) next.isbn = isbn;
  else delete next.isbn;
  if (series) {
    next.series = series;
    if (number) next.seriesNumber = number;
    else delete next.seriesNumber;
  } else {
    delete next.series;
    delete next.seriesNumber;
  }
  if (match === undefined) delete next.matchRate;
  else next.matchRate = match;
  if (next.needsEpub !== true) delete next.needsEpub;
  if (next.source === "epub" || !HAS_CJK.test(`${next.title}${next.author}`)) return next;
  return { ...next, title: DEMO_BOOK_TITLE, author: "Example sentences" };
}

export type ReviewDay = { reviewed: number; correct: number };

/**
 * Cards saved by the first version used `box` (0..4) instead of `stage`.
 * Old "already known" cards (box >= 4) become mastered; others keep their number.
 */
export function normalizeWord(raw: Omit<VocabEntry, "sources"> & { sources?: WordSource[]; box?: number }): VocabEntry {
  const { box, ...rest } = raw;
  const stage =
    typeof raw.stage === "number"
      ? raw.stage
      : typeof box === "number"
        ? box >= 4
          ? MASTERED_STAGE
          : Math.max(0, box)
        : 0;
  return {
    ...rest,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    stage,
    dueAt: stage >= MASTERED_STAGE ? Number.MAX_SAFE_INTEGER : (raw.dueAt ?? Date.now()),
    reps: raw.reps ?? 0,
    lapses: raw.lapses ?? 0,
  };
}

/**
 * Saved words from any version of the app, as one global wordbook: the schedule fields are filled in
 * (`normalizeWord`), then per-book cards become one card per lemma with a source per book (`migrateWords`).
 */
export function normalizeWordbook(raw: unknown[], books: ReadonlyArray<{ id: string; title: string; author: string }>): VocabEntry[] {
  const cards = raw
    .filter((item): item is VocabEntry => Boolean(item) && typeof item === "object" && typeof (item as VocabEntry).lemma === "string")
    .map((item) => normalizeWord(item));
  return migrateWords(cards, books);
}

const CLOTHS: Cloth[] = ["cloth", "ribbon", "ink", "sage"];

type VocabState = {
  books: Book[];
  words: VocabEntry[];
  /** answers per local day, for the streak and "reviewed today" numbers */
  log: Record<string, ReviewDay>;
  addBook: (title: string, author: string, source?: "epub" | "notes", id?: string) => string;
  /** Write Lexile measures onto books already on the shelf. Does not move them. */
  setBookLexiles: (pairs: Array<{ id: string; lexile: string }>) => void;
  setBookDetails: (
    pairs: Array<{
      id: string;
      lexile?: string;
      isbn?: string;
      series?: string;
      seriesNumber?: number;
      matchRate?: number;
      needsEpub?: boolean;
      source?: Book["source"];
      oldFashioned?: boolean;
      oldFashionedReason?: string;
    }>,
  ) => void;
  renameBook: (id: string, title: string, author: string) => void;
  deleteBook: (id: string) => void;
  addDemo: () => string;
  /**
   * Save a word to the global wordbook. A lemma that is already saved keeps its card and review state and gains
   * the new source; otherwise a new card starts at stage 0.
   */
  saveWord: (word: AnalyzedWord, source: WordSource) => { added: boolean };
  removeWord: (id: string) => void;
  /** Forget where a word was met in one book. The word goes too when that was its only source. */
  removeWordFromBook: (bookKey: string, lemma: string) => void;
  /**
   * Replace one saved sentence with a longer clip that still contains the word.
   * Used when an older save cut the sentence off before the word.
   */
  repairSourceSentence: (lemma: string, book: string, from: string, sentence: string) => void;
  /** Fill in the chapter and file-independent place of sources saved before places were stored. */
  setSourcePlaces: (
    updates: Array<{ lemma: string; book: string; sentence: string; chapter: number; chapterTitle?: string; at: TextAnchor }>,
  ) => void;
  /** Record one review answer and move the card along the Ebbinghaus ladder. */
  review: (id: string, correct: boolean, scheduled?: boolean) => void;
  markMastered: (id: string) => void;
  relearn: (id: string) => void;
  fillPrepared: (
    bookId: string,
    glossary: Record<string, { pos: string; meaning: string; whyHard: string }>,
  ) => void;
  restoreBooks: (incoming: Array<{ id: string; title: string; author: string }>) => void;
  /**
   * Two cards that are the same book become one. The card `keepId` stays and gets the saved words of
   * `dropId` (a word both have keeps the one that was reviewed more), any detail it lacks, and the older
   * "added" date. The card `dropId` is removed.
   */
  mergeBook: (keepId: string, dropId: string) => void;
  replaceWords: (words: VocabEntry[]) => void;
  /** Turn saved sentences into word-list pointers when this device has the current list. The sentence stays. */
  adoptGlossPointers: (lists: ReadonlyMap<string, { list: string; file: GlossFileView }>) => void;
  /** Put a paragraph back on a source that lost it. Does nothing when that source already has one. */
  fillSourceSentence: (lemma: string, book: string, savedAt: number, sentence: string) => void;
};

function memoryStorage(): StateStorage {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

let vocabHydrated = false;

export function markVocabHydrated() {
  vocabHydrated = true;
}

function browserStorage(): StateStorage {
  if (typeof window === "undefined") return memoryStorage();
  return {
    // localStorage can throw (blocked site data, private mode, quota). Never let that
    // crash the app; the notebook is also mirrored into IndexedDB by `saveNotes`.
    getItem: (name) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (!vocabHydrated) return;
      try {
        localStorage.setItem(name, value);
      } catch {
        // see above
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        // see above
      }
    },
  };
}

export const useVocab = create<VocabState>()(
  persist(
    (set, get) => ({
      books: [],
      words: [],
      log: {},
      addBook: (title, author, source, id) => {
        const bookId = id ?? crypto.randomUUID();
        const now = Date.now();
        const cloth = CLOTHS[get().books.length % CLOTHS.length] ?? "cloth";
        const book: Book = {
          id: bookId,
          title: title.trim(),
          author: author.trim(),
          cloth,
          source: source ?? "notes",
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ books: [book, ...state.books.filter((item) => item.id !== bookId)] }));
        return bookId;
      },
      setBookLexiles: (pairs) => get().setBookDetails(pairs),
      setBookDetails: (pairs) => {
        if (pairs.length === 0) return;
        const map = new Map(pairs.map((pair) => [pair.id, pair]));
        set((state) => ({
          books: state.books.map((book) => {
            const pair = map.get(book.id);
            if (!pair) return book;
            const next = { ...book };
            const measure = pair.lexile !== undefined ? lexileMeasure(pair.lexile) : book.lexile;
            if (measure) next.lexile = measure;
            const isbn = pair.isbn !== undefined ? isbnDigits(pair.isbn) : isbnDigits(book.isbn);
            if (isbn) next.isbn = isbn;
            if (pair.series !== undefined || pair.seriesNumber !== undefined) {
              const series = pair.series !== undefined ? seriesName(pair.series) : seriesName(book.series);
              const number =
                pair.seriesNumber !== undefined ? seriesNumber(pair.seriesNumber) : seriesNumber(book.seriesNumber);
              if (series) {
                next.series = series;
                if (number) next.seriesNumber = number;
                else delete next.seriesNumber;
              } else {
                delete next.series;
                delete next.seriesNumber;
              }
            }
            if (pair.matchRate !== undefined && pair.matchRate >= 0 && pair.matchRate <= 100)
              next.matchRate = Math.round(pair.matchRate);
            if (pair.needsEpub === true) next.needsEpub = true;
            else if (pair.needsEpub === false) delete next.needsEpub;
            if (pair.oldFashioned === true) {
              next.oldFashioned = true;
              const reason = (pair.oldFashionedReason ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
              if (reason) next.oldFashionedReason = reason;
              else delete next.oldFashionedReason;
            } else if (pair.oldFashioned === false) {
              delete next.oldFashioned;
              delete next.oldFashionedReason;
            }
            if (pair.source) next.source = pair.source;
            return next;
          }),
        }));
      },
      renameBook: (id, title, author) => {
        set((state) => ({
          books: state.books.map((book) =>
            book.id === id
              ? { ...book, title: title.trim(), author: author.trim(), updatedAt: Date.now() }
              : book,
          ),
        }));
      },
      deleteBook: (id) => {
        // The wordbook is global: the words saved from this book stay, with the book's title in their sources.
        set((state) => ({ books: state.books.filter((book) => book.id !== id) }));
      },
      addDemo: () => {
        const found = get().books.find((book) => book.title === DEMO_BOOK_TITLE);
        if (found) return found.id;
        const id = get().addBook(DEMO_BOOK_TITLE, "Example sentences");
        const book = get().books.find((item) => item.id === id);
        const key = bookSyncKey({ id, title: DEMO_BOOK_TITLE, author: "Example sentences" });
        for (const word of demoWords()) {
          get().saveWord(word, {
            book: key,
            title: book?.title ?? DEMO_BOOK_TITLE,
            author: book?.author ?? "Example sentences",
            sentence: word.sentence,
            surface: word.surface,
            savedAt: Date.now(),
          });
        }
        return id;
      },
      saveWord: (word, source) => {
        const now = Date.now();
        const key = lemmaKey(word.lemma);
        let added = false;
        set((state) => {
          const at = state.words.findIndex((card) => lemmaKey(card.lemma) === key);
          const books = state.books.map((book) =>
            bookSyncKey(book) === source.book ? { ...book, updatedAt: now } : book,
          );
          if (at >= 0) {
            const words = state.words.slice();
            words[at] = addSourceTo(words[at] as VocabEntry, source);
            return { words: rehomeForeignSources(words), books };
          }
          added = true;
          const home = state.books.find((book) => bookSyncKey(book) === source.book);
          const card: VocabEntry = {
            ...word,
            id: crypto.randomUUID(),
            ...(home ? { bookId: home.id } : {}),
            sources: [source],
            stage: 0,
            dueAt: now,
            createdAt: now,
            reps: 0,
            lapses: 0,
          };
          return { words: rehomeForeignSources([...state.words, card]), books };
        });
        return { added };
      },
      removeWord: (id) => {
        set((state) => ({ words: state.words.filter((word) => word.id !== id) }));
      },
      removeWordFromBook: (bookKey, lemma) => {
        const key = lemmaKey(lemma);
        set((state) => ({
          words: state.words.flatMap((card) => {
            if (lemmaKey(card.lemma) !== key) return [card];
            const next = withoutBook(card, bookKey);
            return next ? [next] : [];
          }),
        }));
      },
      repairSourceSentence: (lemma, book, from, sentence) => {
        if (!from || !sentence || from === sentence) return;
        const key = lemmaKey(lemma);
        set((state) => ({
          words: state.words.map((card) => {
            if (lemmaKey(card.lemma) !== key) return card;
            let changed = false;
            const sources = card.sources.map((source) => {
              if (source.book !== book || source.sentence !== from) return source;
              changed = true;
              return { ...source, sentence };
            });
            if (!changed) return card;
            return {
              ...card,
              sources,
              sentence: card.sentence === from ? sentence : card.sentence,
            };
          }),
        }));
      },
      setSourcePlaces: (updates) => {
        if (updates.length === 0) return;
        const byLemma = new Map<string, typeof updates>();
        for (const update of updates) {
          const list = byLemma.get(lemmaKey(update.lemma)) ?? [];
          list.push(update);
          byLemma.set(lemmaKey(update.lemma), list);
        }
        set((state) => ({
          words: state.words.map((card) => {
            const list = byLemma.get(lemmaKey(card.lemma));
            if (!list) return card;
            const sources = card.sources.map((source) => {
              const hit = list.find((u) => u.book === source.book && sourceKey({ book: u.book, sentence: u.sentence }) === sourceKey(source));
              if (!hit || source.at) return source;
              return {
                ...source,
                chapter: hit.chapter,
                ...(hit.chapterTitle ? { chapterTitle: hit.chapterTitle } : {}),
                at: hit.at,
              };
            });
            return { ...card, sources };
          }),
        }));
      },
      review: (id, correct, scheduled = true) => {
        const now = Date.now();
        set((state) => {
          const target = state.words.find((word) => word.id === id);
          if (!target) return state;
          // Extra practice on a card that is not due yet must not push its schedule
          // forward; a miss still sends it back to the start.
          const next =
            scheduled || !correct
              ? applyReview(target, correct, now)
              : { ...target, reps: target.reps + 1, lastReviewedAt: now };
          const key = dayKey(now);
          const day = state.log[key] ?? { reviewed: 0, correct: 0 };
          return {
            words: state.words.map((word) => (word.id === id ? next : word)),
            log: {
              ...state.log,
              [key]: { reviewed: day.reviewed + 1, correct: day.correct + (correct ? 1 : 0) },
            },
          };
        });
      },
      markMastered: (id) => {
        set((state) => ({
          words: state.words.map((word) =>
            word.id === id
              ? { ...word, stage: MASTERED_STAGE, dueAt: Number.MAX_SAFE_INTEGER }
              : word,
          ),
        }));
      },
      relearn: (id) => {
        const now = Date.now();
        set((state) => ({
          words: state.words.map((word) =>
            word.id === id ? { ...word, stage: 0, dueAt: now } : word,
          ),
        }));
      },
      fillPrepared: (bookId, glossary) => {
        const home = get().books.find((book) => book.id === bookId);
        if (!home) return;
        const bookKey = bookSyncKey(home);
        set((state) => ({
          words: state.words.map((word) => {
            if (
              word.meaning !== "The meaning is still being prepared." ||
              !word.sources.some((source) => source.book === bookKey)
            )
              return word;
            const gloss = glossary[word.lemma.toLowerCase()];
            if (!gloss) return word;
            return { ...word, pos: gloss.pos, meaning: gloss.meaning, whyHard: gloss.whyHard };
          }),
        }));
      },
      restoreBooks: (incoming) => {
        set((state) => {
          const have = new Set(state.books.map((book) => book.id));
          const missing = incoming.filter((book) => book.id && !have.has(book.id));
          if (missing.length === 0) return state;
          const now = Date.now();
          const added: Book[] = missing.map((book, index) => ({
            id: book.id,
            title: book.title,
            author: book.author,
            cloth: CLOTHS[(state.books.length + index) % CLOTHS.length] ?? "cloth",
            source: "epub",
            createdAt: now,
            updatedAt: now,
          }));
          return { books: [...added, ...state.books] };
        });
      },
      replaceWords: (words) => {
        set((state) => ({ words: normalizeWordbook(words, state.books) }));
      },
      adoptGlossPointers: (lists) => {
        if (lists.size === 0) return;
        set((state) => {
          let changed = false;
          const words = state.words.map((word) => {
            const adopted = adoptWord(word, lists);
            if (!adopted) return word;
            changed = true;
            return adopted;
          });
          if (!changed) return state;
          return { words: normalizeWordbook(words, state.books) };
        });
      },
      fillSourceSentence: (lemma, book, savedAt, sentence) => {
        const text = sentence.replace(/\s+/g, " ").trim();
        if (!text) return;
        const key = lemmaKey(lemma);
        set((state) => {
          let changed = false;
          const words = state.words.map((card) => {
            if (lemmaKey(card.lemma) !== key) return card;
            let touched = false;
            const sources = card.sources.map((source) => {
              if (source.book !== book || source.savedAt !== savedAt || source.sentence) return source;
              touched = true;
              changed = true;
              return { ...source, sentence: text };
            });
            if (!touched) return card;
            return { ...card, sources, sentence: card.sentence || text };
          });
          return changed ? { words } : state;
        });
      },
      mergeBook: (keepId, dropId) => {
        if (keepId === dropId) return;
        set((state) => {
          const keep = state.books.find((book) => book.id === keepId);
          const drop = state.books.find((book) => book.id === dropId);
          if (!keep || !drop) return state;
          // Words are global: nothing is merged here except that the sources of the dropped card now name the
          // kept card (when the two cards had different sync keys), and the old per-book field follows.
          const fromKey = bookSyncKey(drop);
          const toKey = bookSyncKey(keep);
          const words = state.words.map((word) => {
            const touched = word.bookId === dropId || word.sources.some((source) => source.book === fromKey);
            if (!touched) return word;
            const renamed =
              fromKey === toKey
                ? word.sources
                : mergeSources(
                    [],
                    word.sources.map((source) =>
                      source.book === fromKey ? { ...source, book: toKey, title: keep.title, author: keep.author } : source,
                    ),
                  );
            return { ...word, sources: renamed, ...(word.bookId === dropId ? { bookId: keepId } : {}) };
          });
          const next: Book = { ...keep };
          for (const field of [
            "lexile",
            "isbn",
            "series",
            "seriesNumber",
            "matchRate",
            "oldFashioned",
            "oldFashionedReason",
          ] as const) {
            if (next[field] === undefined && drop[field] !== undefined)
              (next as Record<string, unknown>)[field] = drop[field];
          }
          next.createdAt = Math.min(keep.createdAt, drop.createdAt);
          return {
            books: state.books.filter((book) => book.id !== dropId).map((book) => (book.id === keepId ? next : book)),
            words,
          };
        });
      },
    }),
    {
      name: "cibian-notebook-v1",
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<VocabState>;
        const books = Array.isArray(saved.books) ? saved.books.map(englishBook) : current.books;
        return {
          ...current,
          ...saved,
          books,
          // Per-book cards from earlier versions become the one global wordbook here (see wordbook.ts).
          words: Array.isArray(saved.words) ? normalizeWordbook(saved.words, books) : current.words,
          log: saved.log && typeof saved.log === "object" ? saved.log : current.log,
        };
      },
      storage: createJSONStorage(browserStorage),
    },
  ),
);

useVocab.subscribe((state, previous) => {
  if (!vocabHydrated || !previous || state.words === previous.words) return;
  void saveNotes(state.words);
});
