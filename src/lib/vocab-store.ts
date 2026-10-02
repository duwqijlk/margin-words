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
} from "@/lib/vocab-model";
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
export function normalizeWord(raw: VocabEntry & { box?: number }): VocabEntry {
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
    stage,
    dueAt: stage >= MASTERED_STAGE ? Number.MAX_SAFE_INTEGER : (raw.dueAt ?? Date.now()),
    reps: raw.reps ?? 0,
    lapses: raw.lapses ?? 0,
  };
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
    }>,
  ) => void;
  renameBook: (id: string, title: string, author: string) => void;
  deleteBook: (id: string) => void;
  addDemo: () => string;
  addWords: (bookId: string, incoming: AnalyzedWord[]) => { added: number; skipped: number };
  removeWord: (id: string) => void;
  removeWordByLemma: (bookId: string, lemma: string) => void;
  /** Record one review answer and move the card along the Ebbinghaus ladder. */
  review: (id: string, correct: boolean, scheduled?: boolean) => void;
  markMastered: (id: string) => void;
  relearn: (id: string) => void;
  fillPrepared: (
    bookId: string,
    glossary: Record<string, { pos: string; meaning: string; whyHard: string }>,
  ) => void;
  restoreBooks: (incoming: Array<{ id: string; title: string; author: string }>) => void;
  replaceWords: (words: VocabEntry[]) => void;
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
        set((state) => ({
          books: state.books.filter((book) => book.id !== id),
          words: state.words.filter((word) => word.bookId !== id),
        }));
      },
      addDemo: () => {
        const found = get().books.find((book) => book.title === DEMO_BOOK_TITLE);
        if (found) return found.id;
        const id = get().addBook(DEMO_BOOK_TITLE, "Example sentences");
        get().addWords(id, demoWords());
        return id;
      },
      addWords: (bookId, incoming) => {
        const state = get();
        const existing = new Set(
          state.words
            .filter((word) => word.bookId === bookId)
            .map((word) => word.lemma.toLowerCase()),
        );
        const now = Date.now();
        const fresh: VocabEntry[] = [];
        let skipped = 0;
        for (const word of incoming) {
          const key = word.lemma.toLowerCase();
          if (existing.has(key)) {
            skipped += 1;
            continue;
          }
          existing.add(key);
          fresh.push({
            ...word,
            id: crypto.randomUUID(),
            bookId,
            stage: 0,
            dueAt: now,
            createdAt: now,
            reps: 0,
            lapses: 0,
          });
        }
        set({
          words: [...state.words, ...fresh],
          books: state.books.map((book) =>
            book.id === bookId ? { ...book, updatedAt: now } : book,
          ),
        });
        return { added: fresh.length, skipped };
      },
      removeWord: (id) => {
        set((state) => ({ words: state.words.filter((word) => word.id !== id) }));
      },
      removeWordByLemma: (bookId, lemma) => {
        const key = lemma.toLowerCase();
        set((state) => ({
          words: state.words.filter(
            (word) => !(word.bookId === bookId && word.lemma.toLowerCase() === key),
          ),
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
        set((state) => ({
          words: state.words.map((word) => {
            if (word.bookId !== bookId || word.meaning !== "The meaning is still being prepared.")
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
        set({ words: words.map(normalizeWord) });
      },
    }),
    {
      name: "cibian-notebook-v1",
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<VocabState>;
        return {
          ...current,
          ...saved,
          books: Array.isArray(saved.books) ? saved.books.map(englishBook) : current.books,
          words: Array.isArray(saved.words) ? saved.words.map(normalizeWord) : current.words,
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
