import { BookMarked, CornerDownRight } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { jumpToSource } from "@/lib/jump-store";
import type { Book, VocabEntry } from "@/lib/vocab-model";
import { bookForSource } from "@/lib/wordbook";
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
  const sources = word.sources;
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
          return (
            <li key={`${source.book}#${source.sentence.slice(0, 40)}`} className="grid gap-1.5" data-word-source>
              {source.sentence ? (
                <p className="border-l-2 border-accent/40 pl-3 font-display text-[1.02rem] leading-relaxed text-ink">
                  <Highlighted sentence={source.sentence} surface={source.surface || word.surface} />
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
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-3 text-xs text-muted">
                <BookMarked className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate" lang="en">
                  {title}
                  {chapter ? <> · {chapter}</> : null}
                </span>
                {canOpen ? (
                  <button
                    type="button"
                    className={cn(btn.ghost, "-my-1 min-h-9 px-2 text-xs text-accent")}
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
