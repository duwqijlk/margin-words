import type { Book } from "@/lib/vocab-model";

/** Reading place kept for one book. Only the fields the heart uses to decide. */
export type HeartProgress = {
  chapter: number;
  scroll: number;
  updatedAt: number;
};

/**
 * True when taking the book off the shelf would throw away something the reader made:
 * saved words, a place in the book, or an e-book we cannot download again.
 * A fresh classic, or a word list that still needs their e-book, is not in that set.
 */
export function bookHasUserWork(input: {
  source?: Book["source"];
  needsEpub?: boolean;
  classic: boolean;
  savedWords: number;
  progress?: HeartProgress | null;
}): boolean {
  if (input.savedWords > 0) return true;
  const progress = input.progress;
  if (progress && progress.updatedAt > 0 && (progress.chapter > 0 || progress.scroll > 0.02)) return true;
  if (input.source === "epub" && !input.classic && input.needsEpub !== true) return true;
  return false;
}
