import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT, type Key } from "@/lib/i18n";
import { SPONSOR_EMAIL, SPONSOR_METHODS, isSponsorMethod, sponsorName, type SponsorMethod } from "@/lib/sponsor";
import { accountRequest } from "@/lib/sync-engine";
import { btn, cn, Segmented } from "@/components/ui";

const METHOD_KEY = {
  wechat: "thanks.method.wechat",
  alipay: "thanks.method.alipay",
  crypto: "thanks.method.crypto",
} as const satisfies Record<SponsorMethod, Key>;

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
          <p className="text-[0.95rem] leading-7 font-semibold">{t("thanks.gift")}</p>
          <p className="text-[0.95rem] leading-7 text-muted">{t("thanks.dialogBody")}</p>
          <p className="text-[0.95rem] leading-7" data-sponsor-email>
            {t("thanks.official", { email: SPONSOR_EMAIL })}
          </p>
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
              {shownName ? (
                <p className="text-[0.95rem] leading-7" data-sponsor-name>
                  {t("thanks.usesNickname", { name: shownName })}
                </p>
              ) : null}
              <Segmented<SponsorMethod | "">
                label={t("thanks.method")}
                layout="wrap"
                value={method}
                onChange={setMethod}
                options={SPONSOR_METHODS.map((item) => ({
                  value: item,
                  label: t(METHOD_KEY[item]),
                }))}
              />
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
