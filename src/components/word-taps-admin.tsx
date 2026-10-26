import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";
import { formatShanghaiDate } from "@/lib/sponsor";
import { btn, cn, field } from "@/components/ui";
import type { FeedbackReason } from "@/components/word-feedback";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  HelpCircle,
  MousePointerClick,
  Search,
  Sparkles,
} from "lucide-react";

type TapRow = {
  bookId: string;
  bookTitle: string;
  word: string;
  form: string;
  chapter: number;
  /** How many chapters the reporting reader's copy has (0 when the client did not say). */
  chapters: number;
  occurrence: number;
  paragraph: number;
  context: string;
  sentence: string;
  glossaryRev: string;
  status: "pending" | "resolved";
  resolvedAt: number;
  resolvedRev: string;
  tapCount: number;
  inGlossary: boolean;
  lastTappedAt: number;
  anchor?: {
    chapter: number;
    occurrence: number;
    form: string;
    context: string;
  };
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
      bookTitle: typeof row.bookTitle === "string" ? row.bookTitle : "",
      word: row.word,
      form: typeof row.form === "string" ? row.form : row.word,
      chapter: typeof row.chapter === "number" ? row.chapter : 0,
      chapters: typeof row.chapters === "number" ? row.chapters : 0,
      occurrence: typeof row.occurrence === "number" ? row.occurrence : 1,
      paragraph: typeof row.paragraph === "number" ? row.paragraph : 0,
      context: typeof row.context === "string" ? row.context : "",
      sentence: typeof row.sentence === "string" ? row.sentence : "",
      glossaryRev: typeof row.glossaryRev === "string" ? row.glossaryRev : "",
      status: row.status === "resolved" ? "resolved" : "pending",
      resolvedAt: typeof row.resolvedAt === "number" ? row.resolvedAt : 0,
      resolvedRev: typeof row.resolvedRev === "string" ? row.resolvedRev : "",
      tapCount: typeof row.tapCount === "number" ? row.tapCount : 1,
      inGlossary: row.inGlossary === true,
      lastTappedAt: typeof row.lastTappedAt === "number" ? row.lastTappedAt : 0,
    });
  }
  return out;
}

type FeedbackRow = {
  bookId: string;
  bookTitle: string;
  word: string;
  form: string;
  chapter: number;
  chapters: number;
  occurrence: number;
  paragraph: number;
  context: string;
  sentence: string;
  senseIndex: number;
  senseMeaning: string;
  suggestions: string[];
  reason: FeedbackReason;
  count: number;
  lastReportedAt: number;
  glossaryRev: string;
  status: "pending" | "resolved" | "reopened";
  resolvedAt: number;
  resolvedRev: string;
};

type FeedbackSummary = {
  totalReports: number;
  tooHardReports: number;
  wrongMeaningReports: number;
  reopenedReports?: number;
  distinctWords: number;
};

function readFeedback(value: unknown): FeedbackRow[] {
  if (!Array.isArray(value)) return [];
  const out: FeedbackRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<FeedbackRow>;
    if (typeof row.bookId !== "string" || typeof row.word !== "string") continue;
    out.push({
      bookId: row.bookId,
      bookTitle: typeof row.bookTitle === "string" ? row.bookTitle : "",
      word: row.word,
      form: typeof row.form === "string" ? row.form : row.word,
      chapter: typeof row.chapter === "number" ? row.chapter : 0,
      chapters: typeof row.chapters === "number" ? row.chapters : 0,
      occurrence: typeof row.occurrence === "number" ? row.occurrence : 1,
      paragraph: typeof row.paragraph === "number" ? row.paragraph : 0,
      context: typeof row.context === "string" ? row.context : "",
      sentence: typeof row.sentence === "string" ? row.sentence : "",
      senseIndex: typeof row.senseIndex === "number" ? row.senseIndex : -1,
      senseMeaning: typeof row.senseMeaning === "string" ? row.senseMeaning : "",
      suggestions: Array.isArray(row.suggestions) ? row.suggestions.filter((s): s is string => typeof s === "string") : [],
      reason:
        row.reason === "wrong_meaning" || row.reason === "missing_meaning" || row.reason === "suggested"
          ? row.reason
          : "too_hard",
      count: typeof row.count === "number" ? row.count : 1,
      lastReportedAt: typeof row.lastReportedAt === "number" ? row.lastReportedAt : 0,
      glossaryRev: typeof row.glossaryRev === "string" ? row.glossaryRev : "",
      status:
        row.status === "reopened"
          ? "reopened"
          : row.status === "resolved"
            ? "resolved"
            : "pending",
      resolvedAt: typeof row.resolvedAt === "number" ? row.resolvedAt : 0,
      resolvedRev: typeof row.resolvedRev === "string" ? row.resolvedRev : "",
    });
  }
  return out;
}

export function WordTapsAdmin() {
  const { t } = useT();
  const [subTab, setSubTab] = useState<"taps" | "feedback">("taps");

  return (
    <div className="grid gap-5" data-admin-word-analytics>
      {/* Sub Tab Navigation */}
      <div className="flex items-center gap-1.5 rounded-xl border border-line/60 bg-paper/60 p-1 w-fit text-xs font-semibold">
        <button
          type="button"
          onClick={() => setSubTab("taps")}
          className={cn(
            "rounded-lg px-3.5 py-1.5 transition-colors",
            subTab === "taps"
              ? "bg-card text-ink shadow-2xs"
              : "text-muted hover:text-ink",
          )}
          data-subtab="taps"
        >
          {t("admin.taps.tabTaps")}
        </button>
        <button
          type="button"
          onClick={() => setSubTab("feedback")}
          className={cn(
            "rounded-lg px-3.5 py-1.5 transition-colors",
            subTab === "feedback"
              ? "bg-card text-ink shadow-2xs"
              : "text-muted hover:text-ink",
          )}
          data-subtab="feedback"
        >
          {t("admin.taps.tabFeedback")}
        </button>
      </div>

      {subTab === "taps" ? <WordTapsSubView /> : <WordFeedbackSubView />}
    </div>
  );
}

function WordTapsSubView() {
  const { t } = useT();
  const [rows, setRows] = useState<TapRow[] | null>(null);
  const [summary, setSummary] = useState<TapSummary>({ totalWords: 0, missingWords: 0, totalTaps: 0 });
  const [filter, setFilter] = useState<"missing" | "all" | "resolved">("missing");
  const [search, setSearch] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

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

  async function handleResolveTap(row: TapRow) {
    const key = `${row.bookId}:${row.word}:${row.chapter}:${row.occurrence}`;
    setResolvingKey(key);
    setError("");
    try {
      const res = await accountRequest("/api/admin/word-taps", {
        action: "resolve",
        bookId: row.bookId,
        word: row.word,
        chapter: row.chapter,
        occurrence: row.occurrence,
        rev: row.glossaryRev,
      });
      const resolvedRev =
        res && typeof res === "object" && typeof (res as { resolvedRev?: unknown }).resolvedRev === "string"
          ? (res as { resolvedRev: string }).resolvedRev
          : "";
      // Mark as resolved locally
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.bookId === row.bookId &&
              r.word === row.word &&
              r.chapter === row.chapter &&
              r.occurrence === row.occurrence
                ? { ...r, status: "resolved", resolvedAt: Date.now(), resolvedRev }
                : r,
            )
          : null,
      );
      if (row.status !== "resolved") {
        setSummary((prev) => ({
          ...prev,
          missingWords: Math.max(0, prev.missingWords - 1),
        }));
      }
    } catch {
      setError(t("admin.users.error"));
    } finally {
      setResolvingKey(null);
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
              filter === "resolved"
                ? "bg-card text-ink shadow-2xs"
                : "text-muted hover:text-ink",
            )}
            onClick={() => setFilter("resolved")}
          >
            {t("admin.taps.filterResolved")}
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

      {/* Words List with Location and Book Information */}
      {rows === null || loading ? (
        <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line/80 bg-card p-10 text-center text-muted">
          {t("admin.taps.empty")}
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const rowKey = `${row.bookId}:${row.word}:${row.chapter}:${row.occurrence}`;
            const isResolving = resolvingKey === rowKey;
            return (
              <li
                key={rowKey}
                className="flex flex-col gap-2.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs transition-shadow hover:shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                      {row.word}
                    </span>
                    {row.form && row.form !== row.word ? (
                      <span className="text-xs text-muted font-mono">({row.form})</span>
                    ) : null}

                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide",
                        row.status === "resolved"
                          ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : row.inGlossary
                            ? "border border-accent/25 bg-accent-soft text-accent"
                            : "border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {row.status === "resolved"
                        ? t("admin.status.resolved")
                        : row.inGlossary
                          ? t("admin.taps.statusInGlossary")
                          : t("admin.taps.statusMissing")}
                    </span>

                    {row.bookTitle ? (
                      <span className="font-semibold text-ink text-xs sm:text-sm">
                        {t("admin.taps.bookTitle", { title: row.bookTitle })}
                      </span>
                    ) : null}

                    <span className="rounded-md border border-line/70 bg-line/20 px-2 py-0.5 font-mono text-[11px] text-muted">
                      {row.bookId}
                    </span>

                    <span className="rounded-md border border-accent/25 bg-accent-soft/60 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t("admin.taps.location", { chapter: row.chapter + 1, occurrence: row.occurrence })}
                    </span>

                    {row.chapters > 0 ? (
                      <span className="rounded-md border border-line/70 bg-line/10 px-2 py-0.5 text-[11px] text-muted">
                        {t("admin.taps.chapters", { n: row.chapters })}
                      </span>
                    ) : null}

                    {row.glossaryRev ? (
                      <span className="rounded-md border border-line/70 bg-line/10 px-2 py-0.5 font-mono text-[11px] text-muted">
                        {t("admin.taps.revLabel", { rev: row.glossaryRev })}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3">
                    {row.status !== "resolved" ? (
                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => void handleResolveTap(row)}
                        className={cn(
                          btn.quiet,
                          "h-7 min-h-0 px-2.5 text-xs text-accent hover:bg-accent-soft border border-accent/25 font-semibold",
                        )}
                      >
                        <Check className="size-3.5 mr-1 inline" />
                        {isResolving ? t("admin.action.resolving") : t("admin.action.resolve")}
                      </button>
                    ) : (
                      <span className="inline-flex items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="size-3.5 mr-1" />
                        {t("admin.action.resolvedDone")}
                      </span>
                    )}

                    <span className="rounded-full bg-accent-soft px-3 py-1 font-display text-xs font-bold text-accent">
                      {t("admin.taps.clickCount", { n: row.tapCount })}
                    </span>
                    <span className="text-xs text-muted">
                      {formatShanghaiDate(row.lastTappedAt)}
                    </span>
                  </div>
                </div>

                {row.sentence || row.context ? (
                  <div className="rounded-xl border border-line/50 bg-paper/50 p-2.5 text-xs leading-relaxed">
                    {row.sentence ? (
                      <p className="font-display text-ink/90 italic">“{row.sentence}”</p>
                    ) : null}
                    {row.context ? (
                      <p className="mt-1 font-mono text-[11px] text-muted">
                        Anchor context: &quot;{row.context}&quot;
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
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

function WordFeedbackSubView() {
  const { t } = useT();
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [summary, setSummary] = useState<FeedbackSummary>({
    totalReports: 0,
    tooHardReports: 0,
    wrongMeaningReports: 0,
    distinctWords: 0,
  });
  const [reasonFilter, setReasonFilter] = useState<"all" | FeedbackReason>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "reopened">("all");
  const [search, setSearch] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  async function load(
    nextPage: number,
    nextReason = reasonFilter,
    nextStatus = statusFilter,
    nextSearch = search,
    nextBook = bookFilter,
  ) {
    setLoading(true);
    setError("");
    try {
      const q = encodeURIComponent(nextSearch.trim());
      const b = encodeURIComponent(nextBook.trim());
      const url = `/api/admin/word-feedback?reason=${nextReason}&status=${nextStatus}&q=${q}&bookId=${b}&page=${nextPage}&pageSize=30`;
      const payload = await accountRequest(url);
      setRows(readFeedback(payload.items));
      setTotal(typeof payload.total === "number" ? payload.total : 0);
      if (payload.summary && typeof payload.summary === "object") {
        const s = payload.summary as Partial<FeedbackSummary>;
        setSummary({
          totalReports: typeof s.totalReports === "number" ? s.totalReports : 0,
          tooHardReports: typeof s.tooHardReports === "number" ? s.tooHardReports : 0,
          wrongMeaningReports: typeof s.wrongMeaningReports === "number" ? s.wrongMeaningReports : 0,
          reopenedReports: typeof s.reopenedReports === "number" ? s.reopenedReports : 0,
          distinctWords: typeof s.distinctWords === "number" ? s.distinctWords : 0,
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

  async function handleResolveFeedback(row: FeedbackRow) {
    const key = `${row.bookId}:${row.word}:${row.chapter}:${row.occurrence}:${row.reason}`;
    setResolvingKey(key);
    setError("");
    try {
      const res = await accountRequest("/api/admin/word-feedback", {
        action: "resolve",
        bookId: row.bookId,
        word: row.word,
        chapter: row.chapter,
        occurrence: row.occurrence,
        reason: row.reason,
        rev: row.glossaryRev,
      });
      const resolvedRev =
        res && typeof res === "object" && typeof (res as { resolvedRev?: unknown }).resolvedRev === "string"
          ? (res as { resolvedRev: string }).resolvedRev
          : "";
      // Mark as resolved locally
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.bookId === row.bookId &&
              r.word === row.word &&
              r.chapter === row.chapter &&
              r.occurrence === row.occurrence &&
              r.reason === row.reason
                ? { ...r, status: "resolved", resolvedAt: Date.now(), resolvedRev }
                : r,
            )
          : null,
      );
    } catch {
      setError(t("admin.users.error"));
    } finally {
      setResolvingKey(null);
    }
  }

  useEffect(() => {
    void load(1, reasonFilter, statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonFilter, statusFilter]);

  const pages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="grid gap-5" data-admin-word-feedback>
      {/* Information Header */}
      <div className="rounded-2xl border border-line/80 bg-card p-5 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <HelpCircle className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-ink sm:text-lg">{t("admin.feedback.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t("admin.feedback.desc")}</p>
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Total Reports */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.feedback.totalReports")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {summary.totalReports}
            </p>
          </div>
        </div>

        {/* Too Hard */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.feedback.tooHardCount")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-amber-700 dark:text-amber-300 sm:text-2xl">
              {summary.tooHardReports}
            </p>
          </div>
        </div>

        {/* Wrong Meaning */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.feedback.wrongMeaningCount")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-rose-700 dark:text-rose-300 sm:text-2xl">
              {summary.wrongMeaningReports}
            </p>
          </div>
        </div>

        {/* Distinct Words */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <BookOpen className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.feedback.distinctWords")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {summary.distinctWords}
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
            void load(1, reasonFilter, statusFilter, search, bookFilter);
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

        <div className="flex flex-wrap items-center gap-2">
          {/* Reason filters */}
          <div className="inline-flex rounded-xl border border-line/80 bg-paper/60 p-1 text-xs">
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 font-semibold transition-colors",
                reasonFilter === "all"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setReasonFilter("all")}
            >
              {t("admin.feedback.filterAll")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 font-semibold transition-colors",
                reasonFilter === "too_hard"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setReasonFilter("too_hard")}
            >
              {t("admin.feedback.reasonTooHard")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 font-semibold transition-colors",
                reasonFilter === "wrong_meaning"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setReasonFilter("wrong_meaning")}
            >
              {t("admin.feedback.reasonWrong")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 font-semibold transition-colors",
                reasonFilter === "missing_meaning"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setReasonFilter("missing_meaning")}
            >
              {t("admin.feedback.reasonMissing")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 font-semibold transition-colors",
                reasonFilter === "suggested"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setReasonFilter("suggested")}
            >
              {t("admin.feedback.reasonSuggested")}
            </button>
          </div>

          {/* Status filters */}
          <div className="inline-flex rounded-xl border border-line/80 bg-paper/60 p-1 text-xs">
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                statusFilter === "all"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setStatusFilter("all")}
            >
              {t("admin.feedback.filterAll")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                statusFilter === "pending"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setStatusFilter("pending")}
            >
              {t("admin.status.pending")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                statusFilter === "resolved"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setStatusFilter("resolved")}
            >
              {t("admin.status.resolved")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                statusFilter === "reopened"
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setStatusFilter("reopened")}
            >
              {t("admin.status.reopened")}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}

      {/* Feedback List */}
      {rows === null || loading ? (
        <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line/80 bg-card p-10 text-center text-muted">
          {t("admin.feedback.empty")}
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const rowKey = `${row.bookId}:${row.word}:${row.chapter}:${row.occurrence}:${row.reason}:${row.senseIndex}`;
            const resolveKey = `${row.bookId}:${row.word}:${row.chapter}:${row.occurrence}:${row.reason}`;
            const isResolving = resolvingKey === resolveKey;
            return (
              <li
                key={rowKey}
                className="grid gap-2.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs transition-shadow hover:shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-display text-base font-bold tracking-tight text-ink sm:text-lg">
                      {row.word}
                    </span>
                    {row.form && row.form !== row.word ? (
                      <span className="text-xs text-muted font-mono">({row.form})</span>
                    ) : null}

                    {/* Status badge */}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide",
                        row.status === "reopened"
                          ? "border border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300"
                          : row.status === "resolved"
                            ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border border-line/80 bg-paper/60 text-muted",
                      )}
                    >
                      {row.status === "reopened"
                        ? `⚠️ ${t("admin.status.reopened")}`
                        : row.status === "resolved"
                          ? t("admin.status.resolved")
                          : t("admin.status.pending")}
                    </span>

                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide",
                        row.reason === "too_hard"
                          ? "border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : row.reason === "missing_meaning"
                            ? "border border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                            : row.reason === "suggested"
                              ? "border border-accent/25 bg-accent-soft text-accent"
                              : "border border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                      )}
                    >
                      {row.reason === "too_hard"
                        ? t("admin.feedback.reasonTooHard")
                        : row.reason === "missing_meaning"
                          ? t("admin.feedback.reasonMissing")
                          : row.reason === "suggested"
                            ? t("admin.feedback.reasonSuggested")
                            : t("admin.feedback.reasonWrong")}
                    </span>

                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide border border-accent/25 bg-accent-soft text-accent",
                      )}
                    >
                      {row.senseIndex >= 0
                        ? t("admin.feedback.senseNumbered", { n: row.senseIndex + 1 })
                        : t("admin.feedback.senseEntry")}
                    </span>

                    {row.bookTitle ? (
                      <span className="font-semibold text-ink text-xs sm:text-sm">
                        {t("admin.taps.bookTitle", { title: row.bookTitle })}
                      </span>
                    ) : null}

                    <span className="rounded-md border border-line/70 bg-line/20 px-2 py-0.5 font-mono text-[11px] text-muted">
                      {row.bookId}
                    </span>

                    <span className="rounded-md border border-accent/25 bg-accent-soft/60 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t("admin.taps.location", { chapter: row.chapter + 1, occurrence: row.occurrence })}
                    </span>

                    {row.chapters > 0 ? (
                      <span className="rounded-md border border-line/70 bg-line/10 px-2 py-0.5 text-[11px] text-muted">
                        {t("admin.taps.chapters", { n: row.chapters })}
                      </span>
                    ) : null}

                    {row.glossaryRev ? (
                      <span className="rounded-md border border-line/70 bg-line/10 px-2 py-0.5 font-mono text-[11px] text-muted">
                        {t("admin.taps.revLabel", { rev: row.glossaryRev })}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3">
                    {row.status !== "resolved" ? (
                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => void handleResolveFeedback(row)}
                        className={cn(
                          btn.quiet,
                          "h-7 min-h-0 px-2.5 text-xs text-accent hover:bg-accent-soft border border-accent/25 font-semibold",
                        )}
                      >
                        <Check className="size-3.5 mr-1 inline" />
                        {isResolving ? t("admin.action.resolving") : t("admin.action.resolve")}
                      </button>
                    ) : (
                      <span className="inline-flex items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="size-3.5 mr-1" />
                        {t("admin.action.resolvedDone")}
                      </span>
                    )}

                    <span className="rounded-full bg-accent-soft px-3 py-1 font-display text-xs font-bold text-accent">
                      {t("admin.feedback.reportCount", { n: row.count })}
                    </span>
                    <span className="text-xs text-muted">
                      {formatShanghaiDate(row.lastReportedAt)}
                    </span>
                  </div>
                </div>

                {row.senseMeaning || row.sentence || row.context ? (
                  <div className="rounded-xl border border-line/50 bg-paper/50 p-2.5 text-xs leading-relaxed space-y-1.5">
                    {row.senseMeaning ? (
                      <p className="text-ink text-xs">
                        <span className="font-semibold text-muted uppercase text-[10px] tracking-wider mr-1">
                          {t("admin.feedback.reportedMeaning")}:
                        </span>
                        <span className="font-medium text-ink italic">“{row.senseMeaning}”</span>
                      </p>
                    ) : null}
                    {row.sentence ? (
                      <p className="font-display text-ink/90 italic">“{row.sentence}”</p>
                    ) : null}
                    {row.context ? (
                      <p className="font-mono text-[11px] text-muted">
                        Anchor context: &quot;{row.context}&quot;
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {row.suggestions.length > 0 ? (
                  <div className="mt-2 rounded-xl bg-accent-soft/60 p-2.5 text-xs leading-relaxed" data-feedback-suggestions>
                    <p className="mb-1 text-[11px] text-muted">{t("admin.feedback.suggestions")}</p>
                    <ul className="grid gap-1">
                      {row.suggestions.map((text, index) => (
                        <li key={index} className="text-ink" lang="en">
                          “{text}”
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
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
