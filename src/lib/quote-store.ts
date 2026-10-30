import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { QUOTES_PER_BOOK } from "@/lib/limits";
import {
  asQuote,
  asQuoteBlob,
  newQuoteId,
  QUOTE_GONE_MAX,
  type LocalQuoteGone,
  type QuoteRecord,
} from "@/lib/quote-model";
import type { SyncItem } from "@/lib/sync-merge";

/** Kept with the reader's other data; cleared with it when another account takes the device (device-wipe.ts). */
export const QUOTES_KEY = "cibian-quotes-v1";

/** A tombstone older than this is dropped: a device that has been away longer may bring the quote back. */
const GONE_KEEP_MS = 400 * 24 * 60 * 60 * 1000;

type QuoteState = {
  quotes: QuoteRecord[];
  removed: LocalQuoteGone[];
  /**
   * Keep new quotes. "full" when the book already holds QUOTES_PER_BOOK (nothing is kept then);
   * "same" when every one of them is already kept.
   */
  add: (quotes: QuoteRecord[]) => "ok" | "full" | "same";
  remove: (ids: readonly string[]) => void;
  /** Undo a removal: the same quotes, kept again (same text, place and time). */
  restore: (quotes: readonly QuoteRecord[]) => void;
};

const browserStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Full or private mode: the quotes stay for this visit and sync to the account if signed in.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Nothing to do.
    }
  },
};

function pruneGone(rows: readonly LocalQuoteGone[], now: number): LocalQuoteGone[] {
  return rows
    .filter((row) => now - row.removed < GONE_KEEP_MS)
    .sort((a, b) => b.removed - a.removed)
    .slice(0, QUOTE_GONE_MAX * 4);
}

/** The same passage of the same paragraph is one quote, whatever device kept it. */
function samePlace(a: QuoteRecord, b: QuoteRecord): boolean {
  return a.book === b.book && a.chapter === b.chapter && a.paragraph === b.paragraph && a.start === b.start && a.end === b.end;
}

export const useQuotes = create<QuoteState>()(
  persist(
    (set, get) => ({
      quotes: [],
      removed: [],
      add: (incoming) => {
        const state = get();
        const fresh = incoming.filter((quote) => !state.quotes.some((kept) => samePlace(kept, quote)));
        if (fresh.length === 0) return "same";
        for (const book of new Set(fresh.map((quote) => quote.book))) {
          const held = state.quotes.filter((quote) => quote.book === book).length;
          const adding = fresh.filter((quote) => quote.book === book).length;
          if (held + adding > QUOTES_PER_BOOK) return "full";
        }
        set({ quotes: [...state.quotes, ...fresh] });
        return "ok";
      },
      remove: (ids) => {
        const drop = new Set(ids);
        const now = Date.now();
        const state = get();
        const gone = state.quotes.filter((quote) => drop.has(quote.id));
        if (gone.length === 0) return;
        set({
          quotes: state.quotes.filter((quote) => !drop.has(quote.id)),
          removed: pruneGone([...state.removed, ...gone.map((quote) => ({ id: quote.id, book: quote.book, removed: now }))], now),
        });
      },
      restore: (back) => {
        // New ids: the old ones may already have reached the account as removed, and a removal there wins.
        const state = get();
        const fresh = back
          .filter((quote) => !state.quotes.some((kept) => samePlace(kept, quote)))
          .map((quote) => ({ ...quote, id: newQuoteId() }));
        if (fresh.length === 0) return;
        set({
          quotes: [...state.quotes, ...fresh].sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id)),
        });
      },
    }),
    {
      name: QUOTES_KEY,
      // Read only after the device check at start (device-wipe.ts), with the other stores.
      skipHydration: true,
      partialize: (state) => ({ quotes: state.quotes, removed: state.removed }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<QuoteState>;
        const quotes: QuoteRecord[] = [];
        for (const value of Array.isArray(saved.quotes) ? saved.quotes : []) {
          const quote = asQuote(value);
          if (quote) quotes.push(quote);
        }
        const removed: LocalQuoteGone[] = [];
        for (const value of Array.isArray(saved.removed) ? saved.removed : []) {
          const row = value as Partial<LocalQuoteGone> | null;
          if (row && typeof row.id === "string" && typeof row.book === "string" && typeof row.removed === "number")
            removed.push({ id: row.id, book: row.book, removed: row.removed });
        }
        return { ...current, quotes, removed };
      },
      storage: createJSONStorage(() => browserStorage),
    },
  ),
);

/**
 * Merged sync rows become the local list: each `quotes` row replaces that book's quotes and
 * tombstones (the row is already the union of both sides). Books with no row stay as they are.
 */
export function applyQuoteItems(items: readonly SyncItem[]): void {
  const rows = items.filter((item) => item.kind === "quotes" && !item.deleted);
  if (rows.length === 0) return;
  const books = new Set(rows.map((item) => item.itemId));
  const state = useQuotes.getState();
  const quotes = state.quotes.filter((quote) => !books.has(quote.book));
  const removed = state.removed.filter((row) => !books.has(row.book));
  for (const item of rows) {
    const blob = asQuoteBlob(item.data, item.itemId);
    quotes.push(...blob.quotes);
    removed.push(...blob.removed.map((row) => ({ ...row, book: item.itemId })));
  }
  quotes.sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id));
  const next = { quotes, removed: pruneGone(removed, Date.now()) };
  if (JSON.stringify(next.quotes) === JSON.stringify(state.quotes) && JSON.stringify(next.removed) === JSON.stringify(state.removed)) return;
  useQuotes.setState(next);
}
