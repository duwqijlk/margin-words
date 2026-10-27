import * as Dialog from "@radix-ui/react-dialog";
import { isbnDigits, readSeries } from "@/lib/book-meta";
import { useT } from "@/lib/i18n";
import type { Book } from "@/lib/vocab-model";
import { btn } from "@/components/ui";

/** Shelf facts only: opening this dialog never loads a catalog, blurb, or book body. */
export function ShelfBookInfo({
  book,
  classic,
  fileHere,
  due,
  open,
  onOpenChange,
  onReturnFocus,
}: {
  book: Book;
  classic: boolean;
  /** null while local file presence is still unknown. */
  fileHere: boolean | null;
  due: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
}) {
  const { t } = useT();
  const isbn = isbnDigits(book.isbn);
  const series = readSeries(book.series, book.seriesNumber);
  const match = typeof book.matchRate === "number" && Number.isFinite(book.matchRate)
    && book.matchRate >= 0 && book.matchRate <= 100 ? book.matchRate : null;
  const reason = book.oldFashionedReason?.trim();
  const fileStatus = book.needsEpub ? t("shelf.needsEpub")
    : book.source === "epub" && fileHere !== null ? t(fileHere ? "shelf.infoFileHere" : "shelf.fileMissing")
    : book.source === "notes" ? t("shelf.infoNotesOnly") : "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-pop glass"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          data-shelf-book-info=""
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl font-semibold">{t("shelf.info")}</Dialog.Title>
            <Dialog.Close type="button" className={btn.quiet}>{t("common.close")}</Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs leading-relaxed text-muted">
            {t("shelf.infoLocal")}
          </Dialog.Description>
          {book.title.trim() ? (
            <h3 className="mt-5 break-words font-display text-lg leading-snug font-semibold" lang="en">
              {book.title}
            </h3>
          ) : null}
          <dl className="mt-4 grid gap-4 text-sm leading-relaxed [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-muted [&_dd]:mt-0.5 [&_dd]:break-words">
            {book.author.trim() ? (
              <div data-info-author="">
                <dt>{t("shelf.authorLabel")}</dt>
                <dd lang="en">{book.author}</dd>
              </div>
            ) : null}
            {series.series ? (
              <div data-info-series="">
                <dt>{t("shelf.seriesLabel")}</dt>
                <dd>
                  <span lang="en">{series.series}</span>
                  {series.seriesNumber > 0 ? ` · ${t("shelf.infoSeriesNumber", { n: series.seriesNumber })}` : ""}
                </dd>
              </div>
            ) : null}
            {book.lexile?.trim() ? (
              <div data-info-lexile="">
                <dt>{t("lexile.name")}</dt>
                <dd lang="en">{book.lexile}</dd>
              </div>
            ) : null}
            {isbn ? (
              <div data-info-isbn="">
                <dt>{t("isbn.name")}</dt>
                <dd className="tabular-nums" lang="en">{isbn}</dd>
              </div>
            ) : null}
            {match !== null ? (
              <div data-info-match={match}>
                <dt>{t("shelf.infoMatch")}</dt>
                <dd>
                  <p className={match < 80 ? "font-medium text-warn" : "font-medium"}>
                    {t("match.short", { n: Math.round(match) })}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t("shelf.infoMatchNote")}</p>
                </dd>
              </div>
            ) : null}
            {Number.isFinite(due) && due >= 0 ? (
              <div data-info-due={due}>
                <dt>{t("shelf.infoDue")}</dt>
                <dd className="tabular-nums">{t("shelf.due", { n: due })}</dd>
              </div>
            ) : null}
            {fileStatus ? (
              <div data-info-file="">
                <dt>{t("shelf.infoFile")}</dt>
                <dd>{fileStatus}</dd>
              </div>
            ) : null}
            {classic ? (
              <div data-info-public-domain="">
                <dt>{t("shelf.infoAvailability")}</dt>
                <dd>{t("shelf.classic")}</dd>
              </div>
            ) : null}
            {book.oldFashioned || reason ? (
              <div data-info-old-fashioned="">
                <dt>{t("shelf.infoLanguage")}</dt>
                <dd>
                  <p>{t("shelf.oldFashioned")} · {t("shelf.oldFashionedNote")}</p>
                  {reason ? <p className="mt-1 text-muted" lang="en">{reason}</p> : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
