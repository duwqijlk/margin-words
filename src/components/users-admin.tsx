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
    <div className="grid gap-4" data-admin-users>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query.trim(), 1);
        }}
      >
        <input
          className={cn(field, "min-w-0 flex-1")}
          type="search"
          value={query}
          placeholder={t("admin.users.search")}
          aria-label={t("admin.users.search")}
          data-admin-users-search
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className={btn.primary}>
          {t("admin.users.find")}
        </button>
      </form>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        {t("admin.users.term")}
        <select
          className={cn(field, "w-auto")}
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
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? (
        <p>{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <p>{t("admin.users.empty")}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-xl border border-line bg-card p-3" data-admin-user={row.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{row.email}</p>
                <p className="text-xs text-muted">{formatShanghaiDate(row.createdAt)}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  {row.nickname ? `${row.nickname} · ` : ""}
                  {t(ROLE_KEY[row.role])}
                  {row.role === "trusted" ? ` · ${trustLabel(row, t)}` : ""}
                </p>
                {row.role === "admin" ? null : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btn.primary}
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
                        className={btn.quiet}
                        disabled={busy === row.id}
                        onClick={() => void setRole(row, "user")}
                      >
                        {t("admin.users.revoke")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <button type="button" className={btn.quiet} disabled={page <= 1} onClick={() => void load(query.trim(), page - 1)}>
            {t("admin.users.prev")}
          </button>
          <p className="text-muted">
            {page} / {pages}
          </p>
          <button
            type="button"
            className={btn.quiet}
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
