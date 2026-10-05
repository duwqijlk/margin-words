import { useEffect, useMemo, useState } from "react";
import { glossSnapshot, requestGloss, subscribeGloss } from "@/lib/gloss-cache";
import { presentWord } from "@/lib/gloss-ref";
import type { Book, VocabEntry } from "@/lib/vocab-model";

/** The word as the notebook shows it: snippets filled from the word list, not from a saved e-book sentence. */
export function usePresentedWord(word: VocabEntry | undefined, books: readonly Book[]): VocabEntry | undefined {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeGloss(() => setTick((value) => value + 1)), []);
  useEffect(() => {
    if (!word) return;
    for (const source of word.sources) {
      if (source.ref) requestGloss(source.ref, source.book, books);
    }
  }, [word, books]);
  const files = useMemo(() => glossSnapshot(), [tick]);
  return word ? presentWord(word, files) : undefined;
}
