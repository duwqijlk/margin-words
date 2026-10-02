import * as Dialog from "@radix-ui/react-dialog";
import { BookOpenText, Check, Download, FileArchive, RefreshCw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type PackRecord } from "@/lib/book-db";
import { useDownloads } from "@/lib/downloads";
import { errorText, useT } from "@/lib/i18n";
import {
  adoptLegacyBooks,
  catalogUrlProblem,
  DEFAULT_CATALOG_URL,
  getCatalogUrl,
  listPackRecords,
  loadCatalog,
  resolveAgainst,
  setCatalogUrl,
  stateOf,
  type CatalogPack,
  type CatalogResult,
} from "@/lib/packs";
import type { Book } from "@/lib/vocab-model";
import { BookCover } from "@/components/shelf";
import {
  BookMetaLines,
  DifficultyControls,
  matchesBand,
  type BandChoice,
  type SortChoice,
} from "@/components/lexile-ui";
import { bookCardGrid, bookCardShell, ListFilters, type SeriesChoice } from "@/components/list-filters";
import { compareLexile } from "@/lib/lexile";
import { btn, cn, field, ProgressBar, Segmented } from "@/components/ui";
import { usePrefs } from "@/lib/reader-prefs";
import { LanguageSwitch } from "@/components/language";
import { guideUrl } from "@/lib/guide";

function megabytes(bytes: number, tiny: string): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? tiny : `${mb.toFixed(1)} MB`;
}

function PackCard({
  pack,
  catalogUrl,
  record,
  onShelf,
  onOpen,
}: {
  pack: CatalogPack;
  catalogUrl: string;
  record: PackRecord | undefined;
  onShelf: boolean;
  onOpen: (bookId: string) => void;
}) {
  const { t, tn } = useT();
  const item = useDownloads((state) => state.items[pack.id]);
  const start = useDownloads((state) => state.start);
  const state = stateOf(pack, record ? [record] : []);
  const installed = state.kind !== "new" && onShelf;
  const busy = Boolean(item && !item.error);
  const size = megabytes(pack.epub.bytes + pack.glossary.bytes, t("pack.sizeTiny"));
  const coverUrl = pack.cover?.url ? resolveAgainst(catalogUrl, pack.cover.url) : undefined;
  return (
    <li className={bookCardShell} data-pack={pack.id}>
      <BookCover title={pack.title} author={pack.author} cover={coverUrl} />
      <div className="grid flex-1 content-start gap-0.5">
        <h3 className="min-h-[2.6em] overflow-hidden font-display text-[0.97rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" lang="en">
          {pack.title}
        </h3>
        {pack.author ? (
          <p className="truncate text-xs text-muted" lang="en">
            {pack.author}
          </p>
        ) : null}
        <BookMetaLines
          lexile={pack.lexile}
          isbn={pack.isbn}
          series={pack.series}
          seriesNumber={pack.seriesNumber}
        />
        <p className="text-xs text-muted tabular-nums">
          {pack.words > 0 ? tn("count.word", pack.words) : t("pack.noList")}
          {size ? ` · ${size}` : ""}
        </p>
        {item?.error ? (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
            {item.error}
          </p>
        ) : null}
      </div>

      {busy && item ? (
        <div className="mt-auto grid min-h-11 justify-end gap-1.5" aria-live="polite" data-card-actions>
          <ProgressBar
            value={item.fraction}
            className="h-2"
            label={t("pack.progressFor", { title: pack.title })}
          />
          <p className="text-xs tabular-nums text-muted">
            {t(`pack.stage.${item.stage}`)} · {Math.round(item.fraction * 100)}%
          </p>
        </div>
      ) : (
        <div className="mt-auto grid gap-2" data-card-actions>
          {state.kind === "new" || !onShelf ? (
            <button
              type="button"
              className={cn(btn.quiet, "w-full text-accent")}
              onClick={() => void start(catalogUrl, pack)}
              aria-label={t("pack.downloadAria", { title: pack.title })}
            >
              <Download className="size-4" aria-hidden />
              {t("pack.download")}
            </button>
          ) : null}
          {installed && state.kind === "update" ? (
            <button
              type="button"
              className={cn(btn.quiet, "w-full text-accent")}
              onClick={() => void start(catalogUrl, pack)}
              aria-label={t("pack.updateAria", { title: pack.title })}
              data-update
            >
              <RefreshCw className="size-4" aria-hidden />
              {t("pack.update")}
            </button>
          ) : null}
          {installed && state.kind === "installed" ? (
            <button
              type="button"
              className={cn(btn.ghost, "w-full border border-transparent text-accent")}
              onClick={() => onOpen(record?.bookId ?? "")}
              aria-label={t("pack.openAria", { title: pack.title })}
            >
              <Check className="size-4" aria-hidden />
              {t("pack.open")}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Add a book pack (.zip). The catalog of books lives on Discover.
 * A plain EPUB is added from a word-list card on Discover, after the word list is on the shelf.
 */
export function AddBookScreen({
  shelf,
  importing,
  onOpen,
  onSettings,
  onImportClick,
  settingsVersion,
}: {
  shelf: Book[];
  importing: boolean;
  onOpen: (bookId: string) => void;
  onSettings: () => void;
  onImportClick: () => void;
  /** goes up when the catalog address was changed in Settings */
  settingsVersion: number;
}) {
  const { t } = useT();
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PackRecord[]>([]);
  const [run, setRun] = useState(0);
  const finished = useDownloads((state) => state.finished);
  const items = useDownloads((state) => state.items);
  const start = useDownloads((state) => state.start);
  const url = useMemo(() => getCatalogUrl(), [settingsVersion, run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setProblem("");
    void loadCatalog(url)
      .then(async (next) => {
        if (!alive) return;
        setResult(next);
        const have = await adoptLegacyBooks(next.catalog.packs);
        if (alive) setRecords(have);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setResult(null);
        setProblem(errorText(reason, "err.catalogLoad"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const reload = useCallback(() => {
    void listPackRecords()
      .then(setRecords)
      .catch(() => undefined);
  }, []);
  useEffect(reload, [finished, reload, shelf.length]);

  const onShelf = useMemo(() => new Set(shelf.map((book) => book.id)), [shelf]);
  const packs = result?.catalog.packs ?? [];
  const [sort, setSort] = useState<SortChoice>("listed");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const authors = useMemo(
    () => [...new Set(packs.map((pack) => pack.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [packs],
  );
  const seriesNames = useMemo(
    () => [...new Set(packs.map((pack) => pack.series).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [packs],
  );
  const shown = useMemo(() => {
    let banded = packs.filter((pack) => matchesBand(pack.lexile, band));
    if (author !== "all") banded = banded.filter((pack) => pack.author === author);
    if (series === "none") banded = banded.filter((pack) => !pack.series);
    else if (series !== "all" && series !== "grouped") banded = banded.filter((pack) => pack.series === series);
    if (sort === "listed" || sort === "recent" || series === "grouped") return banded;
    const copy = [...banded];
    if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title) || a.author.localeCompare(b.author));
    else copy.sort((a, b) => compareLexile(a.lexile, b.lexile, sort) || a.title.localeCompare(b.title));
    return copy;
  }, [packs, sort, band, author, series]);
  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(shown.map((pack) => pack.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: shown
        .filter((pack) => pack.series === name)
        .sort((a, b) => a.seriesNumber - b.seriesNumber || a.title.localeCompare(b.title)),
    }));
    const rest = shown.filter((pack) => !pack.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [shown, series]);
  const todo = packs.filter((pack) => {
    const record = records.find((item) => item.packId === pack.id);
    return (!record || !onShelf.has(record.bookId) || record.rev !== pack.rev) && !items[pack.id];
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("add.title")}</h1>
      </header>

      <section
        className="flex flex-col gap-4 rounded-3xl border-2 border-dashed border-line bg-card p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-7"
        aria-label={t("add.packTitle")}
        data-drop-zone
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <FileArchive className="size-7" aria-hidden />
        </span>
        <div className="grid flex-1 gap-1">
          <h2 className="font-display text-xl font-semibold">{t("add.packTitle")}</h2>
          <p className="text-sm text-muted">{t("add.packBody")}</p>
          <a
            className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-semibold text-accent underline"
            href={guideUrl()}
            target="_blank"
            rel="noopener"
            data-guide-link
          >
            <BookOpenText className="size-4" aria-hidden />
            {t("add.howTo")}
          </a>
        </div>
        <button
          type="button"
          className={cn(btn.primary, "sm:px-6")}
          onClick={onImportClick}
          disabled={importing}
        >
          <Upload className="size-4" aria-hidden />
          {importing ? t("shelf.importing") : t("add.choose")}
        </button>
      </section>

      <section className="grid gap-4" aria-label={t("add.free")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{t("add.free")}</h2>
          {packs.length >= 2 ? (
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
          ) : null}
          {todo.length > 1 ? (
            <button
              type="button"
              className={cn(btn.ghost, "-mr-3 text-accent")}
              onClick={() => {
                for (const pack of todo) void start(url, pack);
              }}
            >
              <Download className="size-4" aria-hidden />
              {t("get.downloadAll", { n: todo.length })}
            </button>
          ) : null}
        </div>

        {url === DEFAULT_CATALOG_URL ? (
          <p className="text-sm text-muted" data-free-hint>
            {t("add.freeHint")}
          </p>
        ) : null}

        {result?.offline ? (
          <p className="rounded-2xl bg-accent-soft px-4 py-3 text-sm" role="status">
            {t("get.offline")}
          </p>
        ) : null}

        {loading ? (
          <div
            className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            aria-busy="true"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="grid gap-3">
                <div className="aspect-[2/3] animate-pulse rounded-md bg-line" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
              </div>
            ))}
          </div>
        ) : problem ? (
          <div
            className="grid justify-items-start gap-3 rounded-2xl border border-line bg-card p-5"
            role="alert"
          >
            <p className="text-[0.98rem]">{problem}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn.primary} onClick={() => setRun((n) => n + 1)}>
                <RefreshCw className="size-4" aria-hidden />
                {t("get.tryAgain")}
              </button>
              <button type="button" className={btn.quiet} onClick={onSettings}>
                {t("get.changeAddress")}
              </button>
            </div>
          </div>
        ) : packs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-card px-6 py-10 text-center text-muted">
            {t("get.none")}
          </p>
        ) : shown.length === 0 ? (
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
                  {group.rows.map((pack) => (
                    <PackCard
                      key={pack.id}
                      pack={pack}
                      catalogUrl={url}
                      record={records.find((item) => item.packId === pack.id)}
                      onShelf={onShelf.has(records.find((item) => item.packId === pack.id)?.bookId ?? "")}
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className={bookCardGrid}>
            {shown.map((pack) => (
              <PackCard
                key={pack.id}
                pack={pack}
                catalogUrl={url}
                record={records.find((item) => item.packId === pack.id)}
                onShelf={onShelf.has(records.find((item) => item.packId === pack.id)?.bookId ?? "")}
                onOpen={onOpen}
              />
            ))}
          </ul>
          )
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

export function SettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const theme = usePrefs((state) => state.theme);
  const setPrefs = usePrefs((state) => state.set);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (open) {
      const now = getCatalogUrl();
      setValue(now === DEFAULT_CATALOG_URL ? "" : now);
      setProblem("");
    }
  }, [open]);

  function save(next: string) {
    const bad = catalogUrlProblem(next);
    if (bad) {
      setProblem(t(bad));
      return;
    }
    setCatalogUrl(next);
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-pop sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl font-semibold">
              {t("settings.title")}
            </Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("settings.desc")}</Dialog.Description>
          <section
            className="mt-5 grid gap-2"
            aria-label={t("settings.langTitle")}
            data-settings-language
          >
            <h3 className="text-sm font-semibold">{t("settings.langTitle")}</h3>
            <LanguageSwitch />
          </section>
          <section className="mt-5 grid gap-2" aria-label={t("rs.theme")} data-settings-theme>
            <h3 className="text-sm font-semibold">{t("rs.theme")}</h3>
            <Segmented
              label={t("rs.theme")}
              value={theme}
              onChange={(next) => setPrefs({ theme: next })}
              options={[
                { value: "light" as const, label: t("rs.theme.light") },
                { value: "sepia" as const, label: t("rs.theme.sepia") },
                { value: "dark" as const, label: t("rs.theme.dark") },
              ]}
            />
          </section>
          <details
            className="mt-5 rounded-xl border border-line px-4 py-1 open:pb-4"
            data-settings-advanced
          >
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
              {t("settings.advanced")}
            </summary>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                save(value);
              }}
            >
              <label className="grid gap-1 text-sm font-medium">
                {t("settings.catalogLabel")}
                <input
                  className={field}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setProblem("");
                  }}
                  placeholder={t("settings.placeholder", { url: DEFAULT_CATALOG_URL })}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(problem)}
                />
              </label>
              <p className="text-xs text-muted">{t("settings.help")}</p>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button type="button" className={btn.quiet} onClick={() => save("")}>
                  {t("settings.useBuiltin")}
                </button>
                <button type="submit" className={btn.primary}>
                  {t("common.save")}
                </button>
              </div>
            </form>
          </details>
          <a
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline"
            href={guideUrl()}
            target="_blank"
            rel="noopener"
            data-guide-link
          >
            {t("settings.guide")}
          </a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
