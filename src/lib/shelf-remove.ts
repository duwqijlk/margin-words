/**
 * Taking a book off with the heart.
 * A book the reader has not started leaves at once and can be undone for a few seconds.
 * A book with saved words, reading progress, or their own e-book asks first.
 */
import { create } from "zustand";
import { deleteStoredBook } from "@/lib/book-db";
import { useProgress } from "@/lib/progress-store";
import { markPackRemoved } from "@/lib/removed-packs";
import type { Book } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";

/** How long the undo toast stays before the book is really deleted. */
export const UNDO_MS = 6000;

export type RemoveConfirm = { book: Book; words: number };

type Pending = { bookId: string; title: string };

type RemoveState = {
  pending: Pending | null;
  confirm: RemoveConfirm | null;
  ask: (book: Book, userWork: boolean, words: number) => void;
  undo: () => void;
  cancel: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function forgetBook(bookId: string): Promise<void> {
  const timer = timers.get(bookId);
  if (timer) clearTimeout(timer);
  timers.delete(bookId);
  if (useShelfRemove.getState().pending?.bookId === bookId) useShelfRemove.setState({ pending: null });
  try {
    await markPackRemoved(bookId);
  } catch {
    // The book still has to leave, even if the "do not reinstall" flag could not be saved.
  }
  try {
    await deleteStoredBook(bookId);
  } catch {
    // Already gone.
  }
  useProgress.getState().remove(bookId);
  useVocab.getState().deleteBook(bookId);
}

function commit(bookId: string) {
  const timer = timers.get(bookId);
  if (timer) clearTimeout(timer);
  timers.delete(bookId);
  if (useShelfRemove.getState().pending?.bookId === bookId) useShelfRemove.setState({ pending: null });
  void forgetBook(bookId);
}

export const useShelfRemove = create<RemoveState>()((set, get) => ({
  pending: null,
  confirm: null,
  ask: (book, userWork, words) => {
    if (get().pending?.bookId === book.id) {
      get().undo();
      return;
    }
    if (userWork) {
      set({ confirm: { book, words } });
      return;
    }
    const previous = get().pending;
    if (previous) commit(previous.bookId);
    const timer = setTimeout(() => commit(book.id), UNDO_MS);
    timers.set(book.id, timer);
    set({ pending: { bookId: book.id, title: book.title } });
  },
  undo: () => {
    const pending = get().pending;
    if (!pending) return;
    const timer = timers.get(pending.bookId);
    if (timer) clearTimeout(timer);
    timers.delete(pending.bookId);
    set({ pending: null });
  },
  cancel: () => set({ confirm: null }),
}));
