import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CoverBadge, OldFashionedBadge } from "@/components/cover-marks";
import { BookCover } from "@/components/book-cover";
import { AddToShelfButton, ShelfCardStatus, type ShelfState } from "@/components/shelf-actions";
import { BookMetaLines, DifficultyControls, matchesBand, type BandChoice, type SortChoice } from "@/components/lexile-ui";
import {
  bookCardGrid,
  bookCardShell,
  cardAuthorClass,
  cardTitleClass,
  FilterMenu,
  ListFilters,
  type SeriesChoice,
} from "@/components/list-filters";
import { cn, field } from "@/components/ui";
import { listPackRecords, loadBookExtras, type PackRecord } from "@/lib/book-db";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst, type CatalogPack } from "@/lib/packs";
import { askToSignIn, useCanAddBooks } from "@/lib/can-add";
import { useDownloads } from "@/lib/downloads";
import { errorText, useT } from "@/lib/i18n";
import { compareLexile } from "@/lib/lexile";
import { placeWordList } from "@/lib/place-word-list";
import { findOnShelf } from "@/lib/shelf-identity";
import { useProgress } from "@/lib/progress-store";
import { bookHasUserWork } from "@/lib/shelf-work";
import { useShelfRemove } from "@/lib/shelf-remove";
import type { Book } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { countFromBook } from "@/lib/wordbook";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL, type WordListPack } from "@/lib/word-list-catalog";
import { CONTENT_CATEGORIES, type ContentCategory } from "@/lib/content-category";
import { RECENT_UPDATE_DAYS, recentUpdates } from "@/lib/discover-recent";
import { holdOffersUpdate, type ListHoldWhy } from "@/lib/word-list-plan";
import {
  autoUpdateWordLists,
  retryWordListUpdate,
  useListUpdates,
  wordListRev,
} from "@/lib/word-list-update";

/** How many cards to mount at once. The rest of the catalog stays in memory for search and filters. */
const DISCOVER_PAGE = 12;

/** Pack records plus the pack ids whose stored list the reader added or edited by hand. */
async function loadDiscoverRecords(): Promise<{ records: PackRecord[]; custom: Set<string> }> {
  const records = await listPackRecords();
  const sources = await Promise.all(
    records.map((record) =>
      loadBookExtras(record.bookId)
        .then((extras) => extras?.source)
        .catch(() => undefined),
    ),
  );
  const custom = new Set<string>();
  records.forEach((record, index) => {
    if (sources[index] === "custom") custom.add(record.packId);
  });
  return { records, custom };
}

function CardSkeleton() {
  return (
    <li className={bookCardShell} aria-hidden>
      <span className="block aspect-[2/3] w-full animate-pulse rounded-md bg-line" />
      <span className="mt-1 h-4 w-3/4 animate-pulse rounded bg-line" />
      <span className="h-3 w-1/2 animate-pulse rounded bg-line" />
      <span className="mt-auto h-3 w-2/3 animate-pulse rounded bg-line" />
    </li>
  );
}

type Row = {
  key: string;
  id: string;
  kind: "classic" | "list";
  title: string;
  author: string;
  lexile: string;
  isbn: string;
  series: string;
  seriesNumber: number;
  category: ContentCategory;
  oldFashioned: boolean;
  oldFashionedReason: string;
  coverUrl?: string;
  /** A day or an instant for when the word list last changed. "" when the catalog has neither. */
  updated: string;
  pack?: CatalogPack;
  list?: WordListPack;
};

/**
 * Every book we have, from the books host. The two catalog files are one fetch each. Covers load as
 * they come near the screen. A word list or an e-book is fetched only when the plus on a cover is tapped.
 */
export function DiscoverScreen({
  shelf,
  onOpen,
  onNeedsEpub,
}: {
  shelf: Book[];
  onOpen: (bookId: string) => void;
  onNeedsEpub: (bookId: string) => void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<PackRecord[]>([]);
  const [customPacks, setCustomPacks] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [category, setCategory] = useState<ContentCategory>("novel");
  const [error, setError] = useState("");
  const [listError, setListError] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const finished = useDownloads((state) => state.finished);
  const pendingId = useShelfRemove((state) => state.pending?.bookId ?? "");
  const items = useDownloads((state) => state.items);
  const start = useDownloads((state) => state.start);
  const canAdd = useCanAddBooks();
  const updateFailures = useListUpdates((state) => state.failures);
  const updateHolds = useListUpdates((state) => state.holds);
  const updatesFinished = useListUpdates((state) => state.finished);
  /** the card tapped while signed out: scroll back to it after sign-in */
  const signInFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [catalog, lists, shelfMarks] = await Promise.all([
          loadCatalog(BUNDLED_CATALOG_URL),
          // A word-list catalog that cannot be loaded must not hide the classics.
          // Those lists are not kept in the service worker.
          loadWordListCatalog().catch(() => [] as WordListPack[]),
          loadDiscoverRecords(),
        ]);
        if (!alive) return;
        const classics: Row[] = catalog.catalog.packs.map((pack) => ({
          key: `classic:${pack.id}`,
          id: pack.id,
          kind: "classic",
          title: pack.title,
          author: pack.author,
          lexile: pack.lexile,
          isbn: pack.isbn,
          series: pack.series,
          seriesNumber: pack.seriesNumber,
          category: pack.category,
          oldFashioned: pack.oldFashioned,
          oldFashionedReason: pack.oldFashionedReason,
          coverUrl: pack.cover?.url ? resolveAgainst(BUNDLED_CATALOG_URL, pack.cover.url) : undefined,
          updated: pack.updated,
          pack,
        }));
        const words: Row[] = lists.map((pack) => ({
          key: `list:${pack.id}`,
          id: pack.id,
          kind: "list",
          title: pack.title,
          author: pack.author,
          lexile: pack.lexile,
          isbn: pack.isbn,
          series: pack.series,
          seriesNumber: pack.seriesNumber,
          category: pack.category,
          oldFashioned: pack.oldFashioned,
          oldFashionedReason: pack.oldFashionedReason,
          coverUrl: pack.cover?.url ? resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url) : undefined,
          updated: pack.updated,
          list: pack,
        }));
        setRows([...classics, ...words]);
        setRecords(shelfMarks.records);
        setCustomPacks(shelfMarks.custom);
        setError("");
        // The catalogs are fresh: notice which installed books have a newer word list.
        void autoUpdateWordLists();
      } catch (reason) {
        if (alive) setError(errorText(reason, "err.catalogLoad"));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [finished]);

  // A quiet update run changed some pack records: show the new state on the cards.
  useEffect(() => {
    let alive = true;
    void loadDiscoverRecords()
      .then((shelfMarks) => {
        if (!alive) return;
        setRecords(shelfMarks.records);
        setCustomPacks(shelfMarks.custom);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [updatesFinished]);

  // Back from the sign-in dialog: return to the book card that was tapped, so adding can go on.
  useEffect(() => {
    if (!canAdd || !signInFor.current) return;
    const id = signInFor.current;
    signInFor.current = null;
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-pack="${id}"], [data-word-list="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ block: "center" });
      card.querySelector<HTMLButtonElement>("[data-shelf-add]")?.focus();
    });
  }, [canAdd]);

  const inCategory = useMemo(() => rows.filter((item) => item.category === category), [rows, category]);
  const recent = useMemo(() => recentUpdates(inCategory, new Date()), [inCategory]);
  const authors = useMemo(
    () => [...new Set(inCategory.map((item) => item.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inCategory],
  );
  const seriesNames = useMemo(
    () => [...new Set(inCategory.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inCategory],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = inCategory.filter((item) => matchesBand(item.lexile, band));
    if (q) list = list.filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(q));
    if (author !== "all") list = list.filter((item) => item.author === author);
    if (series === "none") list = list.filter((item) => !item.series);
    else if (series !== "all" && series !== "grouped") list = list.filter((item) => item.series === series);
    if (sort === "listed" || sort === "recent" || series === "grouped") return list;
    const copy = [...list];
    if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
    else copy.sort((a, b) => compareLexile(a.lexile, b.lexile, sort) || a.title.localeCompare(b.title));
    return copy;
  }, [inCategory, query, band, author, series, sort]);

  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(shown.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: shown
        .filter((item) => item.series === name)
        .sort((a, b) => a.seriesNumber - b.seriesNumber || a.title.localeCompare(b.title)),
    }));
    const rest = shown.filter((item) => !item.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [shown, series]);

  const filterKey = `${category}\0${query}\0${sort}\0${band}\0${author}\0${series}`;
  const [windowState, setWindowState] = useState({ key: filterKey, limit: DISCOVER_PAGE });
  if (windowState.key !== filterKey) setWindowState({ key: filterKey, limit: DISCOVER_PAGE });
  const limit = windowState.key === filterKey ? windowState.limit : DISCOVER_PAGE;
  const visible = shown.slice(0, limit);
  const hasMore = visible.length < shown.length;
  const moreRef = useRef<HTMLDivElement | null>(null);
  const visibleGroups = useMemo(() => {
    let left = limit;
    const out: typeof groups = [];
    for (const group of groups) {
      if (left <= 0) break;
      const rowsInGroup = group.rows.slice(0, left);
      left -= rowsInGroup.length;
      if (rowsInGroup.length) out.push({ ...group, rows: rowsInGroup });
    }
    return out;
  }, [groups, limit]);

  useEffect(() => {
    const node = moreRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setWindowState((prev) =>
            prev.key === filterKey ? { key: filterKey, limit: prev.limit + DISCOVER_PAGE } : prev,
          );
        }
      },
      { rootMargin: "280px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filterKey, limit]);

  const [jumpId, setJumpId] = useState("");
  const [highlightId, setHighlightId] = useState("");

  function jumpTo(id: string) {
    const visibleNow = shown.some((row) => row.id === id);
    if (!visibleNow) {
      setQuery("");
      setAuthor("all");
      setSeries("all");
      setBand("all");
      setSort("listed");
    }
    setJumpId(id);
  }

  useEffect(() => {
    if (!jumpId || !ready) return;
    const index = shown.findIndex((row) => row.id === jumpId);
    if (index < 0) return;
    if (index >= limit) {
      setWindowState({ key: filterKey, limit: index + 1 });
      return;
    }
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-discover-card="${CSS.escape(jumpId)}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(jumpId);
      setJumpId("");
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpId, shown, limit, filterKey, ready]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(""), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const shelfIds = useMemo(() => new Set(shelf.map((book) => book.id)), [shelf]);
  const byPack = useMemo(() => new Map(records.map((record) => [record.packId, record])), [records]);

  async function addList(pack: WordListPack) {
    setListError((prev) => {
      const next = { ...prev };
      delete next[pack.id];
      return next;
    });
    setBusyId(pack.id);
    try {
      const bookId = await placeWordList(pack);
      setRecords(await listPackRecords());
      if (useVocab.getState().books.find((book) => book.id === bookId)?.needsEpub) onNeedsEpub(bookId);
      else onOpen(bookId);
    } catch (reason) {
      setListError((prev) => ({ ...prev, [pack.id]: errorText(reason, "err.bookAddFailed") }));
    } finally {
      setBusyId("");
    }
  }

  /** The Update button. A newer word list is applied only when the reader taps it. */
  function update(row: Row) {
    // A hand-edited list has no Update action. This also covers a signed-out tap: add() checks
    // the update before it checks the account, and that tap must not replace the list.
    const hold = useListUpdates.getState().holds[row.id];
    if (customPacks.has(row.id) || hold === "ownList") return;
    useListUpdates.getState().clearFailure(row.id);
    if (row.kind === "classic" && row.pack) {
      const pack = row.pack;
      useDownloads.getState().dismiss(pack.id);
      void start(BUNDLED_CATALOG_URL, pack);
    } else if (row.list) {
      const pack = row.list;
      setBusyId(pack.id);
      void retryWordListUpdate(pack)
        .catch(() => undefined)
        .finally(() => setBusyId(""));
    }
  }

  function add(row: Row, record: PackRecord | undefined, updateReady: boolean) {
    if (record && pendingId === record.bookId) {
      useShelfRemove.getState().undo();
      return;
    }
    if (updateReady) {
      update(row);
      return;
    }
    // Adding books needs an account. The sign-in dialog opens over this page, so the card stays.
    if (!canAdd) {
      signInFor.current = row.id;
      askToSignIn();
      return;
    }
    if (row.kind === "classic" && row.pack) {
      const pack = row.pack;
      useDownloads.getState().dismiss(pack.id);
      void start(BUNDLED_CATALOG_URL, pack).then(() => {
        if (!useDownloads.getState().items[pack.id]?.error) useShelfRemove.getState().announceAdded(row.title);
      });
    } else if (row.list) void addList(row.list);
  }

  function remove(row: Row, record: PackRecord | undefined, book: Book | undefined) {
    if (!record || !book) return;
    const savedWords = countFromBook(useVocab.getState().words, book);
    useShelfRemove.getState().ask(
      book,
      bookHasUserWork({
        source: book.source,
        needsEpub: book.needsEpub,
        classic: row.kind === "classic",
        savedWords: 0,
        progress: useProgress.getState().items[book.id] ?? null,
      }),
      savedWords,
    );
  }

  /**
   * The pack record of a row. A book that was imported from a .zip has a made-up pack id, so when no record
   * carries this row's id, the shelf card that IS this book (same ISBN, or title and author) stands in.
   */
  function recordFor(row: Row): PackRecord | undefined {
    const direct = byPack.get(row.id);
    if (direct) return direct;
    const known = new Set(records.map((record) => record.bookId));
    const hit = findOnShelf(
      shelf.map((book) => ({ ...book, stored: known.has(book.id) && book.source === "epub" && !book.needsEpub })),
      { title: row.title, author: row.author, isbn: row.isbn },
    );
    const mine = hit ? records.find((record) => record.bookId === hit.id) : undefined;
    return hit && mine ? { ...mine, packId: row.id } : undefined;
  }

  function renderCard(row: Row) {
    const record = recordFor(row);
    const held = Boolean(record && shelfIds.has(record.bookId) && pendingId !== record.bookId);
    const book = record ? shelf.find((item) => item.id === record.bookId) : undefined;
    const needs = Boolean(held && book?.needsEpub);
    const item = row.kind === "classic" ? items[row.id] : undefined;
    const busy = Boolean(item && !item.error) || busyId === row.id;
    const cardError = busy ? "" : item?.error || listError[row.id] || "";
    // A newer list stays until the reader taps Update. A hand-edited list stays "On shelf"
    // and the card says that list is kept. A changed book file, or a list that matches this
    // e-book under 80%, keeps Update and says why. A hold of "newList" also counts when the
    // revision string already matches: the stored list can be an older file of a different size.
    const direct = byPack.get(row.id);
    const catalogRev = row.kind === "classic" ? (row.pack?.rev ?? "") : row.list ? wordListRev(row.list) : "";
    const revDiffers = Boolean(held && direct && catalogRev && direct.rev !== catalogRev);
    const shaDiffers = Boolean(
      row.kind === "classic" && direct?.sha256 && row.pack?.epub.sha256 && direct.sha256 !== row.pack.epub.sha256,
    );
    const hold = updateHolds[row.id];
    const failure = updateFailures[row.id] ?? "";
    const staleList = Boolean(held && !revDiffers && hold === "newList");
    const why: ListHoldWhy | null =
      revDiffers && (customPacks.has(row.id) || hold === "ownList")
        ? "ownList"
        : revDiffers && (hold === "bookChanged" || shaDiffers)
          ? "bookChanged"
          : revDiffers && hold === "mismatch"
            ? "mismatch"
            : revDiffers || staleList
              ? "newList"
              : null;
    const updateReady = Boolean(why && holdOffersUpdate(why));
    const note =
      why === "ownList"
        ? t("lists.keptYours")
        : why === "newList" && !failure
          ? t("lists.newList")
          : "";
    const reason =
      why === "bookChanged"
        ? failure || t("lists.keptBook")
        : why === "mismatch" || (why === "newList" && failure)
          ? failure
          : "";
    const state: ShelfState = busy
      ? "busy"
      : cardError
        ? "error"
        : updateReady
          ? "update"
          : held
            ? "on"
            : "off";
    return (
      <li
        key={row.key}
        className={cn(
          bookCardShell,
          "scroll-mt-20",
          highlightId === row.id && "rounded-md outline outline-2 outline-offset-4 outline-accent",
        )}
        data-discover-card={row.id}
        {...(row.kind === "classic" ? { "data-pack": row.id } : { "data-word-list": row.id })}
        data-list-hold={why ?? undefined}
      >
        <div className="relative">
          {held && record ? (
            <button
              type="button"
              onClick={() => onOpen(record.bookId)}
              className="block w-full rounded-md text-left"
              aria-label={t("pack.openAria", { title: row.title })}
            >
              <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible />
            </button>
          ) : (
            <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible />
          )}
          <div className="absolute right-2 bottom-2 z-[2]">
            <AddToShelfButton
              state={state}
              fraction={busy && item ? item.fraction : undefined}
              title={row.title}
              signedOut={!canAdd}
              onAdd={() => add(row, record, updateReady)}
              onOpen={() => record && onOpen(record.bookId)}
              onRemove={() => remove(row, record, book)}
            />
          </div>
          {busy && item?.fraction != null ? (
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-1 bg-accent-soft"
              aria-hidden
            >
              <span className="block h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, item.fraction)) * 100)}%` }} />
            </span>
          ) : null}
          <div className="pointer-events-none absolute top-2 left-2 z-[1] flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
            {needs ? (
              <CoverBadge tone="needs" data-needs-epub="">
                {t("shelf.needsEpub")}
              </CoverBadge>
            ) : (
              <CoverBadge tone={row.kind === "classic" ? "publicDomain" : "list"} data-kind={row.kind}>
                {row.kind === "classic" ? t("shelf.classic") : t("discover.kindList")}
              </CoverBadge>
            )}
            {row.oldFashioned ? <OldFashionedBadge reason={row.oldFashionedReason} /> : null}
          </div>
        </div>
        <div className="grid flex-1 content-start gap-1">
          <h3 className={cardTitleClass} lang="en">
            {held && record ? (
              <button
                type="button"
                onClick={() => onOpen(record.bookId)}
                className="w-full text-left font-[inherit] text-inherit"
              >
                {row.title}
              </button>
            ) : (
              row.title
            )}
          </h3>
          <p className={cardAuthorClass} lang="en">
            {row.author}
          </p>
          <div className="max-sm:hidden">
            <BookMetaLines
              lexile={row.lexile}
              isbn={row.isbn}
              series={row.series}
              seriesNumber={row.seriesNumber}
              aside={row.oldFashioned ? t("shelf.oldFashionedNote") : undefined}
            />
          </div>
        </div>
        <div className="mt-auto min-h-4 pt-1">
          <ShelfCardStatus
            state={state}
            fraction={busy && item ? item.fraction : undefined}
            error={cardError || reason}
            note={note}
            updated={row.updated}
          />
        </div>
      </li>
    );
  }

  return (
    <div
      className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:gap-6 sm:px-6"
      data-discover
      data-discover-category={category}
      data-discover-matches={ready ? shown.length : undefined}
    >
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("discover.title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("discover.hint")}</p>
        </div>
        <div role="tablist" aria-label={t("discover.cat.list")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" data-discover-categories>
          {CONTENT_CATEGORIES.map((id) => {
            const on = category === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`discover-cat-${id}`}
                aria-selected={on}
                aria-controls="discover-results"
                data-discover-category-tab={id}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                  on ? "bg-accent text-accent-ink" : "border border-line bg-card text-ink hover:bg-accent-soft",
                )}
                onClick={() => {
                  setCategory(id);
                  setAuthor("all");
                  setSeries("all");
                }}
              >
                {t(`discover.cat.${id}`)}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id="discover-results"
        role="tabpanel"
        aria-labelledby={`discover-cat-${category}`}
        className="grid gap-5 sm:gap-6"
      >
        {ready && recent.length > 0 ? (
          <section
            className="grid min-w-0 gap-2"
            aria-label={t("discover.recentAria", { n: RECENT_UPDATE_DAYS })}
            data-discover-recent={recent.length}
          >
            <h2 className="font-display text-lg font-semibold">{t("discover.recent")}</h2>
            <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {recent.map((row) => (
                <li key={row.id} className="w-16 shrink-0 sm:w-20">
                  <button
                    type="button"
                    className="grid w-full gap-1 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    data-recent-book={row.id}
                    aria-label={t("discover.recentShow", { title: row.title })}
                    onClick={() => jumpTo(row.id)}
                  >
                    <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible />
                    <span className="overflow-hidden text-xs leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" lang="en">
                      {row.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {!ready || inCategory.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block min-w-0 flex-1 sm:basis-full">
              <span className="sr-only">{t("discover.search")}</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                className={cn(field, "pl-9")}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("discover.search")}
                data-discover-search
              />
            </label>
            <FilterMenu
              active={sort !== "listed" || band !== "all" || author !== "all" || series !== "all"}
              render={() => (
                <>
                  <DifficultyControls sort={sort} sorts={["listed", "easy", "hard", "title"]} onSort={setSort} band={band} onBand={setBand} />
                  <ListFilters authors={authors} seriesNames={seriesNames} author={author} series={series} onAuthor={setAuthor} onSeries={setSeries} />
                </>
              )}
            />
          </div>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
            {error}
          </p>
        ) : null}
        {!ready ? (
          <div className="grid gap-3" aria-busy="true">
            <p className="text-sm text-muted" role="status">
              {t("discover.loading")}
            </p>
            <ul className={bookCardGrid} data-discover-loading>
              {Array.from({ length: 8 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </ul>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-muted" data-discover-empty={category}>
            {inCategory.length === 0 && category === "speech"
              ? t("discover.empty.speech")
              : query.trim()
                ? t("shelf.noMatch", { query: query.trim() })
                : t("shelf.series.empty")}
          </p>
        ) : series === "grouped" ? (
          <div className="grid gap-8">
            {visibleGroups.map((group) => (
              <div key={group.key} className="grid gap-4" data-series-group={group.key}>
                <h2 className="font-display text-lg font-semibold" lang={group.title ? "en" : undefined}>
                  {group.title || t("shelf.series.none")}
                </h2>
                <ul className={bookCardGrid}>{group.rows.map(renderCard)}</ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className={bookCardGrid}>{visible.map(renderCard)}</ul>
        )}
        {ready && hasMore ? (
          <div ref={moreRef} data-discover-more className="grid gap-3" aria-busy="true">
            <p className="text-center text-sm text-muted">{t("discover.loadingMore")}</p>
            <ul className={bookCardGrid}>
              {Array.from({ length: 4 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </ul>
          </div>
        ) : ready && shown.length > 0 ? (
          <div data-discover-end hidden />
        ) : null}
      </div>
    </div>
  );
}
