import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT, type Key } from "@/lib/i18n";
import { formatShanghaiDate, formatSponsorUsd, isSponsorAdmin, isSponsorMethod, parseUsdToCents, type SponsorMethod } from "@/lib/sponsor";
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

/** The admin list of sponsorship requests. Anyone else sees a short refusal. */
export function SponsorAdmin() {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const email = useAccount((state) => state.email);
  const admin = phase === "in" && isSponsorAdmin(email);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<Key | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!admin) return;
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
  }, [admin]);

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
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-6 sm:py-10" data-sponsor-admin>
      <h1 className="font-display text-3xl font-semibold">{t("admin.title")}</h1>
      {phase === "unknown" ? (
        <p>{t("dashboard.loading")}</p>
      ) : phase !== "in" ? (
        <div className="grid justify-items-start gap-3">
          <p>{t("admin.only")}</p>
          <button type="button" className={btn.primary} onClick={() => askToSignIn()}>
            {t("admin.signIn")}
          </button>
        </div>
      ) : !admin ? (
        <p>{t("admin.only")}</p>
      ) : error && rows === null ? (
        <p role="alert">{t(error)}</p>
      ) : rows === null ? (
        <p>{t("dashboard.loading")}</p>
      ) : rows.length === 0 ? (
        <p data-sponsor-admin-empty>{t("admin.empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const listed = row.listedAt != null;
            const closed = row.closedAt != null;
            const amount = amounts[row.id] ?? "";
            return (
              <li key={row.id} className="grid gap-2 rounded-2xl border border-line bg-card p-4" data-sponsor-request={row.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-xl font-semibold">{row.displayName}</p>
                  <p className="text-sm text-muted">{formatShanghaiDate(row.createdAt)}</p>
                </div>
                <p className="text-sm">
                  {row.email} · {methodLabel(row.method, t)}
                </p>
                {listed && row.amountCents ? (
                  <p className="text-sm font-semibold" data-sponsor-listed>
                    {t("admin.listed")} · {t("thanks.amount", { amount: formatSponsorUsd(row.amountCents) })}
                  </p>
                ) : closed ? (
                  <p className="text-sm text-muted">{t("admin.closed")}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={row.emailSentAt != null}
                        disabled={row.emailSentAt != null || busy === row.id}
                        data-sponsor-email-sent
                        onChange={() => void act(row.id, "email")}
                      />
                      {t("admin.sent")}
                    </label>
                    <input
                      className={cn(field, "w-28")}
                      inputMode="decimal"
                      value={amount}
                      placeholder={t("admin.amount")}
                      aria-label={t("admin.amount")}
                      data-sponsor-amount
                      onChange={(event) => setAmounts((current) => ({ ...current, [row.id]: event.target.value }))}
                    />
                    <button
                      type="button"
                      className={btn.primary}
                      disabled={busy === row.id || parseUsdToCents(amount) == null}
                      data-sponsor-list
                      onClick={() => void act(row.id, "list", amount)}
                    >
                      {t("admin.list")}
                    </button>
                    <button
                      type="button"
                      className={btn.quiet}
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "close")}
                    >
                      {t("admin.close")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && rows ? (
        <p className="text-sm text-warn" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
