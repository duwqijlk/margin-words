/**
 * The reader's own record: books marked as finished, the days they read, and the totals a share
 * card shows. Pure functions; the stores keep the state (vocab-store.ts) and sync it
 * (settings.readDays, shelf.finishedAt in sync-merge.ts).
 *
 * "Finished" is the reader's own mark, set by hand. It is not the reading position: a book can be
 * finished at 60% (the reader skipped the notes at the end) or at 100% and not marked. The
 * progress bar never looks at it.
 */
import { asFinishedAt, asReadDays } from "./sync-merge.ts";
import { MASTERED_STAGE, type Book, type VocabEntry } from "./vocab-model.ts";

export { asFinishedAt, asReadDays, mergeReadDays, READ_DAYS_MAX } from "./sync-merge.ts";

/** `days` with `day` in it. The same array when it is already there, so a store does not change. */
export function addReadDay(days: readonly string[], day: string): readonly string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || days.includes(day)) return days;
  return asReadDays([...days, day]);
}

export type ReadingOverview = {
  /** Books marked as finished, the latest first. */
  finished: Book[];
  readDays: number;
  words: number;
  mastered: number;
};

export function readingOverview(books: readonly Book[], words: readonly VocabEntry[], readDays: readonly string[]): ReadingOverview {
  const finished = books
    .filter((book) => asFinishedAt(book.finishedAt) !== undefined)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  return {
    finished,
    readDays: readDays.length,
    words: words.length,
    mastered: words.filter((word) => word.stage >= MASTERED_STAGE).length,
  };
}

export type FinishedFilter = "all" | "finished" | "unfinished";

export function matchesFinished(book: Pick<Book, "finishedAt">, filter: FinishedFilter): boolean {
  if (filter === "all") return true;
  const done = asFinishedAt(book.finishedAt) !== undefined;
  return filter === "finished" ? done : !done;
}

/** A date for "Finished on …", in the reader's language. */
export function finishedDate(time: number, locale: string): string {
  try {
    return new Date(time).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}
