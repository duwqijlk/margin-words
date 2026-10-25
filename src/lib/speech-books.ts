/**
 * Which shelf books the live catalog marks as speeches, so their drawn cover is the talk look on
 * the shelf as it is on Discover. Filled by useCovers (it already matches every shelf book to its
 * catalog row); read by the shelf cards.
 */
import { useEffect, useState } from "react";

const speechBooks = new Set<string>();
const listeners = new Set<() => void>();

/** Replace the set. Listeners hear about it only when it really changed. */
export function noteSpeechBooks(ids: readonly string[]): void {
  const same = ids.length === speechBooks.size && ids.every((id) => speechBooks.has(id));
  if (same) return;
  speechBooks.clear();
  for (const id of ids) speechBooks.add(id);
  for (const listener of listeners) listener();
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
