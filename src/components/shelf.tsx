import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  BookPlus,
  FileJson,
  MoreVertical,
  Pencil,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listPackRecords, type PackRecord } from "@/lib/book-db";
import { holdOffersUpdate, type ListHoldWhy } from "@/lib/word-list-plan";
import { updateInstalledBook, useListUpdates } from "@/lib/word-list-update";
import {
  overallProgress,
  relativeTime,
  useProgress,
  type BookProgress,
} from "@/lib/progress-store";
import { summarize } from "@/lib/srs";
import { useVocab } from "@/lib/vocab-store";
import type { Book, VocabEntry } from "@/lib/vocab-model";
import { useT, type Key } from "@/lib/i18n";
import { useClassicBookIds, useClassicsRunning } from "@/lib/classics";
import { bookHasUserWork } from "@/lib/shelf-work";
import { bookSyncKey } from "@/lib/sync-merge";
import { wordsFromBook } from "@/lib/wordbook";
import { useShelfRemove } from "@/lib/shelf-remove";
import { BookCover } from "@/components/book-cover";
import { navigate } from "@/lib/router";
import { CoverBadge, OldFashionedBadge } from "@/components/cover-marks";
import { btn, cn, field, ProgressBar } from "@/components/ui";
import { compareLexile } from "@/lib/lexile";
import {
  BookMetaLines,
  DifficultyControls,
  LexileBadge,
  matchesBand,
  type BandChoice,
  type SortChoice,
} from "@/components/lexile-ui";
import {
  bookCardGrid,
  bookCardShell,
  cardAuthorClass,
  cardTitleClass,
  FilterMenu,
  ListFilters,
  type SeriesChoice,
} from "@/components/list-filters";

type Row = {
  book: Book;
  progress: BookProgress | undefined;
  fraction: number;
  words: number;
  due: number;
};

type ListOffer = { why: ListHoldWhy; failure: string };

function offerLine(offer: ListOffer, t: (key: Key, params?: Record<string, string | number>) => string): {
  text: string;
  warn: boolean;
} {
  if (offer.failure) return { text: offer.failure, warn: true };
  if (offer.why === "bookChanged") return { text: t("lists.keptBook"), warn: true };
  return { text: t("lists.newList"), warn: false };
}

/** A cover tag the size of Public domain. Tapping it runs the update. */
function CoverUpdate({
  title,
  offer,
  busy,
  onUpdate,
}: {
  title: string;
  offer: ListOffer;
  busy: boolean;
  onUpdate: () => void;
}) {
  const { t } = useT();
  const line = offerLine(offer, t);
  const label = busy ? t("lists.updating") : t("pack.update");
  return (
    <CoverBadge
      tone="publicDomain"
      onClick={onUpdate}
      disabled={busy}
      title={line.text}
      aria-label={`${label}: ${title}`}
      data-list-update={offer.why}
      data-list-update-button=""
    >
      {label}
    </CoverBadge>
  );
}

function RenameDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const { t } = useT();
  const renameBook = useVocab((state) => state.renameBook);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author);
    }
  }, [book]);
  return (
    <Dialog.Root open={book !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 text-ink shadow-pop">
          <Dialog.Title className="font-display text-xl font-semibold">
            {t("rename.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{t("rename.desc")}</Dialog.Description>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!book || !title.trim()) return;
              renameBook(book.id, title, author);
              onClose();
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              {t("rename.titleField")}
              <input
                className={field}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t("rename.authorField")}
              <input
                className={field}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={80}
              />
            </label>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close className={btn.quiet}>{t("common.cancel")}</Dialog.Close>
              <button type="submit" className={btn.primary}>
                {t("common.save")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ContinueCard({
  row,
  cover,
  offer,
  updating,
  onOpen,
  onUpdate,
}: {
  row: Row;
  cover?: string;
  offer: ListOffer | null;
  updating: boolean;
  onOpen: () => void;
  onUpdate: () => void;
}) {
  const { t } = useT();
  const { book, progress, fraction } = row;
  const started = Boolean(progress && progress.updatedAt > 0 && fraction > 0);
  const pct = Math.round(fraction * 100);
  return (
    <section
      aria-label={t("shelf.continueReading")}
      className="hidden items-center gap-4 rounded-3xl border border-line p-4 shadow-sm sm:flex sm:gap-8 sm:p-6"
      style={{
        backgroundImage:
          "linear-gradient(120deg, color-mix(in srgb, var(--accent-soft) 85%, var(--card)), var(--card) 70%)",
      }}
    >
      <div className="relative w-24 shrink-0 sm:w-36">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-md text-left"
          aria-label={t("shelf.openAria", { title: book.title })}
        >
          <BookCover title={book.title} author={book.author} cover={cover} />
        </button>
        {offer ? (
          <div className="pointer-events-none absolute top-1.5 left-1.5 z-[1] flex max-w-[calc(100%-0.75rem)]">
            <CoverUpdate title={book.title} offer={offer} busy={updating} onUpdate={onUpdate} />
          </div>
        ) : null}
      </div>
      <div className="grid min-w-0 flex-1 content-center gap-1.5 sm:gap-2.5">
        <p className="text-xs font-bold tracking-wider text-accent uppercase">
          {started ? t("shelf.continueReading") : t("shelf.startReading")}
        </p>
        <h2
          className="font-display text-[1.3rem] leading-snug font-semibold sm:text-[2rem] sm:leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          lang="en"
        >
          {book.title}
        </h2>
        {book.author ? (
          <p className="truncate text-sm text-muted" lang="en">
            {book.author}
          </p>
        ) : null}
        <LexileBadge measure={book.lexile} />
        {started && progress ? (
          <div className="grid gap-1.5 pt-1">
            <ProgressBar value={fraction} className="h-1.5" label={t("shelf.progress")} />
            <p className="text-xs text-muted tabular-nums">
              {t("shelf.chapterOf", { n: progress.chapter + 1, total: progress.chapters })} · {pct}%
              {progress.updatedAt ? ` · ${relativeTime(progress.updatedAt)}` : ""}
            </p>
          </div>
        ) : null}
        <div className="pt-1.5 sm:pt-2">
          <button
            type="button"
            className={cn(btn.primary, "max-sm:w-full sm:px-6")}
            onClick={onOpen}
          >
            <BookOpen className="size-4" aria-hidden />
            {started ? t("shelf.continue") : t("shelf.start")}
          </button>
        </div>
      </div>
    </section>
  );
}

function ShelfSkeleton() {
  return (
    <div className="grid gap-6 sm:gap-8" aria-busy="true">
      <div className="hidden h-60 animate-pulse rounded-3xl bg-line sm:block" />
      <div className={bookCardGrid}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="grid gap-2">
            <div className="aspect-[2/3] animate-pulse rounded-md bg-line" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** An empty shelf is one door to Discover. Books are added there, and only there. */
function EmptyShelf({ onDiscover }: { onDiscover: () => void }) {
  const { t } = useT();
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <button
        type="button"
        className="min-h-11 text-base font-semibold text-accent underline underline-offset-4"
        onClick={onDiscover}
        data-empty-discover
      >
        {t("shelf.findBooks")}
      </button>
    </div>
  );
}

const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-accent-soft";

function BookCard({
  row,
  cover,
  classic,
  fileHere,
  offer,
  updating,
  onOpen,
  onNotebook,
  onAddList,
  onRename,
  onUpdate,
}: {
  row: Row;
  cover?: string;
  classic: boolean;
  /** false when the shelf card is here but the book file is not */
  fileHere: boolean;
  offer: ListOffer | null;
  updating: boolean;
  onOpen: () => void;
  onNotebook: () => void;
  onAddList: () => void;
  onRename: () => void;
  onUpdate: () => void;
}) {
  const { t } = useT();
  const { book } = row;
  const pct = Math.round(row.fraction * 100);
  return (
    <li className={bookCardShell}>
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-md text-left"
          aria-label={t("shelf.openAria", { title: book.title })}
        >
          <BookCover title={book.title} author={book.author} cover={cover} />
        </button>
        <div className="pointer-events-none absolute top-2 left-2 z-[1] flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
          {offer ? <CoverUpdate title={book.title} offer={offer} busy={updating} onUpdate={onUpdate} /> : null}
          {book.needsEpub ? (
            <CoverBadge tone="needs" data-needs-epub="">
              {t("shelf.needsEpub")}
            </CoverBadge>
          ) : book.source === "epub" && !fileHere ? (
            <CoverBadge tone="needs" data-file-missing="">
              {t("shelf.fileMissing")}
            </CoverBadge>
          ) : classic ? (
            <CoverBadge tone="publicDomain" data-classic-label="">
              {t("shelf.classic")}
            </CoverBadge>
          ) : null}
          {book.oldFashioned ? <OldFashionedBadge reason={book.oldFashionedReason} /> : null}
        </div>
        {book.source === "epub" ? (
          <div className="cover-progress pointer-events-none absolute inset-x-0 bottom-0 z-[1]">
            <p className="cover-progress-detail items-end justify-between gap-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2 pt-7 pb-1 text-[0.68rem] leading-4 font-semibold text-white">
              <span>{pct > 0 ? `${pct}%` : t("shelf.new")}</span>
              {row.progress && row.progress.chapters > 0 ? (
                <span className="truncate text-right">
                  {t("shelf.chapterOf", { n: row.progress.chapter + 1, total: row.progress.chapters })}
                </span>
              ) : null}
            </p>
            <ProgressBar
              value={row.fraction}
              className="cover-progress-bar h-1 rounded-none bg-black/35"
              label={t("shelf.progressFor", { title: book.title })}
            />
          </div>
        ) : null}
        {row.due > 0 ? (
          <span className="pointer-events-none absolute right-2 bottom-3 z-[2] rounded-full bg-warn px-2 py-0.5 text-[0.7rem] font-bold text-accent-ink tabular-nums shadow">
            {t("shelf.due", { n: row.due })}
          </span>
        ) : null}
      </div>
      <div className="grid flex-1 content-start gap-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={onOpen}
            className={cn(cardTitleClass, "min-w-0 flex-1 text-left")}
            lang="en"
          >
            {book.title}
          </button>
          <Menu.Root>
            <Menu.Trigger
              className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent-soft hover:text-ink sm:-mr-2.5"
              aria-label={t("shelf.moreAria", { title: book.title })}
              data-shelf-more={offer ? "update" : "menu"}
            >
              <MoreVertical className="size-4" aria-hidden />
              {offer ? <span className="absolute top-2 right-2 size-2 rounded-full bg-accent" data-shelf-update-dot="" /> : null}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={4}
                className="anim-pop z-50 min-w-44 rounded-xl border border-line bg-card p-1.5 text-ink shadow-pop"
              >
                {offer ? (
                  <Menu.Item
                    className={menuItem}
                    disabled={updating}
                    onSelect={onUpdate}
                    data-list-update-menu=""
                  >
                    <RotateCw className={cn("size-4", updating && "animate-spin")} aria-hidden />
                    {updating ? t("lists.updating") : t("pack.update")}
                  </Menu.Item>
                ) : null}
                <Menu.Item className={menuItem} onSelect={onNotebook}>
                  <BookPlus className="size-4" aria-hidden />
                  {t("shelf.menuWords")}
                </Menu.Item>
                {book.source === "epub" ? (
                  <Menu.Item className={menuItem} onSelect={onAddList}>
                    <FileJson className="size-4" aria-hidden />
                    {t("shelf.menuAddList")}
                  </Menu.Item>
                ) : null}
                <Menu.Item className={menuItem} onSelect={onRename}>
                  <Pencil className="size-4" aria-hidden />
                  {t("shelf.menuEdit")}
                </Menu.Item>
                <Menu.Separator className="my-1 h-px bg-line" />
                <Menu.Item
                  className={cn(menuItem, "text-warn data-[highlighted]:bg-warn-soft")}
                  data-shelf-remove=""
                  onSelect={() =>
                    useShelfRemove.getState().ask(
                      book,
                      bookHasUserWork({
                        source: book.source,
                        needsEpub: book.needsEpub,
                        classic,
                        savedWords: 0,
                        progress: row.progress ?? null,
                      }),
                      row.words,
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("discover.remove")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <p className={cardAuthorClass} lang="en">
          {book.author}
        </p>
        <div className="max-sm:hidden">
          <BookMetaLines
            lexile={book.lexile}
            isbn={book.isbn}
            series={book.series}
            seriesNumber={book.seriesNumber}
            matchRate={book.matchRate}
            aside={book.oldFashioned ? t("shelf.oldFashionedNote") : undefined}
          />
        </div>
      </div>
      {book.source === "epub" ? null : (
        <p className="mt-auto flex min-h-11 items-center text-xs text-muted" data-card-actions>
          {t("shelf.sampleNotebook")}
        </p>
      )}
    </li>
  );
}

/** Books to show before a search box is useful. */
const SEARCH_FROM = 8;

export function Shelf({
  books,
  words,
  covers,
  ready,
  storedIds,
  onOpen,
  onNotebook,
  onAddList,
}: {
  books: Book[];
  words: VocabEntry[];
  covers: Record<string, string>;
  ready: boolean;
  /** ids whose book file is on this device; null until that list has been read */
  storedIds: Set<string> | null;
  onOpen: (bookId: string) => void;
  onNotebook: (bookId: string) => void;
  onAddList: (bookId: string | null) => void;
}) {
  const { t } = useT();
  const progress = useProgress((state) => state.items);
  const pendingId = useShelfRemove((state) => state.pending?.bookId ?? "");
  const classicIds = useClassicBookIds(books.map((book) => book.id).join("|"));
  const installingClassics = useClassicsRunning((state) => state.running);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("recent");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [renaming, setRenaming] = useState<Book | null>(null);
  const [updatingId, setUpdatingId] = useState("");
  const [packRecords, setPackRecords] = useState<PackRecord[]>([]);
  const holds = useListUpdates((state) => state.holds);
  const failures = useListUpdates((state) => state.failures);
  const listsFinished = useListUpdates((state) => state.finished);
  useEffect(() => {
    let alive = true;
    void listPackRecords()
      .then((rows) => {
        if (alive) setPackRecords(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [listsFinished, books.length]);
  const offerByBook = useMemo(() => {
    const map = new Map<string, ListOffer>();
    for (const record of packRecords) {
      const why = holds[record.packId];
      if (!why || !holdOffersUpdate(why)) continue;
      map.set(record.bookId, { why, failure: failures[record.packId] ?? "" });
    }
    return map;
  }, [packRecords, holds, failures]);
  function updateBook(bookId: string) {
    if (updatingId) return;
    setUpdatingId(bookId);
    void updateInstalledBook(bookId)
      .catch(() => undefined)
      .finally(() => setUpdatingId(""));
  }

  const liveBooks = useMemo(
    () => books.filter((book) => book.id !== pendingId),
    [books, pendingId],
  );
  const rows = useMemo<Row[]>(
    () =>
      liveBooks.map((book) => {
        const mine = wordsFromBook(words, bookSyncKey(book));
        const stat = summarize(mine);
        return {
          book,
          progress: progress[book.id],
          fraction: overallProgress(progress[book.id]),
          words: mine.length,
          due: stat.due,
        };
      }),
    [liveBooks, words, progress],
  );

  /** Recent first: the book read last, then the book added last. */
  const recent = useMemo(() => {
    const lastOf = (row: Row) => row.progress?.updatedAt ?? 0;
    return [...rows].sort((a, b) => lastOf(b) - lastOf(a) || b.book.updatedAt - a.book.updatedAt);
  }, [rows]);

  const hero = useMemo(() => recent.find((row) => row.book.source === "epub") ?? null, [recent]);

  const authors = useMemo(
    () => [...new Set(rows.map((row) => row.book.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const seriesNames = useMemo(
    () => [...new Set(rows.map((row) => row.book.series ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const searched = q
      ? recent.filter((row) => `${row.book.title} ${row.book.author}`.toLowerCase().includes(q))
      : recent;
    let banded = searched.filter((row) => matchesBand(row.book.lexile ?? "", band));
    if (author !== "all") banded = banded.filter((row) => row.book.author === author);
    if (series === "none") banded = banded.filter((row) => !row.book.series);
    else if (series !== "all" && series !== "grouped") banded = banded.filter((row) => row.book.series === series);
    if (series === "grouped") {
      return [...banded].sort(
        (a, b) =>
          (a.book.series ?? "\uffff").localeCompare(b.book.series ?? "\uffff") ||
          (a.book.seriesNumber ?? 99) - (b.book.seriesNumber ?? 99) ||
          a.book.title.localeCompare(b.book.title),
      );
    }
    if (sort === "recent" || sort === "listed") return banded;
    const copy = [...banded];
    if (sort === "title") copy.sort((a, b) => a.book.title.localeCompare(b.book.title) || a.book.author.localeCompare(b.book.author));
    else copy.sort((a, b) => compareLexile(a.book.lexile ?? "", b.book.lexile ?? "", sort) || a.book.title.localeCompare(b.book.title));
    return copy;
  }, [recent, q, band, sort, author, series]);
  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(visible.map((row) => row.book.series ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: visible
        .filter((row) => row.book.series === name)
        .sort((a, b) => (a.book.seriesNumber ?? 0) - (b.book.seriesNumber ?? 0)),
    }));
    const rest = visible.filter((row) => !row.book.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [visible, series]);
  const renderCard = (row: Row) => (
    <BookCard
      key={row.book.id}
      row={row}
      cover={covers[row.book.id]}
      classic={classicIds.has(row.book.id)}
      fileHere={storedIds === null || storedIds.has(row.book.id) || row.book.needsEpub === true}
      offer={offerByBook.get(row.book.id) ?? null}
      updating={updatingId === row.book.id}
      onOpen={() => onOpen(row.book.id)}
      onNotebook={() => onNotebook(row.book.id)}
      onAddList={() => onAddList(row.book.id)}
      onRename={() => setRenaming(row.book)}
      onUpdate={() => updateBook(row.book.id)}
    />
  );
  const filtering = band !== "all" || author !== "all" || series !== "all" || (sort !== "recent" && sort !== "listed");

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
      {!ready || (books.length === 0 && installingClassics) ? (
        <ShelfSkeleton />
      ) : books.length === 0 ? (
        <EmptyShelf onDiscover={() => navigate({ kind: "discover" })} />
      ) : liveBooks.length === 0 ? null : (
        <>
          {hero && !q && !filtering ? (
            <ContinueCard
              row={hero}
              cover={covers[hero.book.id]}
              offer={offerByBook.get(hero.book.id) ?? null}
              updating={updatingId === hero.book.id}
              onOpen={() => onOpen(hero.book.id)}
              onUpdate={() => updateBook(hero.book.id)}
            />
          ) : null}

          <section className="grid gap-4" aria-label={t("shelf.all")}>
            <div className="grid gap-3">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3",
                  hero && !q && !filtering ? "justify-end sm:justify-between" : "justify-end",
                )}
              >
                <h2
                  className={cn(
                    "font-display text-xl font-semibold",
                    hero && !q && !filtering ? "hidden sm:block" : "sr-only",
                  )}
                >
                  {t("shelf.all")}
                </h2>
                {liveBooks.length >= 2 ? (
                  <FilterMenu
                    active={sort !== "recent" || band !== "all" || author !== "all" || series !== "all"}
                    render={() => (
                      <>
                        <DifficultyControls
                          sort={sort}
                          sorts={["recent", "easy", "hard", "title"]}
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
                      </>
                    )}
                  />
                ) : null}
              </div>
              {liveBooks.length >= SEARCH_FROM ? (
                <label className="relative block w-full sm:max-w-64">
                  <span className="sr-only">{t("shelf.search")}</span>
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <input
                    className={cn(field, "pl-9")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("shelf.search")}
                    type="search"
                  />
                </label>
              ) : null}
            </div>

            {visible.length === 0 && q ? (
              <p className="py-10 text-center text-muted">{t("shelf.noMatch", { query })}</p>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-muted">{t("lexile.none")}</p>
            ) : (
              series === "grouped" ? (
                <div className="grid gap-8">
                  {groups.map((group) => (
                    <div key={group.key} className="grid gap-4" data-series-group={group.key}>
                      <h3 className="font-display text-lg font-semibold" lang={group.title ? "en" : undefined}>
                        {group.title || t("shelf.series.none")}
                      </h3>
                      <ul className={bookCardGrid}>
                        {group.rows.map(renderCard)}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
              <ul className={bookCardGrid}>{visible.map(renderCard)}</ul>
              )
            )}
          </section>
        </>
      )}

      <RenameDialog book={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}
