import { CornerDownRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { loadStoredBook } from "@/lib/book-db";
import { jumpToSource } from "@/lib/jump-store";
import { focusSentence, recoverClippedSentence, sentenceHasWord } from "@/lib/text";
import type { Book, VocabEntry, WordSource } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { bookForSource, sourceBelongsTo } from "@/lib/wordbook";
import { btn, cn, Highlighted } from "@/components/ui";

/** Stable while a restored paragraph is written in. The sentence text is not part of the key. */
function sourceRowKey(source: WordSource): string {
  const ref = source.ref;
  if (ref?.list) {
    return `${source.book}|${ref.list}|${ref.phrase ? "p" : "w"}|${ref.chapter ?? ""}|${ref.occurrence ?? ""}|${ref.form ?? ""}|${ref.mark ?? ""}`;
  }
  return `${source.book}|${source.savedAt}|${source.chapter ?? ""}|${source.surface}`;
}

/** Where a saved word was met: the sentence with the word marked, the book and chapter, and a way back to it. */
export function WordSources({
  word,
  books,
  limit = 2,
  showMeaning = true,
  look = "row",
  note,
  className,
}: {
  word: VocabEntry;
  books: readonly Book[];
  /** how many places show before "more" */
  limit?: number;
  /** The meaning stays hidden until the reader asks, so a review card can show the sentence first. */
  showMeaning?: boolean;
  /**
   * `row`: the notebook (design system WordRow): meaning, then the sentence in Literata italic, then
   * the book line. `card`: the review card (ReviewCard): the sentence larger and upright, centred,
   * the book line under it; the meaning, when shown, comes after.
   */
  look?: "row" | "card";
  /** Added to the first book line, e.g. how often the word appears. */
  note?: string;
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
  const card = look === "card";
  let lastMeaning = "";
  return (
    <div className={cn("grid gap-3", card && "text-center", className)} data-word-sources>
      <ul className={cn("m-0 grid list-none p-0", card ? "gap-4" : "gap-3")}>
        {shown.map((source, index) => {
          const book = bookForSource(source, books);
          const title = source.title || book?.title || "";
          const chapter =
            source.chapterTitle || (source.chapter !== undefined ? t("src.chapterN", { n: source.chapter + 1 }) : "");
          const canOpen = book !== undefined && book.source === "epub" && !book.needsEpub;
          const meaning = source.meaning || word.meaning;
          const pos = source.pos || word.pos;
          const surface = source.surface || word.surface || word.lemma;
          const sentence = source.sentence ? focusSentence(source.sentence, surface) : "";
          // One meaning for the common case of the same sense in two books; a different sense shows its own.
          const sayMeaning = showMeaning && Boolean(meaning) && meaning !== lastMeaning;
          if (sayMeaning) lastMeaning = meaning;
          const meaningLine = sayMeaning ? (
            <p
              className={cn("m-0 wrap-any", card ? "text-xl leading-snug" : "text-base leading-normal")}
              lang="en"
              data-source-meaning
            >
              {!card && pos ? <span className="mr-1.5 text-[13px] text-faint">{pos}</span> : null}
              {meaning}
            </p>
          ) : null;
          return (
            <li key={sourceRowKey(source)} className={cn("grid min-w-0", card ? "gap-2" : "gap-1.5")} data-word-source>
              {!card ? meaningLine : null}
              {sentence ? (
                <p
                  className={cn(
                    "source-sentence m-0 font-display wrap-any",
                    card ? "text-[17px] leading-relaxed text-ink sm:text-[19px]" : "text-[15px] leading-relaxed text-muted italic",
                  )}
                  data-source-sentence
                >
                  <Highlighted sentence={sentence} surface={surface} />
                </p>
              ) : null}
              <p
                className={cn(
                  "m-0 flex min-w-0 items-center gap-x-2 text-[13px] text-faint sm:flex-wrap",
                  card && "justify-center",
                )}
              >
                <span
                  className={cn("min-w-0 truncate sm:overflow-visible sm:whitespace-normal sm:wrap-any", !card && "flex-1 sm:flex-none")}
                  data-source-place
                  title={[title, chapter].filter(Boolean).join(" · ")}
                >
                  <span lang="en">
                    {title}
                    {chapter ? <> · {chapter}</> : null}
                  </span>
                  {index === 0 && note ? <> · {note}</> : null}
                </span>
                {canOpen ? (
                  <button
                    type="button"
                    className={cn(btn.bare, "-my-1 min-h-9 shrink-0 px-2 text-[13px] text-accent")}
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
              {card && sayMeaning ? (
                <div className="grid gap-1.5 border-t border-line pt-4 text-center">
                  {pos ? <span className="text-[13px] text-faint" lang="en">{pos}</span> : null}
                  {meaningLine}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sources.length > limit ? (
        <button
          type="button"
          className={cn(btn.bare, "min-h-9 px-2 text-xs text-muted", card ? "justify-self-center" : "justify-self-start")}
          onClick={() => setAll((value) => !value)}
        >
          {all ? t("src.fewer") : tn("src.more", sources.length - limit)}
        </button>
      ) : null}
    </div>
  );
}
