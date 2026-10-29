import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { BookTag, BookTags, OldFashionedTag } from "@/components/cover-marks";
import { BookCover } from "@/components/book-cover";
import { AddToShelfButton, ShelfCardStatus, type ShelfState } from "@/components/shelf-actions";
import { DifficultyControls, matchesBand, type BandChoice, type SortChoice } from "@/components/lexile-ui";
import {
  bookCardShell,
  FilterMenu,
  ListFilters,
  type SeriesChoice,
} from "@/components/list-filters";
import { btn, cn, field, subTabs } from "@/components/ui";
import { listPackRecords, loadBookExtras, type PackRecord } from "@/lib/book-db";
import { coverAddress } from "@/lib/covers";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst } from "@/lib/packs";
import { askToSignIn, useCanAddBooks } from "@/lib/can-add";
import { useDownloads } from "@/lib/downloads";
import { errorText, useT } from "@/lib/i18n";
import { compareLexile, lexileMeasure } from "@/lib/lexile";
import { placeWordList } from "@/lib/place-word-list";
import type { CatalogName } from "@/lib/catalog-id";
import { discoverShelfBook } from "@/lib/discover-shelf";
import { useProgress } from "@/lib/progress-store";
import { bookHasUserWork } from "@/lib/shelf-work";
import { useShelfRemove } from "@/lib/shelf-remove";
import type { Book } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { navigate } from "@/lib/router";
import { useDiscoverIntent } from "@/lib/tutorial";
import { countFromBook } from "@/lib/wordbook";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL, type WordListPack } from "@/lib/word-list-catalog";
import { CONTENT_CATEGORIES, type ContentCategory } from "@/lib/content-category";
import { placesLeft, quotaFor, useGlossaryQuota } from "@/lib/glossary-quota";
import { WeeklyQuota } from "@/components/weekly-quota";
import { newestUpdates } from "@/lib/discover-recent";
import { browseRails, compareSeriesPlace, RAIL_MIN, RAIL_SIZE, railsFor, type DiscoverRailSpec } from "@/lib/discover-rails";
import { loadDiscoverRailFile } from "@/lib/discover-rail-config";
import { BookDetail, BookRail, FeaturedBook, rowCatalogRef, type CardModel, type DiscoverRow } from "@/components/discover-browse";
import { holdOffersUpdate, type ListHoldWhy } from "@/lib/word-list-plan";
import {
  autoUpdateWordLists,
  announceListUpdate,
  updateInstalledBook,
  useListUpdates,
  wordListRev,
} from "@/lib/word-list-update";
import { BookMaintainers } from "@/components/book-maintainers";

/** How many cards to mount at once. The rest of the catalog stays in memory for search and filters. */
const DISCOVER_PAGE = 12;

/**
 * Store-style grid: a cover, the title, one quiet line. On wide screens the columns and the gap
 * match the new-books row (10 or 12 covers there are 5 or 6 here), so both line up.
 */
const discoverGrid =
  "grid grid-cols-3 items-stretch gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-5 xl:grid-cols-6";
const discoverTitle =
  "overflow-hidden font-display text-[0.8rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[0.92rem]";

/** Pack records plus the shelf book ids whose list the reader added or edited by hand. */
type DiscoverRecord = PackRecord & { catalog?: CatalogName; listSource?: string };

async function loadDiscoverRecords(): Promise<{ records: DiscoverRecord[]; custom: Set<string> }> {
  const records = await listPackRecords();
  const books = useVocab.getState().books;
  const sources = await Promise.all(
    books.map((book) =>
      loadBookExtras(book.id)
        .then((extras) => extras)
        .catch(() => undefined),
    ),
  );
  const custom = new Set<string>();
  books.forEach((book, index) => {
    if (sources[index]?.source === "custom") custom.add(book.id);
  });
  const extrasByBook = new Map(books.map((book, index) => [book.id, sources[index]]));
  return { records: records.map((record) => ({ ...record, catalog: extrasByBook.get(record.bookId)?.catalog, listSource: extrasByBook.get(record.bookId)?.source })), custom };
}

function CardSkeleton() {
  return (
    <li className={bookCardShell} aria-hidden>
      <span className="block aspect-cover w-full animate-pulse rounded-md bg-line" />
      <span className="mt-1 h-4 w-3/4 animate-pulse rounded bg-line" />
      <span className="h-3 w-1/2 animate-pulse rounded bg-line" />
      <span className="mt-auto h-3 w-2/3 animate-pulse rounded bg-line" />
    </li>
  );
}

type Row = DiscoverRow;

/**
 * Every book we have, from the books host. The two catalog files are one fetch each. Covers load as
 * they come near the screen. A word list or an e-book is fetched only when the plus on a cover is tapped.
 */
export function DiscoverScreen({
  shelf,
  onOpen,
  onNeedsEpub,
  routeCategory,
  routeBookId,
}: {
  shelf: Book[];
  onOpen: (bookId: string) => void;
  onNeedsEpub: (bookId: string) => void;
  /** The tab in the address (/discover/novels/, /discover/speeches/), when it names one. */
  routeCategory?: ContentCategory;
  /** A catalog book id from /book/<id>/: its detail opens once the catalogs are read. */
  routeBookId?: string;
}) {
  const { t, tn } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  /** null: no saved list, so the biggest series stay automatic. */
  const [railSpecs, setRailSpecs] = useState<DiscoverRailSpec[] | null>(null);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<DiscoverRecord[]>([]);
  const [customPacks, setCustomPacks] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [category, setCategory] = useState<ContentCategory>(routeCategory ?? "novel");
  // Back and forward between /discover/novels/ and /discover/speeches/ change the tab too.
  useEffect(() => {
    if (routeCategory) setCategory(routeCategory);
  }, [routeCategory]);
  /** A row opened with "See all": "new", "classic", "series:<name>" or "curated:<name>". "" is the browse page. */
  const [collection, setCollection] = useState("");
  /** The row key of the book in the detail sheet. */
  const [detailId, setDetailId] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const finished = useDownloads((state) => state.finished);
  const pendingId = useShelfRemove((state) => state.pending?.bookId ?? "");
  const items = useDownloads((state) => state.items);
  const start = useDownloads((state) => state.start);
  const canAdd = useCanAddBooks();
  const quota = useGlossaryQuota((state) => state.quota);
  const updateFailures = useListUpdates((state) => state.failures);
  const updateHolds = useListUpdates((state) => state.holds);
  const updatesFinished = useListUpdates((state) => state.finished);
  /** the card tapped while signed out: scroll back to it after sign-in */
  const signInFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [catalog, lists, shelfMarks, railFile] = await Promise.all([
          loadCatalog(BUNDLED_CATALOG_URL),
          // A word-list catalog that cannot be loaded must not hide the classics.
          // Those lists are not kept in the service worker.
          loadWordListCatalog().catch(() => [] as WordListPack[]),
          loadDiscoverRecords(),
          loadDiscoverRailFile().catch(() => null),
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
          // The version in the address (the cover's sha256) makes a replaced cover a new address, so the
          // books host's 4-hour image cache never shows the old picture. The shelf already fetches this way.
          coverUrl: pack.cover?.url ? coverAddress(resolveAgainst(BUNDLED_CATALOG_URL, pack.cover.url), pack.cover.sha256) : undefined,
          updated: pack.updated,
          added: pack.added,
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
          coverUrl: pack.cover?.url ? coverAddress(resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url), pack.cover.sha256) : undefined,
          updated: pack.updated,
          added: pack.added,
          list: pack,
        }));
        setRows([...classics, ...words]);
        setRailSpecs(railFile);
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

  // /book/<id>/: open that book once the catalogs are in (the public book first, as the cards are).
  const openedFor = useRef("");
  useEffect(() => {
    if (!routeBookId) {
      openedFor.current = "";
      return;
    }
    if (openedFor.current === routeBookId || rows.length === 0) return;
    const row = rows.find((item) => item.key === `classic:${routeBookId}`) ?? rows.find((item) => item.key === `list:${routeBookId}`);
    if (!row) return;
    openedFor.current = routeBookId;
    setCategory(row.category);
    setDetailId(row.key);
  }, [routeBookId, rows]);

  const inCategory = useMemo(() => rows.filter((item) => item.category === category), [rows, category]);
  const newest = useMemo(() => newestUpdates(inCategory, new Date(), RAIL_SIZE), [inCategory]);
  // The admin saves rows per tab. No saved file at all keeps the automatic series rows.
  const rails = useMemo(
    () => browseRails(inCategory, railSpecs === null ? null : railsFor(railSpecs, category)),
    [inCategory, railSpecs, category],
  );
  const inCollection = useMemo(() => {
    if (!collection) return inCategory;
    if (collection === "new") return newestUpdates(inCategory, new Date(), inCategory.length);
    const rail = rails.find((item) => item.id === collection);
    if (rail) return rail.all;
    // A series opened from outside (the tutorial) when it has no row of its own on this tab.
    if (collection.startsWith("series:")) {
      const name = collection.slice("series:".length);
      return inCategory.filter((row) => row.series === name).sort(compareSeriesPlace);
    }
    return [];
  }, [inCategory, collection, rails]);
  // The tutorial's "See Magic Tree House": open that series as its "See all" list.
  const pendingSeries = useDiscoverIntent((state) => state.series);
  useEffect(() => {
    if (!pendingSeries || rows.length === 0) return;
    const name = useDiscoverIntent.getState().take();
    if (!name) return;
    setCategory("novel");
    setCollection(`series:${name}`);
    window.scrollTo({ top: 0 });
  }, [pendingSeries, rows.length]);
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
    let list = inCollection.filter((item) => matchesBand(item.lexile, band));
    if (q) list = list.filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(q));
    if (author !== "all") list = list.filter((item) => item.author === author);
    if (series === "none") list = list.filter((item) => !item.series);
    else if (series !== "all" && series !== "grouped") list = list.filter((item) => item.series === series);
    if (sort === "listed" || sort === "recent" || series === "grouped") return list;
    const copy = [...list];
    if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
    else copy.sort((a, b) => compareLexile(a.lexile, b.lexile, sort) || a.title.localeCompare(b.title));
    return copy;
  }, [inCollection, query, band, author, series, sort]);

  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(shown.map((item) => item.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: shown
        .filter((item) => item.series === name)
        .sort(compareSeriesPlace),
    }));
    const rest = shown.filter((item) => !item.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [shown, series]);

  const filterKey = `${category}\0${collection}\0${query}\0${sort}\0${band}\0${author}\0${series}`;
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


  async function addList(pack: WordListPack) {
    setListError((prev) => {
      const next = { ...prev };
      delete next[pack.id];
      return next;
    });
    setBusyId(pack.id);
    try {
      const bookId = await placeWordList(pack);
      setRecords((await loadDiscoverRecords()).records);
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
    const model = cardModel(row);
    if (!model.book || !model.updateReady || model.needs || customPacks.has(model.book.id)) return;
    useListUpdates.getState().clearFailure(row.id);
    setListError((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    setBusyId(row.id);
    void updateInstalledBook(model.book.id)
      .then(() => announceListUpdate([row.title], 0))
      .catch((reason) => {
        setListError((prev) => ({ ...prev, [row.id]: errorText(reason, "err.downloadFailed") }));
        announceListUpdate([], 1);
      })
      .finally(() => setBusyId(""));
  }

  function add(row: Row, book: Book | undefined, updateReady: boolean) {
    if (cardModel(row).ambiguous) return;
    if (book && pendingId === book.id) {
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
      void start(BUNDLED_CATALOG_URL, pack).then(async () => {
        if (useDownloads.getState().items[pack.id]?.error) return;
        // Say so when only one or two places of this kind are left this week.
        await useGlossaryQuota.getState().refresh();
        const count = quotaFor(useGlossaryQuota.getState().quota, row.category);
        const left = count ? placesLeft(count) : Infinity;
        const extra =
          left <= 2 ? tn(row.category === "speech" ? "quota.fewSpeeches" : "quota.fewNovels", left) : "";
        useShelfRemove.getState().announceAdded(row.title, extra);
      });
    } else if (row.list) void addList(row.list);
  }

  function remove(row: Row, book: Book | undefined) {
    if (!book) return;
    const savedWords = countFromBook(useVocab.getState().words, book);
    useShelfRemove.getState().ask(
      book,
      bookHasUserWork({
        source: book.source,
        needsEpub: book.needsEpub,
        classic: row.kind === "classic",
        savedWords,
        progress: useProgress.getState().items[book.id] ?? null,
      }),
      savedWords,
    );
  }

  function cardModel(row: Row) {
    const { record, book, ambiguous } = discoverShelfBook(shelf, records, {
      ...row, catalog: row.kind === "classic" ? "public-books" : "word-lists",
      catalogCollision: rows.some((other) => other.id === row.id && other.kind !== row.kind),
    });
    const held = Boolean(book && pendingId !== book.id);
    const needs = Boolean(held && book?.needsEpub);
    const item = row.kind === "classic" ? items[row.id] : undefined;
    const busy = Boolean(item && !item.error) || busyId === row.id;
    const cardError = ambiguous ? t("discover.ambiguous") : busy ? "" : item?.error || listError[row.id] || "";
    // A newer list stays until the reader taps Update. A hand-edited list stays "On shelf"
    // and the card says that list is kept. A changed book file, or a list that matches this
    // e-book under 80%, keeps Update and says why. A hold of "newList" also counts when the
    // revision string already matches: the stored list can be an older file of a different size.
    const direct = record && (record.listSource && record.listSource !== "custom" ? record.listSource : record.packId) === row.id ? record : undefined;
    const catalogRev = row.kind === "classic" ? (row.pack?.rev ?? "") : row.list ? wordListRev(row.list) : "";
    const revDiffers = Boolean(held && !needs && direct && catalogRev && direct.rev !== catalogRev);
    const shaDiffers = Boolean(
      row.kind === "classic" && direct?.sha256 && row.pack?.epub.sha256 && direct.sha256 !== row.pack.epub.sha256,
    );
    const hold = direct ? updateHolds[`book:${book!.id}`] : undefined;
    const failure = direct ? updateFailures[`book:${book!.id}`] ?? "" : "";
    const why: ListHoldWhy | null = !held || needs
      ? null
      : (book && customPacks.has(book.id)) || hold === "ownList"
        ? "ownList"
        : hold === "bookChanged" || shaDiffers
          ? "bookChanged"
          : hold === "mismatch"
            ? "mismatch"
            : revDiffers || hold === "newList"
              ? "newList"
              : null;
    const updateReady = Boolean(why && holdOffersUpdate(why));
    // A book not on the shelf yet, when this kind has no place left: say so before the tap.
    // The plus still works, because a book opened before on another device is free.
    const count = !held && !busy && canAdd ? quotaFor(quota, row.category) : null;
    // Short on the card; the line above the grid names the day.
    const quotaNote = count && placesLeft(count) === 0 ? t("quota.cardFull") : "";
    const note =
      why === "ownList"
        ? t("lists.keptYours")
        : why === "newList" && !failure
          ? t("lists.newList")
          : quotaNote;
    const reason =
      why === "bookChanged"
        ? failure || t("lists.keptBook")
        : why === "mismatch" || (why === "newList" && failure)
          ? failure
          : "";
    const lexile = lexileMeasure(row.lexile);
    const state: ShelfState = busy
      ? "busy"
      : cardError
        ? "error"
        : updateReady
          ? "update"
          : held
            ? "on"
            : "off";
    return { record, held, book, ambiguous, needs, item, busy, cardError, why, updateReady, note, reason, lexile, state };
  }

  function detailModel(row: Row): CardModel {
    const m = cardModel(row);
    return {
      state: m.state,
      blocked: m.ambiguous,
      fraction: m.busy && m.item ? m.item.fraction : undefined,
      held: m.held,
      needs: m.needs,
      error: m.cardError || m.reason,
      note: m.note,
      lexile: m.lexile,
    };
  }

  function detailAction(row: Row) {
    const m = cardModel(row);
    if (m.ambiguous || m.state === "busy") return;
    if (m.state === "on") {
      if (m.book) {
        setDetailId("");
        onOpen(m.book.id);
      }
      return;
    }
    if (!canAdd && m.state === "off") setDetailId("");
    add(row, m.book, m.updateReady);
  }

  function renderCard(row: Row) {
    const { book, ambiguous, needs, item, busy, cardError, why, updateReady, note, reason, lexile, state } = cardModel(row);
    return (
      <li
        key={row.key}
        className={cn(
          bookCardShell,
          "scroll-mt-20",
        )}
        data-discover-card={row.id}
        {...(row.kind === "classic" ? { "data-pack": row.id } : { "data-word-list": row.id })}
        data-list-hold={why ?? undefined}
        data-isbn={row.isbn || undefined}
        data-series={row.series || undefined}
        data-series-number={row.series && row.seriesNumber ? row.seriesNumber : undefined}
        data-lexile-measure={lexile || "unrated"}
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setDetailId(row.key)}
            className="block w-full rounded-md text-left"
            aria-label={t("browse.openAria", { title: row.title })}
            data-card-detail
          >
            <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible look={row.category === "speech" ? "talk" : "book"} />
          </button>
          {/* Who maintains the word list, on the cover's top-left: the same place on every card,
              whatever the title's length or the tags below. The add button keeps the bottom-right. */}
          <BookMaintainers bookRef={rowCatalogRef(row)} />
          <div className="absolute right-1.5 bottom-1.5 z-[2]">
            <fieldset disabled={ambiguous} className="contents" data-identity-ambiguous={ambiguous ? "" : undefined}>
              <AddToShelfButton
              state={state}
              fraction={busy && item ? item.fraction : undefined}
              title={row.title}
              signedOut={!canAdd}
              onAdd={() => add(row, book, updateReady)}
              onOpen={() => book && onOpen(book.id)}
              onRemove={() => remove(row, book)}
            />
            </fieldset>
          </div>
          {busy && item?.fraction != null ? (
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-1 bg-accent-soft"
              aria-hidden
            >
              <span className="block h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, item.fraction)) * 100)}%` }} />
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-0.5">
          <h3 className={discoverTitle} lang="en" title={row.title}>
            <button
              type="button"
              onClick={() => setDetailId(row.key)}
              className="w-full text-left font-[inherit] text-inherit"
            >
              {row.title}
            </button>
          </h3>
          <p className="flex min-w-0 items-baseline gap-2 text-xs leading-5 text-muted">
            <span className="min-w-0 flex-1 truncate" lang="en">
              {row.author}
            </span>
            {lexile ? (
              <span
                className="shrink-0 tabular-nums max-sm:hidden"
                data-lexile={lexile}
                aria-label={t("lexile.aria", { measure: lexile })}
              >
                {lexile}
              </span>
            ) : null}
          </p>
          {/* What the book is, under the author: tags on the cover covered the art. */}
          <BookTags>
            {needs ? (
              <BookTag tone="warn" data-needs-epub="">
                {t("shelf.needsEpub")}
              </BookTag>
            ) : (
              <BookTag data-kind={row.kind}>
                {row.kind === "classic" ? t("shelf.classic") : t("discover.kindList")}
              </BookTag>
            )}
            {row.oldFashioned ? <OldFashionedTag reason={row.oldFashionedReason} /> : null}
          </BookTags>
        </div>
        {busy || cardError || reason || note ? (
          <div className="mt-auto pt-1">
            <ShelfCardStatus
              state={state}
              fraction={busy && item ? item.fraction : undefined}
              error={cardError || reason}
              note={note}
            />
          </div>
        ) : null}
      </li>
    );
  }

  const browsing =
    ready &&
    !error &&
    !collection &&
    !query.trim() &&
    band === "all" &&
    author === "all" &&
    series === "all" &&
    sort === "listed" &&
    inCategory.length > 0;
  const detailRow = detailId ? (rows.find((row) => row.key === detailId) ?? null) : null;
  function railTitle(id: string): string {
    if (id === "new") return t("discover.recent");
    if (id === "classic") return t("browse.rail.classic");
    if (id.startsWith("series:")) return id.slice("series:".length);
    if (id.startsWith("curated:")) return id.slice("curated:".length);
    return t("browse.all");
  }
  function openCollection(id: string) {
    setCollection(id);
    window.scrollTo({ top: 0 });
  }

  return (
    <div
      className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:gap-6 sm:px-6"
      data-discover
      data-discover-category={category}
      data-discover-matches={ready ? shown.length : undefined}
    >
      <div className="grid gap-3">
        <div
          role="tablist"
          aria-label={t("discover.cat.list")}
          className={subTabs.row}
          data-discover-categories
        >
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
                className={cn(subTabs.tab, on ? subTabs.on : subTabs.off)}
                onClick={() => {
                  setCategory(id);
                  setAuthor("all");
                  setSeries("all");
                  // One address per tab, so a tab can be linked and found by a search engine.
                  navigate({ kind: "discover", category: id }, { replace: true });
                }}
              >
                {t(`discover.cat.${id}`)}
              </button>
            );
          })}
        </div>
        <WeeklyQuota />
      </div>
      {!ready || inCategory.length > 0 ? (
        <div className="flex items-center gap-2">
          <label className="relative block min-w-0 flex-1">
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
      <div
        id="discover-results"
        role="tabpanel"
        aria-labelledby={`discover-cat-${category}`}
        className="grid gap-5 sm:gap-6"
      >
        {browsing ? (
          <>
            {newest[0] ? <FeaturedBook row={newest[0]} onOpen={(row) => setDetailId(row.key)} /> : null}
            {newest.length >= RAIL_MIN ? (
              <BookRail
                rail="new"
                title={railTitle("new")}
                rows={newest}
                onOpen={(row) => setDetailId(row.key)}
                onSeeAll={() => openCollection("new")}
              />
            ) : null}
            {rails.map((rail) => (
              <BookRail
                key={rail.id}
                rail={rail.id}
                title={railTitle(rail.id)}
                rows={rail.rows}
                onOpen={(row) => setDetailId(row.key)}
                onSeeAll={rail.all.length > rail.rows.length ? () => openCollection(rail.id) : undefined}
              />
            ))}
            <h2 className="pt-2 font-bold tracking-[-0.02em] text-[1.15rem] leading-tight sm:text-[1.3rem]" data-discover-all>
              {t("browse.all")}
            </h2>
          </>
        ) : ready ? (
          <div className="flex min-w-0 items-center gap-2" data-discover-results-head>
            {collection ? (
              <button
                type="button"
                className={cn(btn.icon, "-ml-2 shrink-0")}
                onClick={() => setCollection("")}
                aria-label={t("browse.back")}
                data-collection-back
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
            ) : null}
            <h2
              className="min-w-0 truncate font-bold tracking-[-0.02em] text-[1.15rem] sm:text-[1.3rem]"
              lang={collection.startsWith("series:") || collection.startsWith("curated:") ? "en" : undefined}
            >
              {collection ? railTitle(collection) : t("browse.results")}
            </h2>
            <span className="shrink-0 text-sm text-muted tabular-nums">{tn("count.book", shown.length)}</span>
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
            <ul className={discoverGrid} data-discover-loading>
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
                <h2 className="font-bold tracking-[-0.02em] text-lg" lang={group.title ? "en" : undefined}>
                  {group.title || t("shelf.series.none")}
                </h2>
                <ul className={discoverGrid}>{group.rows.map(renderCard)}</ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className={discoverGrid}>{visible.map(renderCard)}</ul>
        )}
        {ready && hasMore ? (
          <div ref={moreRef} data-discover-more className="grid gap-3" aria-busy="true">
            <p className="text-center text-sm text-muted">{t("discover.loadingMore")}</p>
            <ul className={discoverGrid}>
              {Array.from({ length: 4 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </ul>
          </div>
        ) : ready && shown.length > 0 ? (
          <div data-discover-end hidden />
        ) : null}
      </div>
      <BookDetail
        row={detailRow}
        model={detailRow ? detailModel(detailRow) : null}
        canAdd={canAdd}
        onClose={() => {
          setDetailId("");
          // Closing a book that was opened from its own address leaves that address.
          if (routeBookId) navigate({ kind: "discover", category }, { replace: true });
        }}
        onAction={() => detailRow && detailAction(detailRow)}
        onOpen={() => {
          if (!detailRow) return;
          const m = cardModel(detailRow);
          if (!m.held || !m.book) return;
          setDetailId("");
          onOpen(m.book.id);
        }}
        onRemove={() => {
          if (!detailRow) return;
          const m = cardModel(detailRow);
          setDetailId("");
          remove(detailRow, m.book);
        }}
      />
    </div>
  );
}
