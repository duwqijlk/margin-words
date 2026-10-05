import { BookMarked, CornerDownRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { loadStoredBook } from "@/lib/book-db";
import { jumpToSource } from "@/lib/jump-store";
import { focusSentence, recoverClippedSentence, sentenceHasWord } from "@/lib/text";
import type { Book, VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { bookForSource, sourceBelongsTo, sourceKey } from "@/lib/wordbook";
import { btn, chip, cn, Highlighted } from "@/components/ui";

/** Where a saved word was met: the sentence with the word marked, the book and chapter, and a way back to it. */
export function WordSources({
  word,
  books,
  limit = 2,
  showMeaning = true,
  className,
}: {
  word: VocabEntry;
  books: readonly Book[];
  /** how many places show before "more" */
  limit?: number;
  /** The meaning stays hidden until the reader asks, so a review card can show the sentence first. */
  showMeaning?: boolean;
  className?: string;
}) {
  const { t, tn } = useT();
  const [all, setAll] = useState(false);
  const repairSourceSentence = useVocab((state) => state.repairSourceSentence);
  const sources = useMemo(
    () => word.sources.filter((source) => sourceBelongsTo(word, source)),
    [word],
  );
  // Older saves cut a long sentence from the start, so the word itself was left off the end.
  // When this device still has the book, put the word back into the excerpt.
  useEffect(() => {
    const pending = sources.filter((source) => {
      if (source.ref || !source.sentence) return false;
      const surface = source.surface || word.surface || word.lemma;
      return !sentenceHasWord(source.sentence, surface);
    });
    if (pending.length === 0) return;
    let alive = true;
    void (async () => {
      const byId = new Map<string, typeof pending>();
      for (const source of pending) {
        const book = bookForSource(source, books);
        if (!book) continue;
        const list = byId.get(book.id) ?? [];
        list.push(source);
        byId.set(book.id, list);
      }
      for (const [id, list] of byId) {
        const stored = await loadStoredBook(id).catch(() => null);
        if (!alive || !stored) continue;
        const paragraphs = [
          ...stored.chapters.flatMap((chapter) => chapter.paragraphs),
          ...(stored.extras ?? []).flatMap((extra) => extra.paragraphs),
        ];
        for (const source of list) {
          const sentence = source.sentence;
          if (!sentence || source.ref) continue;
          const surface = source.surface || word.surface || word.lemma;
          const next = recoverClippedSentence(sentence, surface, paragraphs);
          if (next) repairSourceSentence(word.lemma, source.book, sentence, next);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [books, repairSourceSentence, sources, word.lemma, word.surface]);
  if (sources.length === 0) return null;
  const shown = all ? sources : sources.slice(0, limit);
  return (
    <div className={cn("grid gap-2.5", className)} data-word-sources>
      <ul className="grid gap-2.5">
        {shown.map((source) => {
          const book = bookForSource(source, books);
          const title = source.title || book?.title || "";
          const chapter =
            source.chapterTitle || (source.chapter !== undefined ? t("src.chapterN", { n: source.chapter + 1 }) : "");
          const canOpen = book !== undefined && book.source === "epub" && !book.needsEpub;
          const meaning = source.meaning || word.meaning;
          const pos = source.pos || word.pos;
          const surface = source.surface || word.surface || word.lemma;
          const sentence = source.sentence ? focusSentence(source.sentence, surface) : "";
          return (
            <li key={sourceKey(source)} className="grid min-w-0 gap-1.5" data-word-source>
              {sentence ? (
                <p className="border-l-2 border-accent/40 pl-3 font-display text-[1.02rem] leading-relaxed break-words text-ink">
                  <Highlighted sentence={sentence} surface={surface} />
                </p>
              ) : null}
              {showMeaning && (meaning || pos) ? (
                <div className="grid gap-1.5 pl-3">
                  {pos ? (
                    <div>
                      <span className={cn(chip, "bg-accent-soft text-accent")}>
                        <span lang="en">{pos}</span>
                      </span>
                    </div>
                  ) : null}
                  {meaning ? (
                    <p className="text-[1.02rem] leading-relaxed" lang="en" data-source-meaning>
                      {meaning}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="flex min-w-0 items-center gap-x-2 pl-3 text-xs text-muted sm:flex-wrap sm:items-start sm:gap-y-1">
                <BookMarked className="size-3.5 shrink-0 sm:mt-0.5" aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate sm:overflow-visible sm:whitespace-normal sm:break-words"
                  lang="en"
                  data-source-place
                  title={[title, chapter].filter(Boolean).join(" · ")}
                >
                  {title}
                  {chapter ? <> · {chapter}</> : null}
                </span>
                {canOpen ? (
                  <button
                    type="button"
                    className={cn(btn.ghost, "-my-1 min-h-9 shrink-0 px-2 text-xs text-accent")}
                    onClick={() => jumpToSource(source, book)}
                    data-source-open
                  >
                    <CornerDownRight className="size-3.5" aria-hidden />
                    {t("src.open")}
                  </button>
                ) : book === undefined ? (
                  <span className="shrink-0">{t("src.notOnShelf")}</span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      {sources.length > limit ? (
        <button
          type="button"
          className={cn(btn.ghost, "min-h-9 justify-self-start px-2 text-xs text-muted")}
          onClick={() => setAll((value) => !value)}
        >
          {all ? t("src.fewer") : tn("src.more", sources.length - limit)}
        </button>
      ) : null}
    </div>
  );
}
