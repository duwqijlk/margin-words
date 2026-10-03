import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CoverBadge, OldFashionedBadge } from "@/components/cover-marks";
import { BookCover } from "@/components/book-cover";
import { AddToShelfButton, type ShelfState } from "@/components/shelf-actions";
import { BookMetaLines, DifficultyControls, matchesBand, type BandChoice, type SortChoice } from "@/components/lexile-ui";
import {
  bookCardGrid,
  bookCardShell,
  cardAuthorClass,
  cardTitleClass,
  ListFilters,
  type SeriesChoice,
} from "@/components/list-filters";
import { cn, field } from "@/components/ui";
import { listPackRecords, type PackRecord } from "@/lib/book-db";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst, type CatalogPack } from "@/lib/packs";
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

/** How many cards to mount at once. The rest of the catalog stays in memory for search and filters. */
const DISCOVER_PAGE = 12;

function CardSkeleton() {
  return (
    <li className={bookCardShell} aria-hidden>
      <span className="block aspect-[2/3] w-full animate-pulse rounded-md bg-line" />
      <span className="mt-1 h-4 w-3/4 animate-pulse rounded bg-line" />
      <span className="h-3 w-1/2 animate-pulse rounded bg-line" />
      <span className="mt-auto h-11 animate-pulse rounded-lg bg-line" />
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
  oldFashioned: boolean;
  oldFashionedReason: string;
  coverUrl?: string;
  pack?: CatalogPack;
  list?: WordListPack;
};

/**
 * Every book we have, from the books host. The two catalog files are one fetch each. Covers load as
 * they come near the screen. A word list or an e-book is fetched only when "Add to shelf" is tapped.
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [error, setError] = useState("");
  const [listError, setListError] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const finished = useDownloads((state) => state.finished);
  const pendingId = useShelfRemove((state) => state.pending?.bookId ?? "");
  const items = useDownloads((state) => state.items);
  const start = useDownloads((state) => state.start);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [catalog, lists, have] = await Promise.all([
          loadCatalog(BUNDLED_CATALOG_URL),
          loadWordListCatalog(),
          listPackRecords(),
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
          oldFashioned: pack.oldFashioned,
          oldFashionedReason: pack.oldFashionedReason,
          coverUrl: pack.cover?.url ? resolveAgainst(BUNDLED_CATALOG_URL, pack.cover.url) : undefined,
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
          oldFashioned: pack.oldFashioned,
          oldFashionedReason: pack.oldFashionedReason,
          coverUrl: pack.cover?.url ? resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url) : undefined,
          list: pack,
        }));
        setRows([...classics, ...words]);
        setRecords(have);
        setError("");
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

  const authors = useMemo(
    () => [...new Set(rows.map((item) => item.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const seriesNames = useMemo(
    () => [...new Set(rows.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter((item) => matchesBand(item.lexile, band));
    if (q) list = list.filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(q));
    if (author !== "all") list = list.filter((item) => item.author === author);
    if (series === "none") list = list.filter((item) => !item.series);
    else if (series !== "all" && series !== "grouped") list = list.filter((item) => item.series === series);
    if (sort === "listed" || sort === "recent" || series === "grouped") return list;
    const copy = [...list];
    if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
    else copy.sort((a, b) => compareLexile(a.lexile, b.lexile, sort) || a.title.localeCompare(b.title));
    return copy;
  }, [rows, query, band, author, series, sort]);

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

  const filterKey = `${query}\0${sort}\0${band}\0${author}\0${series}`;
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

  function add(row: Row, record: PackRecord | undefined) {
    if (record && pendingId === record.bookId) {
      useShelfRemove.getState().undo();
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
    const state: ShelfState = busy ? "busy" : cardError ? "error" : held ? "on" : "off";
    return (
      <li
        key={row.key}
        className={bookCardShell}
        {...(row.kind === "classic" ? { "data-pack": row.id } : { "data-word-list": row.id })}
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
          <BookMetaLines
            lexile={row.lexile}
            isbn={row.isbn}
            series={row.series}
            seriesNumber={row.seriesNumber}
            aside={row.oldFashioned ? t("shelf.oldFashionedNote") : undefined}
          />
        </div>
        <div className="mt-auto pt-1">
          <AddToShelfButton
            state={state}
            fraction={busy && item ? item.fraction : undefined}
            error={cardError}
            title={row.title}
            onAdd={() => add(row, record)}
            onOpen={() => record && onOpen(record.bookId)}
            onRemove={() => remove(row, record, book)}
          />
        </div>
      </li>
    );
  }

  return (
    <div
      className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:gap-6 sm:px-6"
      data-discover
      data-discover-matches={ready ? shown.length : undefined}
    >
      <div className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("discover.title")}</h1>
        <p className="max-w-xl text-sm text-muted">{t("discover.hint")}</p>
      </div>
      <div className="grid gap-3">
        <label className="relative block">
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
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&_select]:w-full sm:[&_select]:w-auto [&>div]:contents">
          <DifficultyControls sort={sort} sorts={["listed", "easy", "hard", "title"]} onSort={setSort} band={band} onBand={setBand} />
          <ListFilters authors={authors} seriesNames={seriesNames} author={author} series={series} onAuthor={setAuthor} onSeries={setSeries} />
        </div>
      </div>
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
        <p className="py-10 text-center text-muted">{query.trim() ? t("shelf.noMatch", { query: query.trim() }) : t("shelf.series.empty")}</p>
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
  );
}
