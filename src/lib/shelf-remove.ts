/**
 * Taking a book off the shelf (Discover menu, or the book menu on the shelf).
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

/** A short message after a book was added. It goes away by itself. */
export type ShelfNotice = { id: number; title: string };

export const NOTICE_MS = 5000;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

type RemoveState = {
  pending: Pending | null;
  confirm: RemoveConfirm | null;
  notice: ShelfNotice | null;
  announceAdded: (title: string) => void;
  dismissNotice: () => void;
  ask: (book: Book, userWork: boolean, words: number) => void;
  undo: () => void;
  cancel: () => void;
};

/**
 * The book waiting for its undo to run out. If the page is closed or reloaded in that time, the removal is
 * finished on the next start, so what the reader saw ("removed") is what stays.
 */
const PENDING_KEY = "cibian-pending-removal-v1";

function rememberPending(bookId: string | null) {
  try {
    if (bookId) localStorage.setItem(PENDING_KEY, bookId);
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Blocked storage: the undo still works, only the reload case is lost.
  }
}

/** Run once at start-up, before the shelf is read. */
export async function finishPendingRemoval(): Promise<void> {
  let bookId: string | null = null;
  try {
    bookId = localStorage.getItem(PENDING_KEY);
  } catch {
    return;
  }
  if (!bookId) return;
  rememberPending(null);
  await forgetBook(bookId);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function forgetBook(bookId: string): Promise<void> {
  const timer = timers.get(bookId);
  if (timer) clearTimeout(timer);
  timers.delete(bookId);
  if (useShelfRemove.getState().pending?.bookId === bookId) useShelfRemove.setState({ pending: null });
  try {
    if (localStorage.getItem(PENDING_KEY) === bookId) rememberPending(null);
  } catch {
    // Nothing to clear.
  }
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
  notice: null,
  announceAdded: (title) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice: { id: Date.now(), title } });
    noticeTimer = setTimeout(() => get().dismissNotice(), NOTICE_MS);
  },
  dismissNotice: () => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    set({ notice: null });
  },
  ask: (book, userWork, words) => {
    if (get().pending?.bookId === book.id) {
      get().undo();
      return;
    }
    if (userWork) {
      set({ confirm: { book, words } });
      return;
    }
    get().dismissNotice();
    const previous = get().pending;
    if (previous) commit(previous.bookId);
    const timer = setTimeout(() => commit(book.id), UNDO_MS);
    timers.set(book.id, timer);
    rememberPending(book.id);
    set({ pending: { bookId: book.id, title: book.title } });
  },
  undo: () => {
    const pending = get().pending;
    if (!pending) return;
    const timer = timers.get(pending.bookId);
    if (timer) clearTimeout(timer);
    timers.delete(pending.bookId);
    rememberPending(null);
    set({ pending: null });
  },
  cancel: () => set({ confirm: null }),
}));
