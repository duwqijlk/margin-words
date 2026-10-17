import { useEffect, useState } from "react";
import { useT, type T } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";
import { formatShanghaiDate } from "@/lib/sponsor";
import { btn, cn, field } from "@/components/ui";

type UserRow = {
  id: string;
  email: string;
  nickname: string | null;
  role: "user" | "trusted" | "admin";
  trustedUntil: number | null;
  createdAt: number;
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

/** The users tab: search accounts, grant library access for a chosen length, or revoke it. */
export function UsersAdmin() {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
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

  return (
    <div className="grid gap-5" data-admin-users>
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
