import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { loadPackRecord } from "@/lib/book-db";
import { EDITION_MATCH_OK } from "@/lib/edition-match";
import { errorText, useT } from "@/lib/i18n";
import { fetchWordList, previewOwnEpub, savePaired, type PairPreview } from "@/lib/pair-epub";
import { useVocab } from "@/lib/vocab-store";
import { loadWordListCatalog, type WordListPack } from "@/lib/word-list-catalog";
import { btn, cn } from "@/components/ui";

/**
 * Ask for the reader's own e-book of a word-list title already on the shelf.
 * A match under 80% is shown before the book is saved.
 */
export function OwnEpubDialog({
  bookId,
  onClose,
  onSaved,
}: {
  bookId: string | null;
  onClose: () => void;
  onSaved: (bookId: string) => void;
}) {
  const { t } = useT();
  const shelfIsbn = useVocab((state) => state.books.find((item) => item.id === bookId)?.isbn ?? "");
  const [pack, setPack] = useState<WordListPack | null>(null);
  const [pending, setPending] = useState<PairPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPending(null);
    setError("");
    setPack(null);
    if (!bookId) return;
    let alive = true;
    void (async () => {
      const record = await loadPackRecord(bookId);
      if (!record || !alive) return;
      const lists = await loadWordListCatalog();
      if (!alive) return;
      setPack(lists.find((item) => item.id === record.packId) ?? null);
    })().catch(() => {
      if (alive) setError(t("err.bookAddFailed"));
    });
    return () => {
      alive = false;
    };
  }, [bookId, t]);

  const low = pending !== null && pending.match.kind !== "none" && pending.percent < EDITION_MATCH_OK * 100;
  const isbn = pack?.isbn || shelfIsbn;

  async function onFile(file: File | undefined) {
    if (!file || !pack) return;
    setError("");
    setBusy(true);
    try {
      const glossaryText = await fetchWordList(pack);
      setPending(await previewOwnEpub(file, pack, glossaryText));
    } catch (reason) {
      setError(errorText(reason, "err.bookAddFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={bookId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 text-ink shadow-pop">
          <Dialog.Title className="font-display text-xl font-semibold">{t("discover.promptTitle")}</Dialog.Title>
          <Dialog.Description className={cn("mt-3 text-sm", low ? "text-warn" : "text-ink")} data-match-rate={pending ? "" : undefined}>
            {pending
              ? pending.match.kind === "none"
                ? t("lists.matchNone")
                : low
                  ? t("lists.matchWarn", { n: pending.percent })
                  : t("lists.match", { n: pending.percent })
              : isbn
                ? t("discover.prompt", { isbn })
                : t("discover.promptPlain")}
          </Dialog.Description>
          {error ? (
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close className={btn.quiet}>{t("common.close")}</Dialog.Close>
            {pending ? (
              <button
                type="button"
                className={btn.primary}
                onClick={() => {
                  const preview = pending;
                  if (!preview || !bookId) return;
                  setBusy(true);
                  void savePaired(preview)
                    .then((saved) => {
                      const { books, addBook, setBookDetails } = useVocab.getState();
                      if (!books.some((book) => book.id === saved.bookId))
                        addBook(saved.title, saved.author, "epub", saved.bookId);
                      setBookDetails([
                        {
                          id: saved.bookId,
                          lexile: saved.lexile,
                          isbn: saved.isbn,
                          series: saved.series,
                          seriesNumber: saved.seriesNumber,
                          matchRate: preview.percent,
                          needsEpub: false,
                          source: "epub",
                        },
                      ]);
                      onSaved(saved.bookId);
                    })
                    .catch((reason) => {
                      setError(errorText(reason, "err.bookAddFailed"));
                      setBusy(false);
                    });
                }}
              >
                {t("lists.add")}
              </button>
            ) : (
              <label className={cn(btn.primary, busy || !pack ? "pointer-events-none opacity-60" : "")}>
                {busy ? t("lists.working") : t("discover.addEpub")}
                <input
                  data-own-epub
                  className="sr-only"
                  type="file"
                  accept=".epub,application/epub+zip"
                  disabled={!pack || busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void onFile(file);
                  }}
                />
              </label>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
