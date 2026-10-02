import { BookPlus, Check, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookCover } from "@/components/shelf";
import { BookMetaLines, DifficultyControls, matchesBand, type BandChoice, type SortChoice } from "@/components/lexile-ui";
import { bookCardGrid, bookCardShell, ListFilters, type SeriesChoice } from "@/components/list-filters";
import { btn, cn, field, ProgressBar } from "@/components/ui";
import { listPackRecords, type PackRecord } from "@/lib/book-db";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst, type CatalogPack } from "@/lib/packs";
import { useDownloads } from "@/lib/downloads";
import { errorText, useT } from "@/lib/i18n";
import { compareLexile } from "@/lib/lexile";
import { placeWordList } from "@/lib/place-word-list";
import type { Book } from "@/lib/vocab-model";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL, type WordListPack } from "@/lib/word-list-catalog";

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
  coverUrl?: string;
  pack?: CatalogPack;
  list?: WordListPack;
};

/**
 * Every book we have, from the books host. Nothing is downloaded until Add to shelf.
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
  const [records, setRecords] = useState<PackRecord[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const finished = useDownloads((state) => state.finished);
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
          coverUrl: pack.cover?.url ? resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url) : undefined,
          list: pack,
        }));
        setRows([...classics, ...words]);
        setRecords(have);
        setError("");
      } catch (reason) {
        if (alive) setError(errorText(reason, "err.catalogLoad"));
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

  const shelfIds = useMemo(() => new Set(shelf.map((book) => book.id)), [shelf]);
  const byPack = useMemo(() => new Map(records.map((record) => [record.packId, record])), [records]);

  async function addList(pack: WordListPack) {
    setError("");
    setBusyId(pack.id);
    try {
      const bookId = await placeWordList(pack);
      setRecords(await listPackRecords());
      onNeedsEpub(bookId);
    } catch (reason) {
      setError(errorText(reason, "err.bookAddFailed"));
    } finally {
      setBusyId("");
    }
  }

  function renderCard(row: Row) {
    const record = byPack.get(row.id);
    const onShelf = Boolean(record && shelfIds.has(record.bookId));
    const book = onShelf ? shelf.find((item) => item.id === record?.bookId) : undefined;
    const needs = Boolean(book?.needsEpub);
    const item = row.kind === "classic" ? items[row.id] : undefined;
    const busy = Boolean(item && !item.error) || busyId === row.id;
    return (
      <li
        key={row.key}
        className={bookCardShell}
        {...(row.kind === "classic" ? { "data-pack": row.id } : { "data-word-list": row.id })}
      >
        <BookCover title={row.title} author={row.author} cover={row.coverUrl} />
        <div className="grid flex-1 content-start gap-0.5">
          <h3 className="min-h-[2.6em] overflow-hidden font-display text-[0.97rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" lang="en">
            {row.title}
          </h3>
          {row.author ? (
            <p className="truncate text-xs text-muted" lang="en">
              {row.author}
            </p>
          ) : null}
          <BookMetaLines lexile={row.lexile} isbn={row.isbn} series={row.series} seriesNumber={row.seriesNumber} />
        </div>
        <div className="mt-auto grid gap-2" data-card-actions>
          {busy && item ? (
            <div className="grid gap-1.5" aria-live="polite">
              <ProgressBar value={item.fraction} className="h-2" label={t("pack.progressFor", { title: row.title })} />
              <p className="text-xs tabular-nums text-muted">
                {t(`pack.stage.${item.stage}`)} · {Math.round(item.fraction * 100)}%
              </p>
            </div>
          ) : onShelf && !needs && record ? (
            <button
              type="button"
              className={cn(btn.ghost, "w-full border border-transparent text-accent")}
              onClick={() => onOpen(record.bookId)}
              aria-label={t("pack.openAria", { title: row.title })}
            >
              <Check className="size-4" aria-hidden />
              {t("pack.open")}
            </button>
          ) : needs && record ? (
            <button
              type="button"
              className={cn(btn.primary, "w-full")}
              onClick={() => onNeedsEpub(record.bookId)}
              aria-label={t("discover.addEpubAria", { title: row.title })}
            >
              <BookPlus className="size-4" aria-hidden />
              {t("discover.addEpub")}
            </button>
          ) : (
            <button
              type="button"
              className={cn(btn.primary, "w-full")}
              disabled={busy}
              aria-label={t("discover.addAria", { title: row.title })}
              onClick={() => {
                if (row.kind === "classic" && row.pack) void start(BUNDLED_CATALOG_URL, row.pack);
                else if (row.list) void addList(row.list);
              }}
            >
              <Download className="size-4" aria-hidden />
              {busyId === row.id ? t("discover.working") : t("discover.add")}
            </button>
          )}
          {item?.error ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              {item.error}
            </p>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6" data-discover>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-display text-3xl font-semibold">{t("discover.title")}</h1>
          <p className="max-w-xl text-sm text-muted">{t("discover.hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DifficultyControls sort={sort} sorts={["listed", "easy", "hard", "title"]} onSort={setSort} band={band} onBand={setBand} />
          <ListFilters authors={authors} seriesNames={seriesNames} author={author} series={series} onAuthor={setAuthor} onSeries={setSeries} />
        </div>
      </div>
      <input
        className={field}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("discover.search")}
        aria-label={t("discover.search")}
        data-discover-search
      />
      {error ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">{query.trim() ? t("shelf.noMatch", { query: query.trim() }) : t("shelf.series.empty")}</p>
      ) : series === "grouped" ? (
        <div className="grid gap-8">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-4" data-series-group={group.key}>
              <h2 className="font-display text-lg font-semibold" lang={group.title ? "en" : undefined}>
                {group.title || t("shelf.series.none")}
              </h2>
              <ul className={bookCardGrid}>{group.rows.map(renderCard)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className={bookCardGrid}>{shown.map(renderCard)}</ul>
      )}
    </div>
  );
}
