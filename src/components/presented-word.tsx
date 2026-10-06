import { useEffect, useMemo, useState } from "react";
import { loadStoredBook } from "@/lib/book-db";
import { bookListSnapshot, glossSettled, glossSnapshot, requestBookGloss, requestGloss, subscribeGloss } from "@/lib/gloss-cache";
import { bookGlossKey, glossCacheKey } from "@/lib/gloss-point";
import { presentWord, readPoint, type GlossFileView } from "@/lib/gloss-ref";
import { restoreParagraph } from "@/lib/text";
import type { Book, VocabEntry, WordSource } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { bookForSource } from "@/lib/wordbook";

/** The word lists loaded for the notebook. A later edit to a list replaces the copy. */
export function useGlossFiles(): ReadonlyMap<string, GlossFileView> {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeGloss(() => setTick((value) => value + 1)), []);
  return useMemo(() => glossSnapshot(), [tick]);
}

/** The word as the notebook shows it: the saved paragraph stays, and the meaning comes from the current word list. */
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
 * Load each saved word's list and, once it is here, store a pointer.
 * The sentence stays. The meaning is not stored: the card reads the list again every time it is shown.
 * A sentence that was already dropped is filled from the book file on this device.
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
  useRestoreParagraphs(words, books, files);
}

function useRestoreParagraphs(
  words: readonly VocabEntry[],
  books: readonly Book[],
  files: ReadonlyMap<string, GlossFileView>,
): void {
  const fill = useVocab((state) => state.fillSourceSentence);
  useEffect(() => {
    const pending: { lemma: string; source: WordSource; bookId: string }[] = [];
    for (const word of words) {
      for (const source of word.sources) {
        if (source.sentence?.trim()) continue;
        const book = bookForSource(source, books);
        if (!book) continue;
        pending.push({ lemma: word.lemma, source, bookId: book.id });
      }
    }
    if (pending.length === 0) return;
    let alive = true;
    void (async () => {
      const byId = new Map<string, typeof pending>();
      for (const item of pending) {
        const list = byId.get(item.bookId) ?? [];
        list.push(item);
        byId.set(item.bookId, list);
      }
      for (const [id, list] of byId) {
        const stored = await loadStoredBook(id).catch(() => null);
        if (!alive || !stored) continue;
        for (const item of list) {
          const surface = item.source.ref?.form || item.source.surface || item.lemma;
          const key = item.source.ref
            ? glossCacheKey(item.source.ref, item.source.book)
            : bookGlossKey(item.source.book);
          const file = files.get(key);
          const hint = file && item.source.ref ? (readPoint(item.source.ref, item.lemma, file)?.sentence ?? "") : "";
          const settled = Boolean(file) || glossSettled(key);
          const sentence = restoreParagraph({
            surface,
            phrase: item.source.ref?.phrase === true || /\s/.test(item.source.surface),
            chapter: item.source.ref?.chapter ?? item.source.chapter,
            occurrence: item.source.ref?.occurrence,
            hint: settled ? hint : "",
            guess: settled,
            chapters: stored.chapters,
            extras: stored.extras,
          });
          if (!alive || !sentence) continue;
          fill(item.lemma, item.source.book, item.source.savedAt, sentence);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [words, books, files, fill]);
}
