import { useEffect, useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { formatShanghaiDate, formatSponsorUsd, isSponsorMethod, parseUsdToCents, type SponsorMethod } from "@/lib/sponsor";
import { accountRequest } from "@/lib/sync-engine";
import { btn, cn, field } from "@/components/ui";

type RequestRow = {
  id: string;
  email: string;
  displayName: string;
  method: string;
  createdAt: number;
  emailSentAt: number | null;
  amountCents: number | null;
  listedAt: number | null;
  closedAt: number | null;
};

function readRows(value: unknown): RequestRow[] {
  if (!Array.isArray(value)) return [];
  const out: RequestRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RequestRow>;
    if (typeof row.id !== "string" || typeof row.email !== "string" || typeof row.displayName !== "string") continue;
    if (typeof row.createdAt !== "number") continue;
    out.push({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      method: typeof row.method === "string" ? row.method : "",
      createdAt: row.createdAt,
      emailSentAt: typeof row.emailSentAt === "number" ? row.emailSentAt : null,
      amountCents: typeof row.amountCents === "number" ? row.amountCents : null,
      listedAt: typeof row.listedAt === "number" ? row.listedAt : null,
      closedAt: typeof row.closedAt === "number" ? row.closedAt : null,
    });
  }
  return out;
}

const METHOD_KEY = {
  wechat: "thanks.method.wechat",
  alipay: "thanks.method.alipay",
  crypto: "thanks.method.crypto",
} as const satisfies Record<SponsorMethod, Key>;

function methodLabel(method: string, t: (key: Key) => string): string {
  return isSponsorMethod(method) ? t(METHOD_KEY[method]) : method;
}

/** The gift-request tab on the admin page. The page itself checks the role. */
export function SponsorTab() {
  const { t } = useT();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<Key | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let alive = true;
    void accountRequest("/api/admin/sponsorships")
      .then((payload) => {
        if (alive) setRows(readRows(payload.requests));
      })
      .catch(() => {
        if (alive) setError("admin.error");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function act(id: string, action: "email" | "list" | "close", amount?: string) {
    setBusy(id);
    setError(null);
    try {
      await accountRequest("/api/admin/sponsorships", { id, action, amount });
      const payload = await accountRequest("/api/admin/sponsorships");
      setRows(readRows(payload.requests));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(code === "amount" ? "admin.amountBad" : "admin.error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-4" data-sponsor-admin>
      {error && rows === null ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-4 text-sm text-warn" role="alert">{t(error)}</p>
      ) : rows === null ? (
        <p className="py-8 text-center text-muted">{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line/80 bg-card p-10 text-center text-muted" data-sponsor-admin-empty>
          {t("admin.empty")}
        </div>
      ) : (
        <ul className="grid gap-3.5">
          {rows.map((row) => {
            const listed = row.listedAt != null;
            const closed = row.closedAt != null;
            const amount = amounts[row.id] ?? "";
            const initial = (row.displayName || row.email || "?").trim().slice(0, 1).toUpperCase();
            return (
              <li
                key={row.id}
                className="grid gap-3 rounded-2xl border border-line/80 bg-card p-4.5 shadow-2xs transition-shadow hover:shadow-xs sm:p-5"
                data-sponsor-request={row.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent shadow-2xs">
                      {initial}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-lg font-bold text-ink">{row.displayName}</p>
                        <span className="rounded-md border border-line/70 bg-line/30 px-2 py-0.5 text-xs font-medium text-muted">
                          {methodLabel(row.method, t)}
                        </span>
                      </div>
                      <p className="text-xs text-muted/80">{row.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">{formatShanghaiDate(row.createdAt)}</span>
                    {listed && row.amountCents ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent"
                        data-sponsor-listed
                      >
                        {t("admin.listed")} · {t("thanks.amount", { amount: formatSponsorUsd(row.amountCents) })}
                      </span>
                    ) : closed ? (
                      <span className="inline-flex items-center rounded-full border border-line/80 bg-line/40 px-2.5 py-0.5 text-xs font-medium text-muted">
                        {t("admin.closed")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        {row.emailSentAt ? t("admin.sent") : t("admin.pending")}
                      </span>
                    )}
                  </div>
                </div>

                {!listed && !closed ? (
                  <div className="flex flex-wrap items-center gap-2.5 border-t border-line/50 pt-3">
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line/70 bg-paper/50 px-3 text-xs font-semibold text-ink transition-colors hover:border-accent/40 hover:bg-card">
                      <input
                        type="checkbox"
                        className="size-4 rounded accent-accent"
                        checked={row.emailSentAt != null}
                        disabled={row.emailSentAt != null || busy === row.id}
                        data-sponsor-email-sent
                        onChange={() => void act(row.id, "email")}
                      />
                      {t("admin.sent")}
                    </label>

                    <div className="relative inline-flex items-center">
                      <span className="pointer-events-none absolute left-3 text-xs font-bold text-muted">$</span>
                      <input
                        className={cn(field, "h-10 min-h-0 w-28 pl-6.5 text-xs font-semibold")}
                        inputMode="decimal"
                        value={amount}
                        placeholder={t("admin.amount")}
                        aria-label={t("admin.amount")}
                        data-sponsor-amount
                        onChange={(event) => setAmounts((current) => ({ ...current, [row.id]: event.target.value }))}
                      />
                    </div>

                    <button
                      type="button"
                      className={cn(btn.primary, "h-10 min-h-0 px-3.5 text-xs")}
                      disabled={busy === row.id || parseUsdToCents(amount) == null}
                      data-sponsor-list
                      onClick={() => void act(row.id, "list", amount)}
                    >
                      {t("admin.list")}
                    </button>
                    <button
                      type="button"
                      className={cn(btn.quiet, "h-10 min-h-0 px-3 text-xs")}
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "close")}
                    >
                      {t("admin.close")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error && rows ? (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/40 p-3 text-xs text-warn" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
