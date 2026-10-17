import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";
import { formatShanghaiDate } from "@/lib/sponsor";
import { btn, cn, field } from "@/components/ui";
import { AlertCircle, BookOpen, MousePointerClick, Search, Sparkles } from "lucide-react";

type TapRow = {
  bookId: string;
  word: string;
  tapCount: number;
  inGlossary: boolean;
  lastTappedAt: number;
};

type TapSummary = {
  totalWords: number;
  missingWords: number;
  totalTaps: number;
};

function readTaps(value: unknown): TapRow[] {
  if (!Array.isArray(value)) return [];
  const out: TapRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<TapRow>;
    if (typeof row.bookId !== "string" || typeof row.word !== "string") continue;
    out.push({
      bookId: row.bookId,
      word: row.word,
      tapCount: typeof row.tapCount === "number" ? row.tapCount : 1,
      inGlossary: row.inGlossary === true,
      lastTappedAt: typeof row.lastTappedAt === "number" ? row.lastTappedAt : 0,
    });
  }
  return out;
}

export function WordTapsAdmin() {
  const { t } = useT();
  const [rows, setRows] = useState<TapRow[] | null>(null);
  const [summary, setSummary] = useState<TapSummary>({ totalWords: 0, missingWords: 0, totalTaps: 0 });
  const [filter, setFilter] = useState<"missing" | "all">("missing");
  const [search, setSearch] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(nextPage: number, nextFilter = filter, nextSearch = search, nextBook = bookFilter) {
    setLoading(true);
    setError("");
    try {
      const q = encodeURIComponent(nextSearch.trim());
      const b = encodeURIComponent(nextBook.trim());
      const url = `/api/admin/word-taps?filter=${nextFilter}&q=${q}&bookId=${b}&page=${nextPage}&pageSize=30`;
      const payload = await accountRequest(url);
      setRows(readTaps(payload.items));
      setTotal(typeof payload.total === "number" ? payload.total : 0);
      if (payload.summary && typeof payload.summary === "object") {
        const s = payload.summary as Partial<TapSummary>;
        setSummary({
          totalWords: typeof s.totalWords === "number" ? s.totalWords : 0,
          missingWords: typeof s.missingWords === "number" ? s.missingWords : 0,
          totalTaps: typeof s.totalTaps === "number" ? s.totalTaps : 0,
        });
      }
      setPage(nextPage);
    } catch {
      setError(t("admin.users.error"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const pages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="grid gap-5" data-admin-word-taps>
      {/* Information Header */}
      <div className="rounded-2xl border border-line/80 bg-card p-5 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-ink sm:text-lg">{t("admin.taps.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t("admin.taps.desc")}</p>
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {/* Missing Words */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.taps.missingWords")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-amber-700 dark:text-amber-300 sm:text-2xl">
              {summary.missingWords}
            </p>
          </div>
        </div>

        {/* Tracked Words */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <BookOpen className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.taps.totalWords")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {summary.totalWords}
            </p>
          </div>
        </div>

        {/* Total Clicks */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <MousePointerClick className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.taps.totalTaps")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {summary.totalTaps}
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(event) => {
            event.preventDefault();
            void load(1, filter, search, bookFilter);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <input
              className={cn(field, "min-w-0 flex-1 pl-8 text-sm")}
              type="search"
              value={search}
              placeholder={t("admin.taps.searchPlaceholder")}
              aria-label={t("admin.taps.searchPlaceholder")}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          </div>

          <input
            className={cn(field, "w-full text-sm sm:w-44")}
            type="search"
            value={bookFilter}
            placeholder={t("admin.taps.bookFilterPlaceholder")}
            aria-label={t("admin.taps.bookFilterPlaceholder")}
            onChange={(e) => setBookFilter(e.target.value)}
          />

          <button type="submit" className={cn(btn.primary, "px-4 text-xs font-semibold")}>
            {t("admin.taps.find")}
          </button>
        </form>

        <div className="inline-flex rounded-xl border border-line/80 bg-paper/60 p-1 text-xs">
          <button
            type="button"
            className={cn(
              "rounded-lg px-3 py-1 font-semibold transition-colors",
              filter === "missing"
                ? "bg-card text-ink shadow-2xs"
                : "text-muted hover:text-ink",
            )}
            onClick={() => setFilter("missing")}
          >
            {t("admin.taps.filterMissing")}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-lg px-3 py-1 font-semibold transition-colors",
              filter === "all"
                ? "bg-card text-ink shadow-2xs"
                : "text-muted hover:text-ink",
            )}
            onClick={() => setFilter("all")}
          >
            {t("admin.taps.filterAll")}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}

      {/* Words List */}
      {rows === null || loading ? (
        <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line/80 bg-card p-10 text-center text-muted">
          {t("admin.taps.empty")}
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li
              key={`${row.bookId}:${row.word}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs transition-shadow hover:shadow-xs"
            >
              <div className="flex items-center gap-3">
                <span className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                  {row.word}
                </span>

                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide",
                    row.inGlossary
                      ? "border border-accent/25 bg-accent-soft text-accent"
                      : "border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {row.inGlossary ? t("admin.taps.statusInGlossary") : t("admin.taps.statusMissing")}
                </span>

                <span className="rounded-md border border-line/70 bg-line/20 px-2 py-0.5 font-mono text-[11px] text-muted">
                  {row.bookId}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <span className="rounded-full bg-accent-soft px-3 py-1 font-display text-xs font-bold text-accent">
                  {t("admin.taps.clickCount", { n: row.tapCount })}
                </span>
                <span className="text-xs text-muted">
                  {formatShanghaiDate(row.lastTappedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {pages > 1 ? (
        <div className="flex items-center justify-between rounded-xl border border-line/60 bg-card p-3 text-xs font-semibold">
          <button
            type="button"
            className={cn(btn.quiet, "h-8 min-h-0 px-3 text-xs")}
            disabled={page <= 1}
            onClick={() => void load(page - 1)}
          >
            {t("admin.taps.prev")}
          </button>
          <p className="text-muted">
            {page} / {pages}
          </p>
          <button
            type="button"
            className={cn(btn.quiet, "h-8 min-h-0 px-3 text-xs")}
            disabled={page >= pages}
            onClick={() => void load(page + 1)}
          >
            {t("admin.taps.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
