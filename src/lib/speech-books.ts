/**
 * Which shelf books the live catalog marks as speeches, so their drawn cover is the talk look on
 * the shelf as it is on Discover. Filled by useCovers (it already matches every shelf book to its
 * catalog row); read by the shelf cards.
 */
import { useEffect, useState } from "react";

const speechBooks = new Set<string>();
/** The speeches among them that are TED talks (their drawn cover carries the TED tag). */
const tedBooks = new Set<string>();
const listeners = new Set<() => void>();

const sameSet = (set: ReadonlySet<string>, ids: readonly string[]) => ids.length === set.size && ids.every((id) => set.has(id));

/** Replace the sets. Listeners hear about it only when one really changed. */
export function noteSpeechBooks(ids: readonly string[], ted: readonly string[] = []): void {
  if (sameSet(speechBooks, ids) && sameSet(tedBooks, ted)) return;
  speechBooks.clear();
  for (const id of ids) speechBooks.add(id);
  tedBooks.clear();
  for (const id of ted) tedBooks.add(id);
  for (const listener of listeners) listener();
}

/** True when a shelf speech is a TED talk. Read alongside useSpeechBookIds, which redraws on a change. */
export function isTedBook(id: string): boolean {
  return tedBooks.has(id);
}

/** Ids of shelf books that are speeches. The component redraws when the set changes. */
export function useSpeechBookIds(): ReadonlySet<string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return speechBooks;
}
