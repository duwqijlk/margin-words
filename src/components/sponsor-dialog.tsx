import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Mail, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT, type Key } from "@/lib/i18n";
import { SPONSOR_EMAIL, isSponsorMethod, sponsorName } from "@/lib/sponsor";
import { EVM_CHAINS, SPONSOR_WALLETS, type SponsorWallet } from "@/lib/sponsor-wallets";
import { accountRequest } from "@/lib/sync-engine";
import { btn, cn, Segmented } from "@/components/ui";

const STEPS = ["thanks.step.send", "thanks.step.email", "thanks.step.register"] as const satisfies readonly Key[];

const ERROR_KEYS: Record<string, Key> = {
  name: "thanks.needNickname",
  method: "thanks.err.network",
  open: "thanks.openExists",
  rate: "thanks.err.rate",
  network: "thanks.err.network",
  unauthorized: "thanks.needSignIn",
};

type OpenRequest = { method: string; displayName: string; emailSent: boolean } | null;

/** One receiving address: what it is for, its QR code and a copy button. */
const WALLET_TEXT = {
  evm: { icon: "/sponsor/ethereum.svg", title: "thanks.wallet.evm", short: "thanks.wallet.evmShort", note: "thanks.wallet.evmNote", qr: "thanks.wallet.qrEvm" },
  solana: { icon: "/sponsor/solana.svg", title: "thanks.wallet.solana", short: "thanks.wallet.solanaShort", note: "thanks.wallet.solanaNote", qr: "thanks.wallet.qrSolana" },
  tron: { icon: "/sponsor/tron.svg", title: "thanks.wallet.tron", short: "thanks.wallet.tronShort", note: "thanks.wallet.tronNote", qr: "thanks.wallet.qrTron" },
} as const satisfies Record<SponsorWallet["id"], { icon: string; title: Key; short: Key; note: Key; qr: Key }>;

function WalletCard({ wallet }: { wallet: SponsorWallet }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const evm = wallet.id === "evm";
  const text = WALLET_TEXT[wallet.id];
  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-paper p-3" data-sponsor-wallet={wallet.id}>
      <div className="flex items-center gap-2">
        <img src={text.icon} alt="" className="size-6" aria-hidden />
        <h3 className="text-base font-semibold">{t(text.title)}</h3>
      </div>
      {evm ? (
        <div className="grid gap-1.5">
          <ul className="flex flex-wrap gap-1.5" aria-label={t("thanks.wallet.evmChains")} data-sponsor-chains>
            {EVM_CHAINS.map((chain) => (
              <li
                key={chain.icon}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-card py-0.5 pr-2 pl-0.5 text-xs leading-5"
                data-sponsor-chain={chain.icon}
              >
                <img src={`/sponsor/${chain.icon}.svg`} alt="" className="size-5" aria-hidden />
                <span lang="en">{chain.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted">{t("thanks.wallet.evmNote")}</p>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">{t(text.note)}</p>
      )}
      <div className="grid justify-items-center gap-3 sm:grid-cols-[auto_1fr] sm:items-center sm:justify-items-stretch">
        {/* The QR code holds the address text only. It is drawn black on white so every wallet camera reads it. */}
        <img
          src={wallet.qr}
          alt={t(text.qr)}
          className="size-36 rounded-lg bg-white p-1"
          data-sponsor-qr={wallet.id}
        />
        <div className="grid w-full min-w-0 gap-2">
          <code
            className="rounded-lg border border-line bg-card px-2.5 py-2 font-mono text-[0.8rem] leading-5 break-all select-all"
            data-sponsor-address={wallet.id}
          >
            {wallet.address}
          </code>
          <button type="button" className={cn(btn.quiet, "min-h-10 w-full text-sm")} onClick={() => void copy()} data-sponsor-copy={wallet.id}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? t("thanks.wallet.copied") : t("thanks.wallet.copy")}
          </button>
        </div>
      </div>
    </section>
  );
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const [sent, setSent] = useState(false);
  const [existing, setExisting] = useState<OpenRequest>(null);
  // One address on screen at a time. Two QR codes side by side invite a scan of the wrong one.
  const [walletId, setWalletId] = useState<SponsorWallet["id"]>("evm");
  const wallet = SPONSOR_WALLETS.find((item) => item.id === walletId) ?? SPONSOR_WALLETS[0];

  useEffect(() => {
    if (!open) return;
    setWalletId("evm");
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
    if (!shownName) {
      setError("thanks.needNickname");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountRequest("/api/sponsorships", { method: "crypto" });
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-pop glass"
          data-sponsor-dialog
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl font-semibold">{t("thanks.dialogTitle")}</Dialog.Title>
            <Dialog.Close className={btn.icon} aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="-mt-2 text-sm leading-6 text-muted">{t("thanks.gift")}</Dialog.Description>
          <div className="grid gap-1.5" data-sponsor-network-pick>
            <p className="text-sm font-semibold">{t("thanks.wallet.pick")}</p>
            <Segmented
              label={t("thanks.wallet.pick")}
              value={walletId}
              onChange={setWalletId}
              options={SPONSOR_WALLETS.map((item) => ({
                value: item.id,
                label: (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <img src={WALLET_TEXT[item.id].icon} alt="" className="size-4" aria-hidden />
                    {t(WALLET_TEXT[item.id].short)}
                  </span>
                ),
              }))}
            />
          </div>
          {/* key: switching remounts the card, so a "Copied" label never carries over to the other address. */}
          <WalletCard key={wallet.id} wallet={wallet} />
          <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs leading-5" data-sponsor-warning>
            {t("thanks.wallet.warning")}
          </p>
          <ol className="grid gap-2" aria-label={t("thanks.steps")}>
            {STEPS.map((key, index) => (
              <li key={key} className="flex items-start gap-3 text-[0.95rem] leading-6">
                <span
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.7rem] font-semibold text-accent tabular-nums"
                  aria-hidden
                >
                  {index + 1}
                </span>
                {t(key, { email: SPONSOR_EMAIL })}
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
