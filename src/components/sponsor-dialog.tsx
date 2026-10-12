import * as Dialog from "@radix-ui/react-dialog";
import { Bitcoin, Check, Mail, MessageCircle, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT, type Key } from "@/lib/i18n";
import { SPONSOR_EMAIL, SPONSOR_METHODS, isSponsorMethod, sponsorName, type SponsorMethod } from "@/lib/sponsor";
import { accountRequest } from "@/lib/sync-engine";
import { btn, cn } from "@/components/ui";

const METHOD_KEY = {
  wechat: "thanks.method.wechat",
  alipay: "thanks.method.alipay",
  crypto: "thanks.method.crypto",
} as const satisfies Record<SponsorMethod, Key>;

const METHOD_ICON: Record<SponsorMethod, LucideIcon> = {
  wechat: MessageCircle,
  alipay: Wallet,
  crypto: Bitcoin,
};

const STEPS = ["thanks.step.choose", "thanks.step.email", "thanks.step.amount"] as const satisfies readonly Key[];

const ERROR_KEYS: Record<string, Key> = {
  name: "thanks.needNickname",
  method: "thanks.err.method",
  open: "thanks.openExists",
  rate: "thanks.err.rate",
  network: "thanks.err.network",
  unauthorized: "thanks.needSignIn",
};

type OpenRequest = { method: string; displayName: string; emailSent: boolean } | null;

export function SponsorDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const nickname = useAccount((state) => state.nickname);
  const signedIn = phase === "in";
  const shownName = sponsorName(nickname);
  const [method, setMethod] = useState<SponsorMethod | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const [sent, setSent] = useState(false);
  const [existing, setExisting] = useState<OpenRequest>(null);

  useEffect(() => {
    if (!open) return;
    setMethod("");
    setError(null);
    setSent(false);
    setExisting(null);
    if (!signedIn) return;
    let alive = true;
    void accountRequest("/api/sponsorship-request")
      .then((payload) => {
        if (!alive) return;
        const row = payload.open;
        if (!row || typeof row !== "object") return;
        const item = row as { method?: unknown; displayName?: unknown; emailSent?: unknown };
        if (!isSponsorMethod(item.method) || typeof item.displayName !== "string") return;
        setExisting({ method: item.method, displayName: item.displayName, emailSent: item.emailSent === true });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, signedIn, nickname]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!signedIn) {
      onOpenChange(false);
      askToSignIn();
      return;
    }
    if (!method) {
      setError("thanks.err.method");
      return;
    }
    if (!shownName) {
      setError("thanks.needNickname");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountRequest("/api/sponsorships", { method });
      setSent(true);
      onSubmitted();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(ERROR_KEYS[code] ?? "thanks.err.network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[min(40rem,calc(100dvh-2rem))] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-pop"
          data-sponsor-dialog
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl font-semibold">{t("thanks.dialogTitle")}</Dialog.Title>
            <Dialog.Close className={btn.icon} aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <p className="-mt-2 text-sm leading-6 text-muted">{t("thanks.gift")}</p>
          <ol className="grid gap-2" aria-label={t("thanks.steps")}>
            {STEPS.map((key, index) => (
              <li key={key} className="flex items-start gap-3 text-[0.95rem] leading-6">
                <span
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.7rem] font-semibold text-accent tabular-nums"
                  aria-hidden
                >
                  {index + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
          <div className="flex items-start gap-3 rounded-lg bg-paper px-3 py-2.5" data-sponsor-email>
            <Mail className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
            <div className="grid min-w-0 gap-0.5">
              <p className="text-sm leading-6 break-all">{t("thanks.official", { email: SPONSOR_EMAIL })}</p>
              <p className="text-xs leading-5 text-muted">{t("thanks.officialOnly")}</p>
            </div>
          </div>
          {sent ? (
            <p className="text-[0.95rem] leading-7" data-sponsor-sent>
              {t("thanks.sentBody", { email: SPONSOR_EMAIL })}
            </p>
          ) : existing ? (
            <p className="text-[0.95rem] leading-7" data-sponsor-pending>
              {existing.emailSent ? t("thanks.emailed") : t("thanks.pending")}
            </p>
          ) : signedIn && !shownName ? (
            <div className="grid gap-3">
              <p className="text-[0.95rem] leading-7">{t("thanks.needNickname")}</p>
              <button
                type="button"
                className={cn(btn.primary, "w-full")}
                data-sponsor-nickname
                onClick={() => {
                  onOpenChange(false);
                  useAccount.getState().patch({ dialogOpen: true, nicknamePrompt: true });
                }}
              >
                {t("thanks.setNickname")}
              </button>
            </div>
          ) : (
            <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
              {signedIn ? null : <p className="text-[0.95rem] leading-7">{t("thanks.needSignIn")}</p>}
              <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("thanks.method")} data-sponsor-methods>
                {SPONSOR_METHODS.map((item) => {
                  const Icon = METHOD_ICON[item];
                  const chosen = method === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => {
                        setMethod(item);
                        setError(null);
                      }}
                      className={cn(
                        "relative grid min-h-20 justify-items-center content-center gap-1.5 rounded-lg border px-1 py-3 text-sm font-semibold transition-colors",
                        chosen
                          ? "border-accent bg-accent-soft text-accent ring-1 ring-accent"
                          : "border-line bg-card text-ink hover:border-accent/50 hover:bg-paper",
                      )}
                      data-sponsor-method={item}
                    >
                      {chosen ? (
                        <Check className="absolute top-1.5 right-1.5 size-3.5" strokeWidth={2.5} aria-hidden />
                      ) : null}
                      <Icon className="size-5" strokeWidth={1.5} aria-hidden />
                      <span className="leading-5">{t(METHOD_KEY[item])}</span>
                    </button>
                  );
                })}
              </div>
              {shownName ? (
                <p className="text-sm leading-6 text-muted" data-sponsor-name>
                  {t("thanks.usesNickname", { name: shownName })}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-warn" role="alert">
                  {t(error)}
                </p>
              ) : null}
              <button type="submit" className={cn(btn.primary, "w-full")} disabled={busy} data-sponsor-submit>
                {signedIn ? t("thanks.submit") : t("thanks.signIn")}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
