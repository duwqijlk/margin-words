import { useEffect, useState } from "react";
import { useT, type T } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";
import { formatShanghaiDate } from "@/lib/sponsor";
import { btn, cn, field } from "@/components/ui";
import { BarChart2, Calendar, TrendingUp, UserPlus, Users } from "lucide-react";

type UserRow = {
  id: string;
  email: string;
  nickname: string | null;
  role: "user" | "trusted" | "admin";
  trustedUntil: number | null;
  createdAt: number;
};

type DailyStat = {
  day: string;
  count: number;
};

const TERMS = ["week", "month", "quarter", "year", "forever"] as const;
type TrustTerm = (typeof TERMS)[number];

const TERM_KEY = {
  week: "admin.users.week",
  month: "admin.users.month",
  quarter: "admin.users.quarter",
  year: "admin.users.year",
  forever: "admin.users.forever",
} as const;

function trustLabel(row: UserRow, t: T["t"]): string {
  if (row.trustedUntil == null) return t("admin.users.forever");
  if (row.trustedUntil <= Date.now()) return t("admin.users.expired");
  return t("admin.users.until", { date: formatShanghaiDate(row.trustedUntil) });
}

const ROLE_KEY = {
  admin: "admin.users.roleAdmin",
  trusted: "admin.users.roleTrusted",
  user: "admin.users.roleUser",
} as const;

function readUsers(value: unknown): UserRow[] {
  if (!Array.isArray(value)) return [];
  const out: UserRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<UserRow>;
    if (typeof row.id !== "string" || typeof row.email !== "string") continue;
    out.push({
      id: row.id,
      email: row.email,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      role: row.role === "trusted" || row.role === "admin" ? row.role : "user",
      trustedUntil: typeof row.trustedUntil === "number" ? row.trustedUntil : null,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    });
  }
  return out;
}

function readDaily(value: unknown): DailyStat[] {
  if (!Array.isArray(value)) return [];
  const out: DailyStat[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<DailyStat>;
    if (typeof row.day !== "string" || typeof row.count !== "number") continue;
    out.push({ day: row.day, count: row.count });
  }
  return out;
}

function fillDailySeries(raw: DailyStat[], daysCount: number): DailyStat[] {
  const map = new Map<string, number>();
  for (const item of raw) {
    map.set(item.day, item.count);
  }

  const now = Date.now();
  const SHANGHAI_MS = 8 * 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const result: DailyStat[] = [];

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now + SHANGHAI_MS - i * ONE_DAY_MS);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    result.push({
      day: key,
      count: map.get(key) ?? 0,
    });
  }
  return result;
}

/** The users tab: search accounts, grant library access for a chosen length, or revoke it. */
export function UsersAdmin() {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [range, setRange] = useState<14 | 30>(14);
  const [hoveredDay, setHoveredDay] = useState<DailyStat | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState<TrustTerm>("month");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load(nextQuery: string, nextPage: number) {
    setError("");
    try {
      const payload = await accountRequest(
        `/api/admin/users?q=${encodeURIComponent(nextQuery)}&page=${nextPage}`,
      );
      setRows(readUsers(payload.users));
      if (Array.isArray(payload.daily)) {
        setDaily(readDaily(payload.daily));
      }
      setTotal(typeof payload.total === "number" ? payload.total : 0);
      setPage(nextPage);
    } catch {
      setError(t("admin.users.error"));
      setRows([]);
    }
  }

  useEffect(() => {
    void load("", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setRole(row: UserRow, role: "trusted" | "user") {
    setBusy(row.id);
    setError("");
    try {
      const payload = await accountRequest("/api/admin/users", {
        id: row.id,
        role,
        ...(role === "trusted" ? { term } : {}),
      });
      const updated = readUsers([payload.user])[0];
      setRows((current) =>
        current ? current.map((item) => (item.id === row.id ? (updated ?? item) : item)) : current,
      );
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(t(code === "admin-locked" ? "admin.users.locked" : "admin.users.error"));
    } finally {
      setBusy("");
    }
  }

  const pages = Math.max(1, Math.ceil(total / 20));

  const series30 = fillDailySeries(daily, 30);
  const series = range === 14 ? series30.slice(-14) : series30;
  const todayCount = series30[series30.length - 1]?.count ?? 0;
  const last7Count = series30.slice(-7).reduce((acc, c) => acc + c.count, 0);
  const last30Count = series30.reduce((acc, c) => acc + c.count, 0);
  const maxCount = Math.max(1, ...series.map((s) => s.count));

  return (
    <div className="grid gap-5" data-admin-users>
      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Today */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <UserPlus className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.users.today")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {todayCount}
            </p>
          </div>
        </div>

        {/* Last 7 Days */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <TrendingUp className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.users.last7Days")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {last7Count}
            </p>
          </div>
        </div>

        {/* Last 30 Days */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <Calendar className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.users.last30Days")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {last30Count}
            </p>
          </div>
        </div>

        {/* Total Users */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Users className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{t("admin.users.total")}</p>
            <p className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {total}
            </p>
          </div>
        </div>
      </div>

      {/* Daily Registrations Chart */}
      <div className="rounded-2xl border border-line/80 bg-card p-5 shadow-2xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <BarChart2 className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">{t("admin.users.dailyTitle")}</h3>
              <p className="text-[11px] text-muted">
                {range === 14 ? t("admin.users.range14") : t("admin.users.range30")}
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl border border-line/80 bg-paper/60 p-1 text-xs">
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                range === 14
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setRange(14)}
            >
              {t("admin.users.range14")}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition-colors",
                range === 30
                  ? "bg-card text-ink shadow-2xs"
                  : "text-muted hover:text-ink",
              )}
              onClick={() => setRange(30)}
            >
              {t("admin.users.range30")}
            </button>
          </div>
        </div>

        {/* Visual Chart Bars */}
        <div className="relative pt-6">
          <div className="flex h-36 items-end gap-1 sm:h-44 sm:gap-2">
            {series.map((item, idx) => {
              const isToday = idx === series.length - 1;
              const heightPct = Math.max(6, Math.round((item.count / maxCount) * 100));
              const isHovered = hoveredDay?.day === item.day;
              return (
                <div
                  key={item.day}
                  className="group relative flex h-full flex-1 flex-col items-center justify-end"
                  onMouseEnter={() => setHoveredDay(item)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  {/* Tooltip on hover */}
                  <div
                    className={cn(
                      "pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-[11px] font-medium text-paper shadow-md transition-opacity duration-150",
                      isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <span className="font-mono">{item.day}</span>
                    <span className="mx-1">·</span>
                    <span className="font-semibold">
                      {t("admin.users.registeredCount", { n: item.count })}
                    </span>
                  </div>

                  {/* Top count label if > 0 */}
                  {item.count > 0 ? (
                    <span
                      className={cn(
                        "mb-1 text-[10px] font-bold text-muted transition-colors group-hover:text-accent sm:text-[11px]",
                        range === 30 && idx % 2 !== 0 && !isToday && !isHovered
                          ? "hidden sm:inline"
                          : "inline",
                      )}
                    >
                      {item.count}
                    </span>
                  ) : null}

                  {/* Bar */}
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={cn(
                      "w-full max-w-[24px] rounded-t-md transition-all duration-200",
                      isToday
                        ? "bg-accent shadow-sm shadow-accent/25 hover:brightness-110"
                        : item.count > 0
                          ? "bg-accent/70 hover:bg-accent"
                          : "bg-line/40 hover:bg-line/70",
                    )}
                  />

                  {/* Date label */}
                  <div className="mt-2 h-4 text-center text-[10px] text-muted">
                    {range === 30 && idx % 3 !== 0 && !isToday ? null : (
                      <span className="whitespace-nowrap">{item.day.slice(5)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query.trim(), 1);
          }}
        >
          <input
            className={cn(field, "min-w-0 flex-1 text-sm")}
            type="search"
            value={query}
            placeholder={t("admin.users.search")}
            aria-label={t("admin.users.search")}
            data-admin-users-search
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className={cn(btn.primary, "px-4 text-xs font-semibold")}>
            {t("admin.users.find")}
          </button>
        </form>

        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className="shrink-0">{t("admin.users.term")}:</span>
          <select
            className={cn(field, "h-10 min-h-0 w-auto py-1 pl-3 pr-8 text-xs font-semibold")}
            value={term}
            data-admin-trust-term
            aria-label={t("admin.users.term")}
            onChange={(event) => setTerm(event.target.value as TrustTerm)}
          >
            {TERMS.map((item) => (
              <option key={item} value={item}>
                {t(TERM_KEY[item])}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line/80 bg-card p-10 text-center text-muted">
          {t("admin.users.empty")}
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const initial = (row.nickname || row.email || "?").trim().slice(0, 1).toUpperCase();
            return (
              <li
                key={row.id}
                className="grid gap-3 rounded-2xl border border-line/80 bg-card p-4 shadow-2xs transition-shadow hover:shadow-xs sm:p-4.5"
                data-admin-user={row.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent shadow-2xs">
                      {initial}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-ink">{row.email}</p>
                        {row.nickname ? (
                          <span className="text-xs text-muted">({row.nickname})</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-bold tracking-wide uppercase",
                            row.role === "admin"
                              ? "border border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                              : row.role === "trusted"
                                ? "border border-accent/25 bg-accent-soft text-accent"
                                : "border border-line/80 bg-line/40 text-muted",
                          )}
                        >
                          {t(ROLE_KEY[row.role])}
                        </span>
                        {row.role === "trusted" ? (
                          <span className="text-xs text-muted">· {trustLabel(row, t)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted">{formatShanghaiDate(row.createdAt)}</span>

                    {row.role === "admin" ? null : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={cn(btn.primary, "h-9 min-h-0 px-3 text-xs")}
                          disabled={busy === row.id}
                          data-admin-user-role={row.role}
                          onClick={() => void setRole(row, "trusted")}
                        >
                          {busy === row.id
                            ? t("account.working")
                            : row.role === "trusted"
                              ? t("admin.users.update")
                              : t("admin.users.grant")}
                        </button>
                        {row.role === "trusted" ? (
                          <button
                            type="button"
                            className={cn(btn.quiet, "h-9 min-h-0 px-2.5 text-xs")}
                            disabled={busy === row.id}
                            onClick={() => void setRole(row, "user")}
                          >
                            {t("admin.users.revoke")}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between rounded-xl border border-line/60 bg-card p-3 text-xs font-semibold">
          <button
            type="button"
            className={cn(btn.quiet, "h-8 min-h-0 px-3 text-xs")}
            disabled={page <= 1}
            onClick={() => void load(query.trim(), page - 1)}
          >
            {t("admin.users.prev")}
          </button>
          <p className="text-muted">
            {page} / {pages}
          </p>
          <button
            type="button"
            className={cn(btn.quiet, "h-8 min-h-0 px-3 text-xs")}
            disabled={page >= pages}
            onClick={() => void load(query.trim(), page + 1)}
          >
            {t("admin.users.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
