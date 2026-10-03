import * as Dialog from "@radix-ui/react-dialog";
import { UserRound, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAccount, type AccountMode, type SyncStatus } from "@/lib/account-store";
import {
  confirmPasswordReset,
  deleteAccount,
  exportAccount,
  signIn,
  signOut,
  signUp,
} from "@/lib/sync-engine";
import { useT, type Key } from "@/lib/i18n";
import { btn, cn, field, Segmented } from "@/components/ui";

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

const ERROR_KEYS: Record<string, Key> = {
  email: "account.err.email",
  password: "account.err.password",
  "email-taken": "account.err.emailTaken",
  credentials: "account.err.credentials",
  rate: "account.err.rate",
  turnstile: "account.err.turnstile",
  network: "account.err.network",
};

function errorKey(error: unknown): Key {
  const code = error instanceof Error ? error.message : "";
  return ERROR_KEYS[code] ?? "account.err.generic";
}

function syncLabel(status: SyncStatus, t: (key: Key) => string): string {
  if (status === "saving") return t("account.syncSaving");
  if (status === "offline") return t("account.syncOffline");
  if (status === "error") return t("account.syncError");
  if (status === "saved") return t("account.syncSaved");
  return "";
}

function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  useEffect(() => {
    if (!SITE_KEY) return;
    const holder = document.getElementById("mw-turnstile");
    if (!holder) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !holder) return;
      window.turnstile?.render(holder, { sitekey: SITE_KEY, callback: onToken });
    };
    if (window.turnstile) {
      render();
      return () => {
        cancelled = true;
      };
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [onToken]);
  if (!SITE_KEY) return null;
  return <div id="mw-turnstile" className="min-h-16" data-turnstile />;
}

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => void;
    };
  }
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  show,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  show: boolean;
  onToggle: () => void;
}) {
  const { t } = useT();
  return (
    <label className="grid gap-1 text-sm font-medium" htmlFor={id}>
      {label}
      <span className="flex gap-2">
        <input
          id={id}
          className={cn(field, "min-w-0 flex-1")}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          data-account-password={id}
        />
        <button type="button" className={cn(btn.quiet, "shrink-0 px-3")} onClick={onToggle}>
          {show ? t("account.hidePassword") : t("account.showPassword")}
        </button>
      </span>
    </label>
  );
}

/** Sign in, create an account, or manage the one already in use. */
export function AccountDialog() {
  const { t } = useT();
  const open = useAccount((state) => state.dialogOpen);
  const mode = useAccount((state) => state.mode);
  const resetToken = useAccount((state) => state.resetToken);
  const phase = useAccount((state) => state.phase);
  const emailSaved = useAccount((state) => state.email);
  const sync = useAccount((state) => state.sync);
  const closeDialog = useAccount((state) => state.closeDialog);
  const openDialog = useAccount((state) => state.openDialog);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [forgot, setForgot] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setAgain("");
    setShow(false);
    setProblem("");
    setNote("");
    setForgot(false);
    setDeleting(false);
    setBusy(false);
    if (emailSaved) setEmail(emailSaved);
  }, [open, emailSaved]);

  function setMode(next: AccountMode) {
    setProblem("");
    setNote("");
    openDialog(next, resetToken);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setProblem("");
    setNote("");
    const address = email.trim().toLowerCase();
    if (mode !== "reset" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setProblem(t("account.err.email"));
      return;
    }
    if (password.length < 8) {
      setProblem(t("account.err.password"));
      return;
    }
    if ((mode === "register" || mode === "reset") && password !== again) {
      setProblem(t("account.err.passwordMatch"));
      return;
    }
    if (mode === "register" && SITE_KEY && !turnstileToken) {
      setProblem(t("account.err.turnstile"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "reset") {
        await confirmPasswordReset(resetToken, password);
        setNote(t("account.resetDone"));
        openDialog("login");
        setPassword("");
        setAgain("");
      } else if (mode === "register") {
        await signUp(address, password, turnstileToken);
        closeDialog();
      } else {
        await signIn(address, password);
        closeDialog();
      }
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    setProblem("");
    setBusy(true);
    try {
      await exportAccount();
      setNote(t("account.exportDone"));
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length < 8) {
      setProblem(t("account.err.password"));
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      await deleteAccount(password);
      closeDialog();
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = phase === "in" && emailSaved && mode !== "reset";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? openDialog(mode, resetToken) : closeDialog())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-pop sm:p-6"
          data-account-dialog
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl font-semibold">
              {mode === "reset" ? t("account.resetTitle") : t("account.title")}
            </Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted">
            {signedIn ? t("account.signedDesc") : t("account.desc")}
          </Dialog.Description>

          {signedIn ? (
            <div className="mt-5 grid gap-4">
              <p className="text-sm font-semibold" data-account-signed-in>
                {t("account.signedIn", { email: emailSaved })}
              </p>
              {syncLabel(sync, t) ? (
                <p className="text-sm text-muted" data-account-sync>
                  {syncLabel(sync, t)}
                </p>
              ) : null}
              <section className="grid gap-1 rounded-xl border border-line px-4 py-3" data-account-privacy>
                <h3 className="text-sm font-semibold">{t("account.privacyTitle")}</h3>
                <p className="text-xs text-muted">{t("account.privacy")}</p>
              </section>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={btn.quiet} onClick={() => void onExport()} disabled={busy}>
                  {t("account.export")}
                </button>
                <button
                  type="button"
                  className={btn.quiet}
                  onClick={() => {
                    setBusy(true);
                    void signOut().finally(() => {
                      setBusy(false);
                      closeDialog();
                    });
                  }}
                  disabled={busy}
                >
                  {t("account.logout")}
                </button>
              </div>
              {deleting ? (
                <form className="grid gap-3" onSubmit={(event) => void onDelete(event)}>
                  <p className="text-sm text-warn">{t("account.deleteWarn")}</p>
                  <PasswordField
                    id="account-delete-password"
                    label={t("account.password")}
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    show={show}
                    onToggle={() => setShow((value) => !value)}
                  />
                  <button type="submit" className={btn.danger} disabled={busy}>
                    {busy ? t("account.working") : t("account.deleteConfirm")}
                  </button>
                </form>
              ) : (
                <button type="button" className={cn(btn.ghost, "justify-start px-0 text-warn")} onClick={() => setDeleting(true)}>
                  {t("account.delete")}
                </button>
              )}
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                  {problem}
                </p>
              ) : null}
              {note ? <p className="text-sm text-accent">{note}</p> : null}
            </div>
          ) : (
            <form className="mt-5 grid gap-3" onSubmit={(event) => void onSubmit(event)}>
              {mode === "reset" ? null : (
                <Segmented
                  label={t("account.title")}
                  value={mode === "register" ? "register" : "login"}
                  onChange={(next) => setMode(next)}
                  options={[
                    { value: "login" as const, label: t("account.login") },
                    { value: "register" as const, label: t("account.register") },
                  ]}
                />
              )}
              {mode === "reset" ? null : (
                <label className="grid gap-1 text-sm font-medium" htmlFor="account-email">
                  {t("account.email")}
                  <input
                    id="account-email"
                    className={field}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    data-account-email
                  />
                </label>
              )}
              <PasswordField
                id="account-password"
                label={mode === "reset" ? t("account.newPassword") : t("account.password")}
                value={password}
                onChange={setPassword}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                show={show}
                onToggle={() => setShow((value) => !value)}
              />
              {mode === "register" || mode === "reset" ? (
                <PasswordField
                  id="account-password-again"
                  label={t("account.passwordAgain")}
                  value={again}
                  onChange={setAgain}
                  autoComplete="new-password"
                  show={show}
                  onToggle={() => setShow((value) => !value)}
                />
              ) : null}
              {mode === "register" ? <Turnstile onToken={setTurnstileToken} /> : null}
              <section className="grid gap-1" data-account-privacy>
                <h3 className="text-sm font-semibold">{t("account.privacyTitle")}</h3>
                <p className="text-xs text-muted">{t("account.privacy")}</p>
              </section>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
                  {problem}
                </p>
              ) : null}
              {note ? <p className="text-sm text-accent">{note}</p> : null}
              <button type="submit" className={btn.primary} disabled={busy} data-account-submit>
                {busy ? t("account.working") : mode === "reset" ? t("account.resetSubmit") : mode === "register" ? t("account.register") : t("account.login")}
              </button>
              {mode === "login" ? (
                <div className="grid gap-1">
                  <button type="button" className={cn(btn.ghost, "justify-start px-0")} onClick={() => setForgot((value) => !value)}>
                    {t("account.forgot")}
                  </button>
                  {forgot ? <p className="text-xs text-muted">{t("account.forgotBody")}</p> : null}
                </div>
              ) : null}
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Small entry in Settings. The dialog itself is mounted once with the rest of the app. */
export function AccountSection({ beforeOpen }: { beforeOpen?: () => void }) {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const email = useAccount((state) => state.email);
  const openDialog = useAccount((state) => state.openDialog);
  return (
    <section className="mt-5 grid gap-2" aria-label={t("settings.accountTitle")} data-settings-account>
      <h3 className="text-sm font-semibold">{t("settings.accountTitle")}</h3>
      <p className="text-xs text-muted">{t("account.privacy")}</p>
      <button
        type="button"
        className={cn(btn.quiet, "justify-start")}
        onClick={() => {
          beforeOpen?.();
          openDialog();
        }}
        data-account-open
      >
        <UserRound className="size-4" aria-hidden />
        {phase === "in" && email ? email : t("account.open")}
      </button>
    </section>
  );
}
