import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { BUNDLED_CATALOG_URL } from "@/lib/packs";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { browseRails, DISCOVER_RAIL_BOOKS, DISCOVER_RAIL_LIMIT, type DiscoverRailSpec } from "@/lib/discover-rails";
import { loadDiscoverRailFile } from "@/lib/discover-rail-config";
import { btn, cn, field } from "@/components/ui";

type ShelfBook = {
  key: string;
  title: string;
  author: string;
  series: string;
  seriesNumber: number;
  kind: "classic" | "list";
};

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function textOf(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function booksOf(kind: "classic" | "list", rows: unknown): ShelfBook[] {
  if (!Array.isArray(rows)) return [];
  const prefix = kind === "classic" ? "classic" : "list";
  const out: ShelfBook[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; title?: unknown; author?: unknown; series?: unknown; seriesNumber?: unknown };
    const id = textOf(row.id);
    if (!ID_PATTERN.test(id)) continue;
    const series = textOf(row.series);
    const number = typeof row.seriesNumber === "number" && row.seriesNumber > 0 ? Math.floor(row.seriesNumber) : 0;
    out.push({
      key: `${prefix}:${id}`,
      title: textOf(row.title) || id,
      author: textOf(row.author),
      series,
      seriesNumber: series ? number : 0,
      kind,
    });
  }
  return out;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = index + delta;
  if (next < 0 || next >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  if (!item) return list;
  copy.splice(next, 0, item);
  return copy;
}

/** Admin list of the sideways series rows on Discover. */
export function SeriesAdmin() {
  const { t } = useT();
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [rails, setRails] = useState<DiscoverRailSpec[]>([]);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch(WORD_LIST_CATALOG_URL, { cache: "no-cache" }).then((response) => (response.ok ? response.json() : { lists: [] })),
      fetch(BUNDLED_CATALOG_URL, { cache: "no-cache" }).then((response) => (response.ok ? response.json() : { packs: [] })),
      loadDiscoverRailFile(),
    ])
      .then(([lists, packs, file]) => {
        if (!alive) return;
        const loaded = [
          ...booksOf("list", (lists as { lists?: unknown }).lists),
          ...booksOf("classic", (packs as { packs?: unknown }).packs),
        ];
        setBooks(loaded);
        if (file) {
          setRails(file);
          setSaved(true);
        } else {
          const suggested = browseRails(loaded.map((book) => ({ ...book, lexile: "" })))
            .filter((rail) => rail.kind === "series")
            .map((rail) => ({ source: "series" as const, name: rail.name }));
          setRails(suggested);
          setSaved(false);
        }
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byKey = useMemo(() => new Map((books ?? []).map((book) => [book.key, book])), [books]);
  const seriesChoices = useMemo(() => {
    const used = new Set(rails.filter((rail) => rail.source === "series").map((rail) => rail.name));
    return [...new Set((books ?? []).map((book) => book.series).filter(Boolean))]
      .filter((series) => !used.has(series))
      .sort((a, b) => a.localeCompare(b));
  }, [books, rails]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (books ?? [])
      .filter((book) => !q || `${book.title} ${book.author}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [books, query]);

  function addSeries() {
    if (!seriesName || rails.length >= DISCOVER_RAIL_LIMIT || rails.some((rail) => rail.name === seriesName)) return;
    setRails((current) => [...current, { source: "series", name: seriesName }]);
    setSeriesName("");
    setNote("");
  }

  function addCustom() {
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed || picked.length === 0 || rails.length >= DISCOVER_RAIL_LIMIT || rails.some((rail) => rail.name === trimmed)) return;
    setRails((current) => [...current, { source: "custom", name: trimmed, books: picked }]);
    setName("");
    setPicked([]);
    setQuery("");
    setNote("");
  }

  function toggleBook(key: string) {
    setPicked((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= DISCOVER_RAIL_BOOKS) return current;
      return [...current, key];
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch("/api/admin/discover-rails", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rails }),
      });
      if (!response.ok) throw new Error("save");
      setSaved(true);
      setNote(t("admin.series.saved"));
    } catch {
      setError(t("admin.series.error"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-4 text-xs text-warn" role="alert">{t("admin.series.error")}</p>;
  if (!books || saved === null) return <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>;

  return (
    <div className="grid gap-6" data-admin-series>
      <div className="rounded-2xl border border-line/80 bg-card p-5 shadow-2xs sm:p-6">
        <div>
          <p className="text-sm text-muted">{t("admin.series.hint")}</p>
          {!saved ? <p className="mt-1 text-xs text-muted/80">{t("admin.series.unsaved")}</p> : null}
        </div>

        {rails.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-line/80 p-8 text-center text-xs text-muted">
            {t("admin.series.empty")}
          </div>
        ) : (
          <ol className="mt-4 grid gap-2.5">
            {rails.map((rail, index) => (
              <li
                key={`${rail.source}:${rail.name}`}
                className="grid gap-2 rounded-xl border border-line/70 bg-paper/50 p-3.5 shadow-2xs transition-colors hover:border-line hover:bg-card sm:p-4"
                data-admin-series-row={rail.name}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-line/50 font-mono text-xs font-bold text-muted tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="font-display text-sm font-bold text-ink" lang="en">
                      {rail.name}
                    </p>
                    <span className="rounded-md border border-line/70 bg-card px-2 py-0.5 text-[0.7rem] font-medium text-muted">
                      {rail.source === "series"
                        ? t("admin.series.kindSeries")
                        : t("admin.series.books", { n: rail.books.length })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className={cn(btn.quiet, "h-8 min-h-0 px-2 text-xs")}
                      disabled={index === 0}
                      onClick={() => setRails((current) => move(current, index, -1))}
                    >
                      {t("admin.series.up")}
                    </button>
                    <button
                      type="button"
                      className={cn(btn.quiet, "h-8 min-h-0 px-2 text-xs")}
                      disabled={index === rails.length - 1}
                      onClick={() => setRails((current) => move(current, index, 1))}
                    >
                      {t("admin.series.down")}
                    </button>
                    <button
                      type="button"
                      className={cn(btn.quiet, "h-8 min-h-0 px-2 text-xs text-muted hover:text-warn")}
                      onClick={() => setRails((current) => current.filter((_, at) => at !== index))}
                    >
                      {t("admin.series.remove")}
                    </button>
                  </div>
                </div>

                {rail.source === "custom" ? (
                  <p className="text-xs text-muted/80">
                    {rail.books.map((key) => byKey.get(key)?.title ?? key).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid gap-4 rounded-2xl border border-line/80 bg-card p-5 shadow-2xs sm:p-6">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">
          {t("admin.series.addSeries")}
        </span>
        <div className="flex flex-wrap gap-2">
          <select
            className={cn(field, "h-10 min-h-0 min-w-0 flex-1 text-xs font-semibold")}
            value={seriesName}
            onChange={(event) => setSeriesName(event.target.value)}
            data-admin-series-pick
          >
            <option value="">{t("admin.series.pickSeries")}</option>
            {seriesChoices.map((series) => (
              <option key={series} value={series}>
                {series}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={cn(btn.quiet, "h-10 min-h-0 px-4 text-xs font-semibold")}
            disabled={!seriesName}
            onClick={addSeries}
          >
            {t("admin.series.add")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-line/80 bg-card p-5 shadow-2xs sm:p-6" data-admin-series-custom>
        <span className="text-xs font-bold uppercase tracking-wider text-muted">
          {t("admin.series.addCustom")}
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">
            {t("admin.series.name")}
            <input
              className={cn(field, "h-10 min-h-0 text-xs font-semibold")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-admin-series-name
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted">
            {t("admin.series.search")}
            <input
              className={cn(field, "h-10 min-h-0 text-xs font-semibold")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              data-admin-series-search
            />
          </label>
        </div>

        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line/60 bg-paper/40 p-2">
          {matches.map((book) => (
            <li key={book.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-card">
                <input
                  type="checkbox"
                  className="size-3.5 rounded accent-accent"
                  checked={picked.includes(book.key)}
                  onChange={() => toggleBook(book.key)}
                />
                <span className="font-medium text-ink" lang="en">{book.title}</span>
                {book.author ? <span className="text-muted">· {book.author}</span> : null}
              </label>
            </li>
          ))}
        </ul>

        <div>
          <button
            type="button"
            className={cn(btn.quiet, "h-10 min-h-0 px-4 text-xs font-semibold")}
            disabled={!name.trim() || picked.length === 0}
            onClick={addCustom}
          >
            {t("admin.series.add")}
          </button>
        </div>
      </div>

      {note ? <p className="text-xs font-semibold text-accent">{note}</p> : null}
      {error ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          className={cn(btn.primary, "px-5 text-xs font-semibold")}
          disabled={busy}
          data-admin-series-save
          onClick={() => void save()}
        >
          {busy ? t("account.working") : t("admin.series.save")}
        </button>
      </div>
    </div>
  );
}
