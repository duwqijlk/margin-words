import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";
import { formatShanghaiDate } from "@/lib/sponsor";
import { btn, cn, field } from "@/components/ui";

type UserRow = {
  id: string;
  email: string;
  nickname: string | null;
  role: "user" | "trusted" | "admin";
  createdAt: number;
};

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
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    });
  }
  return out;
}

/** The users tab: search accounts, grant or revoke private-library access. */
export function UsersAdmin() {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
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
      const payload = await accountRequest("/api/admin/users", { id: row.id, role });
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
                </p>
                {row.role === "admin" ? null : (
                  <button
                    type="button"
                    className={row.role === "trusted" ? btn.quiet : btn.primary}
                    disabled={busy === row.id}
                    data-admin-user-role={row.role}
                    onClick={() => void setRole(row, row.role === "trusted" ? "user" : "trusted")}
                  >
                    {busy === row.id
                      ? t("account.working")
                      : row.role === "trusted"
                        ? t("admin.users.revoke")
                        : t("admin.users.grant")}
                  </button>
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
