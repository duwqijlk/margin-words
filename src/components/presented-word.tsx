import { useEffect, useMemo, useState } from "react";
import { bookListSnapshot, glossSnapshot, requestBookGloss, requestGloss, subscribeGloss } from "@/lib/gloss-cache";
import { presentWord, type GlossFileView } from "@/lib/gloss-ref";
import type { Book, VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";

/** The word lists loaded for the notebook. A later edit to a list replaces the copy. */
export function useGlossFiles(): ReadonlyMap<string, GlossFileView> {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeGloss(() => setTick((value) => value + 1)), []);
  return useMemo(() => glossSnapshot(), [tick]);
}

/** The word as the notebook shows it: snippet and meaning come from the current word list. */
export function usePresentedWord(word: VocabEntry | undefined, books: readonly Book[]): VocabEntry | undefined {
  const files = useGlossFiles();
  useEffect(() => {
    if (!word) return;
    for (const source of word.sources) {
      if (source.ref) requestGloss(source.ref, source.book, books);
      else requestBookGloss(source.book, books);
    }
  }, [word, books, files]);
  return word ? presentWord(word, files) : undefined;
}

/**
 * Load each saved word's list and, once it is here, store a pointer instead of the old sentence.
 * The meaning itself is not stored: the card reads the list again every time it is shown.
 */
export function useLiveGlossMeanings(words: readonly VocabEntry[], books: readonly Book[]): void {
  const files = useGlossFiles();
  const adopt = useVocab((state) => state.adoptGlossPointers);
  useEffect(() => {
    const seen = new Set<string>();
    for (const word of words) {
      for (const source of word.sources) {
        if (source.ref) requestGloss(source.ref, source.book, books);
        else if (!seen.has(source.book)) {
          seen.add(source.book);
          requestBookGloss(source.book, books);
        }
      }
    }
  }, [words, books, files]);
  useEffect(() => {
    adopt(bookListSnapshot());
  }, [files, words, books, adopt]);
}
