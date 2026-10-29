import { CheckCircle2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { asFinishedAt, finishedDate } from "@/lib/reading-stats";
import { useVocab } from "@/lib/vocab-store";
import { btn, cn } from "@/components/ui";
import { ShareButton } from "@/components/share-button";

/**
 * Under the last chapter: mark the book as finished, or see when it was. The mark is the reader's
 * own; it does not change the reading place or the progress bar.
 */
export function FinishBook({ bookId }: { bookId: string }) {
  const { t, locale } = useT();
  const book = useVocab((state) => state.books.find((item) => item.id === bookId));
  const setBookFinished = useVocab((state) => state.setBookFinished);
  if (!book) return null;
  const finishedAt = asFinishedAt(book.finishedAt);
  return (
    <section
      className="grid gap-3 rounded-2xl border border-line bg-card/70 p-4 text-center"
      aria-label={t("finished.endTitle")}
      data-finish-book={finishedAt ? "done" : "open"}
    >
      {finishedAt ? (
        <>
          <p className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-ink">
            <CheckCircle2 className="size-4 text-accent" aria-hidden />
            {t("finished.doneOn", { date: finishedDate(finishedAt, locale) })}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <ShareButton what={{ kind: "book", bookId }} className="min-h-9 text-xs" />
            <button
              type="button"
              className={cn(btn.quiet, "min-h-9 text-xs")}
              onClick={() => setBookFinished(bookId, false)}
              data-finish-undo
            >
              {t("finished.unmark")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-bold tracking-[-0.02em] text-base text-ink">{t("finished.endTitle")}</p>
          <p className="text-xs text-muted">{t("finished.endBody")}</p>
          <div className="flex justify-center">
            <button
              type="button"
              className={cn(btn.primary, "min-h-10")}
              onClick={() => setBookFinished(bookId, true)}
              data-finish-mark
            >
              <CheckCircle2 className="size-4" aria-hidden />
              {t("finished.mark")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
