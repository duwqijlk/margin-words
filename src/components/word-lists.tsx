import * as Dialog from "@radix-ui/react-dialog";
import { BookPlus, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookCover } from "@/components/shelf";
import { BookMetaLines, DifficultyControls, matchesBand, type BandChoice, type SortChoice } from "@/components/lexile-ui";
import { bookCardGrid, bookCardShell, ListFilters, type SeriesChoice } from "@/components/list-filters";
import { btn, cn } from "@/components/ui";
import { saveCachedText } from "@/lib/book-db";
import { EDITION_MATCH_OK } from "@/lib/edition-match";
import { errorText, useT } from "@/lib/i18n";
import { compareLexile } from "@/lib/lexile";
import { fetchWordList, previewOwnEpub, savePaired, type PairPreview } from "@/lib/pair-epub";
import { useVocab } from "@/lib/vocab-store";
import { loadWordListCatalog, type WordListPack } from "@/lib/word-list-catalog";

type Pending = PairPreview;

/**
 * Copyrighted books as word lists only. The reader prepares their own e-book and pairs it here.
 * Nothing on this screen links to a place to obtain a book.
 */
export function WordListSection({ onAdded }: { onAdded: (bookId: string) => void }) {
  const { t, tn } = useT();
  const [lists, setLists] = useState<WordListPack[]>([]);
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const chosen = useRef<WordListPack | null>(null);

  useEffect(() => {
    let alive = true;
    void loadWordListCatalog()
      .then((rows) => {
        if (alive) setLists(rows);
      })
      .catch(() => {
        if (alive) setLists([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const authors = useMemo(
    () => [...new Set(lists.map((item) => item.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [lists],
  );
  const seriesNames = useMemo(
    () => [...new Set(lists.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [lists],
  );
  const shown = useMemo(() => {
    let rows = lists.filter((item) => matchesBand(item.lexile, band));
    if (author !== "all") rows = rows.filter((item) => item.author === author);
    if (series === "none") rows = rows.filter((item) => !item.series);
    else if (series !== "all" && series !== "grouped") rows = rows.filter((item) => item.series === series);
    if (sort === "listed" || sort === "recent" || series === "grouped") return rows;
    const copy = [...rows];
    if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title));
    else copy.sort((a, b) => compareLexile(a.lexile, b.lexile, sort) || a.title.localeCompare(b.title));
    return copy;
  }, [lists, band, author, series, sort]);

  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(shown.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: shown.filter((item) => item.series === name).sort((a, b) => a.seriesNumber - b.seriesNumber || a.title.localeCompare(b.title)),
    }));
    const rest = shown.filter((item) => !item.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [shown, series]);

  async function download(pack: WordListPack) {
    setError("");
    setBusyId(pack.id);
    try {
      const text = await fetchWordList(pack);
      await saveCachedText(`wordlist:${pack.id}`, text);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pack.id}-glossary.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(errorText(reason, "err.bookAddFailed"));
    } finally {
      setBusyId("");
    }
  }

  async function onFile(file: File | undefined) {
    const pack = chosen.current;
    chosen.current = null;
    if (!file || !pack) return;
    setError("");
    setBusyId(pack.id);
    try {
      const glossaryText = await fetchWordList(pack);
      setPending(await previewOwnEpub(file, pack, glossaryText));
    } catch (reason) {
      setError(errorText(reason, "err.bookAddFailed"));
    } finally {
      setBusyId("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function renderCard(pack: WordListPack) {
    return (
      <li key={pack.id} className={bookCardShell} data-word-list={pack.id}>
        <BookCover title={pack.title} author={pack.author} />
        <div className="grid flex-1 content-start gap-0.5">
          <h3 className="min-h-[2.6em] overflow-hidden font-display text-[0.97rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" lang="en">
            {pack.title}
          </h3>
          {pack.author ? (
            <p className="truncate text-xs text-muted" lang="en">
              {pack.author}
            </p>
          ) : null}
          <BookMetaLines lexile={pack.lexile} isbn={pack.isbn} series={pack.series} seriesNumber={pack.seriesNumber} />
          <p className="text-xs text-muted">
            {pack.isbn ? t("lists.prepare", { isbn: pack.isbn }) : t("lists.preparePlain")}
          </p>
          {pack.words > 0 ? <p className="text-xs text-muted tabular-nums">{tn("count.word", pack.words)}</p> : null}
        </div>
        <div className="mt-auto grid gap-2" data-card-actions>
          <button
            type="button"
            className={cn(btn.quiet, "w-full text-accent")}
            disabled={busyId === pack.id}
            aria-label={t("lists.downloadAria", { title: pack.title })}
            onClick={() => void download(pack)}
          >
            <Download className="size-4" aria-hidden />
            {t("lists.download")}
          </button>
          <button
            type="button"
            className={cn(btn.primary, "w-full")}
            disabled={busyId === pack.id}
            aria-label={t("lists.addMineAria", { title: pack.title })}
            onClick={() => {
              chosen.current = pack;
              fileRef.current?.click();
            }}
          >
            <BookPlus className="size-4" aria-hidden />
            {busyId === pack.id ? t("lists.working") : t("lists.addMine")}
          </button>
        </div>
      </li>
    );
  }

  if (lists.length === 0) return null;

  const low = pending !== null && pending.match.kind !== "none" && pending.percent < EDITION_MATCH_OK * 100;

  return (
    <section className="grid gap-4" aria-label={t("lists.title")} data-word-lists>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{t("lists.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <DifficultyControls
            sort={sort}
            sorts={["listed", "easy", "hard", "title"]}
            onSort={setSort}
            band={band}
            onBand={setBand}
          />
          <ListFilters
            authors={authors}
            seriesNames={seriesNames}
            author={author}
            series={series}
            onAuthor={setAuthor}
            onSeries={setSeries}
          />
        </div>
      </div>
      <p className="text-sm text-muted" data-word-list-hint>
        {t("lists.hint")}
      </p>
      <input
        ref={fileRef}
        id="own-epub"
        data-own-epub
        className="sr-only"
        type="file"
        accept=".epub,application/epub+zip"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      {error ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">{t("shelf.series.empty")}</p>
      ) : series === "grouped" ? (
        <div className="grid gap-8">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-4" data-series-group={group.key}>
              <h3 className="font-display text-lg font-semibold" lang={group.title ? "en" : undefined}>
                {group.title || t("shelf.series.none")}
              </h3>
              <ul className={bookCardGrid}>{group.rows.map(renderCard)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className={bookCardGrid}>{shown.map(renderCard)}</ul>
      )}

      <Dialog.Root open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
          <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 text-ink shadow-pop">
            <Dialog.Title className="font-display text-xl font-semibold">{t("lists.matchTitle")}</Dialog.Title>
            <Dialog.Description className={cn("mt-3 text-sm", low ? "text-warn" : "text-ink")} data-match-rate>
              {pending?.match.kind === "none"
                ? t("lists.matchNone")
                : low
                  ? t("lists.matchWarn", { n: pending?.percent ?? 0 })
                  : t("lists.match", { n: pending?.percent ?? 0 })}
            </Dialog.Description>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close className={btn.quiet}>{t("common.close")}</Dialog.Close>
              <button
                type="button"
                className={btn.primary}
                onClick={() => {
                  const preview = pending;
                  setPending(null);
                  if (!preview) return;
                  void savePaired(preview)
                    .then((saved) => {
                      const { books, addBook } = useVocab.getState();
                      if (!books.some((book) => book.id === saved.bookId))
                        addBook(saved.title, saved.author, "epub", saved.bookId);
                      useVocab.getState().setBookDetails([
                        {
                          id: saved.bookId,
                          lexile: saved.lexile,
                          isbn: saved.isbn,
                          series: saved.series,
                          seriesNumber: saved.seriesNumber,
                          matchRate: preview.percent,
                        },
                      ]);
                      onAdded(saved.bookId);
                    })
                    .catch((reason) => setError(errorText(reason, "err.bookAddFailed")));
                }}
              >
                {t("lists.add")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
