import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { tr, useLocale } from "@/lib/i18n";
import type { TextAnchor } from "@/lib/position";

/** Where the reader stopped in one book. Kept in localStorage; it is tiny and changes often. */
export type BookProgress = {
  chapter: number;
  chapters: number;
  /** 0..1 position inside the current chapter */
  scroll: number;
  updatedAt: number;
  /**
   * File-independent place (word list paragraph id + short quote, see position.ts). `chapter` and `scroll` stay
   * as the older hint: they only mean something for the exact file that saved them.
   * Inside an extra, this anchor is a paragraph of that extra, not of a numbered chapter.
   */
  anchor?: TextAnchor;
  /** Set while the open page is an extra spine file (`x2`, `x3`). Empty on a numbered chapter. */
  extraId?: string;
};

type ProgressState = {
  items: Record<string, BookProgress>;
  /**
   * `touch: false` records where the page is without claiming the reader moved: the place keeps its
   * old `updatedAt`. Opening a book writes its place back before any sync pull has run. With a fresh
   * time that echo of an old place won over the newer place another device had already synced, and
   * was then pushed back to the account.
   */
  save: (bookId: string, patch: Partial<BookProgress>, touch?: boolean) => void;
  remove: (bookId: string) => void;
};

function storage(): StateStorage {
  const none: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  if (typeof window === "undefined") return none;
  return {
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
        // blocked or full: reading position just will not persist
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

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      items: {},
      save: (bookId, patch, touch = true) =>
        set((state) => {
          const prev = state.items[bookId] ?? { chapter: 0, chapters: 0, scroll: 0, updatedAt: 0 };
          return {
            items: {
              ...state.items,
              [bookId]: { ...prev, ...patch, updatedAt: touch ? Date.now() : prev.updatedAt },
            },
          };
        }),
      remove: (bookId) =>
        set((state) => {
          const next = { ...state.items };
          delete next[bookId];
          return { items: next };
        }),
    }),
    { name: "cibian-progress-v1", skipHydration: true, storage: createJSONStorage(storage) },
  ),
);

/**
 * Do two saves name the same reading place? Same page (chapter or extra), and the same paragraph when
 * both have one; with no paragraph, nearly the same scroll. A save that only repeats where the page
 * already is should not count as the reader moving.
 */
export function samePlace(a: BookProgress, b: Partial<BookProgress>): boolean {
  if (a.chapter !== b.chapter || (a.extraId ?? "") !== (b.extraId ?? "")) return false;
  if (a.anchor && b.anchor) return a.anchor.chapter === b.anchor.chapter && a.anchor.paragraph === b.anchor.paragraph;
  if (a.anchor || b.anchor) return false;
  return Math.abs(a.scroll - (b.scroll ?? 0)) < 0.02;
}

/** Whole-book progress 0..1. */
export function overallProgress(progress: BookProgress | undefined): number {
  if (!progress || progress.chapters <= 0) return 0;
  const done = Math.min(
    progress.chapters,
    progress.chapter + Math.min(1, Math.max(0, progress.scroll)),
  );
  return Math.min(1, done / progress.chapters);
}

/** Last chapter saved by the first version of the reader (before this store existed). */
export function legacyChapter(bookId: string): number | null {
  try {
    const raw = localStorage.getItem(`cibian-chapter-${bookId}`);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function relativeTime(time: number, now = Date.now()): string {
  const diff = Math.max(0, now - time);
  const minute = 60_000;
  if (diff < minute) return tr("rel.justNow");
  if (diff < 60 * minute) return tr("rel.minAgo", { n: Math.floor(diff / minute) });
  if (diff < 24 * 60 * minute) return tr("rel.hourAgo", { n: Math.floor(diff / (60 * minute)) });
  const days = Math.floor(diff / (24 * 60 * minute));
  if (days === 1) return tr("rel.yesterday");
  if (days < 30) return tr("rel.daysAgo", { n: days });
  return new Date(time).toLocaleDateString(
    useLocale.getState().locale === "zh" ? "zh-CN" : "en-US",
  );
}
