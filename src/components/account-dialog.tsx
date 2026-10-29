import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount, type AccountMode, type SyncStatus } from "@/lib/account-store";
import { Avatar } from "@/components/avatar";
import { cleanNickname } from "@/lib/nickname";
import { ReadingOverviewPanel } from "@/components/reading-overview";
import {
  accountRequest,
  confirmEmailCode,
  confirmPasswordReset,
  deleteAccount,
  exportAccount,
  AvatarDailyLimit,
  removeAvatar,
  requestPasswordReset,
  saveNickname,
  sendEmailCode,
  uploadAvatar,
  signIn,
  signOut,
  signUp,
  finishSignUp,
  resendSignUpCode,
} from "@/lib/sync-engine";
import { suggestEmail } from "@/lib/email-typo";
import { navigate } from "@/lib/router";
import { isSponsorAdmin } from "@/lib/sponsor";
import { useT, type Key } from "@/lib/i18n";
import { dayLabel, useGlossaryQuota, type QuotaCount } from "@/lib/glossary-quota";
import { btn, cn, ConfirmDialog, field, ProgressBar, Segmented } from "@/components/ui";

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

const ERROR_KEYS: Record<string, Key> = {
  email: "account.err.email",
  password: "account.err.password",
  "email-taken": "account.err.emailTaken",
  credentials: "account.err.credentials",
  rate: "account.err.rate",
  turnstile: "account.err.turnstile",
  network: "account.err.network",
  nickname: "account.err.nickname",
  code: "account.err.code",
  "code-expired": "account.err.codeExpired",
  "code-wait": "account.err.codeWait",
  "code-send": "account.err.codeSend",
  "avatar-type": "account.err.avatarType",
  "too-large": "account.err.avatarSize",
  "email-unverified": "account.err.avatarVerify",
  "avatar-daily": "account.err.avatarDaily",
};

function errorKey(error: unknown): Key {
  const code = error instanceof Error ? error.message : "";
  return ERROR_KEYS[code] ?? "account.err.generic";
}

function syncLabel(status: SyncStatus, t: (key: Key) => string): string {
  if (status === "offline") return t("account.syncOffline");
  if (status === "error") return t("account.syncError");
  return "";
}

function Turnstile({
  action,
  id,
  onToken,
  resetRef,
}: {
  action: "signup" | "login" | "reset";
  id: string;
  onToken: (token: string) => void;
  resetRef: { current: () => void };
}) {
  const { t } = useT();
  const widgetId = useRef<string | undefined>(undefined);
  const tokenSeen = useRef(false);
  // The widget is an iframe from challenges.cloudflare.com. On some networks that host never
  // answers, and then this used to leave an empty 64px box and a form that could never be sent:
  // the button only said "finish the human check", and there was no check to finish.
  const [phase, setPhase] = useState<"waiting" | "ok" | "failed">("waiting");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!SITE_KEY) return;
    const holder = document.getElementById(id);
    if (!holder) return;
    let cancelled = false;
    tokenSeen.current = false;
    setPhase("waiting");
    const timer = setTimeout(() => {
      if (!cancelled && !tokenSeen.current) setPhase("failed");
    }, 12_000);
    const give = (token: string) => {
      tokenSeen.current = Boolean(token);
      if (token) {
        clearTimeout(timer);
        setPhase("ok");
      }
      onToken(token);
    };
    const clear = () => give("");
    resetRef.current = () => {
      clear();
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    };
    const render = () => {
      if (cancelled || !holder || widgetId.current) return;
      widgetId.current = window.turnstile?.render(holder, {
        sitekey: SITE_KEY,
        action,
        callback: give,
        "expired-callback": clear,
        "error-callback": () => {
          if (!cancelled) setPhase("failed");
          clear();
        },
      });
    };
    if (window.turnstile) {
      render();
    } else if (!document.querySelector("script[data-turnstile-api]")) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.dataset.turnstileApi = "1";
      script.onload = render;
      script.onerror = () => {
        if (!cancelled) setPhase("failed");
      };
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [action, id, onToken, resetRef, attempt]);
  if (!SITE_KEY) return null;
  return (
    <>
      <div id={id} className="min-h-16" data-turnstile />
      {phase === "failed" ? (
        <p className="text-xs leading-snug text-muted" data-turnstile-failed>
          {t("account.turnstileFailed")}{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            data-turnstile-retry
            onClick={() => {
              document.querySelector("script[data-turnstile-api]")?.remove();
              setAttempt((value) => value + 1);
            }}
          >
            {t("account.turnstileRetry")}
          </button>
        </p>
      ) : null}
    </>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
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

/** One weekly count: novels or speeches. */
function QuotaRow({ label, count }: { label: string; count: QuotaCount }) {
  const { t } = useT();
  const text = t("account.glossaryCount", { used: count.used, limit: count.limit });
  return (
    <div className="mt-2" data-account-glossary-row>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted">{label}</span>
        <span
          className={cn("tabular-nums", count.used >= count.limit ? "font-semibold text-warn" : "text-muted")}
          data-account-glossary-count
        >
          {text}
        </span>
      </div>
      <ProgressBar className="mt-1" value={count.used / count.limit} label={`${label} ${text}`} />
      {count.used >= count.limit && count.resetAt ? (
        <p className="mt-1 text-xs text-muted" data-account-glossary-reset>
          {t("quota.backOn", { day: dayLabel(count.resetAt) })}
        </p>
      ) : null}
    </div>
  );
}

/** Fresh weekly allowance, loaded when the signed-in account dialog opens. */
/** The reader's avatar, with Change and Remove. Shown with their accepted meanings and in the rank. */
function AvatarPicker({ name }: { name: string }) {
  const { t, locale } = useT();
  const publicId = useAccount((state) => state.publicId);
  const avatar = useAccount((state) => state.avatar);
  const verified = useAccount((state) => state.emailVerified);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  if (!publicId) return null;

  async function onPick(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setProblem("");
    try {
      await uploadAvatar(file);
    } catch (error) {
      if (error instanceof AvatarDailyLimit) {
        const at = new Date(error.nextAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        setProblem(t("account.err.avatarDailyAt", { at }));
        return;
      }
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function onRemove() {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      await removeAvatar();
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-2" data-account-avatar>
      <div className="flex items-center gap-3">
        <Avatar id={publicId} name={name} version={avatar} size={48} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btn.quiet, "min-h-9 px-3 text-sm")}
            disabled={busy || !verified}
            onClick={() => input.current?.click()}
            data-account-avatar-change
          >
            {busy ? t("account.working") : t("account.avatarChange")}
          </button>
          {avatar ? (
            <button type="button" className={cn(btn.ghost, "min-h-9 px-3 text-sm")} disabled={busy} onClick={() => void onRemove()} data-account-avatar-remove>
              {t("account.avatarRemove")}
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void onPick(event.target.files?.[0])}
          data-account-avatar-input
        />
      </div>
      <p className="text-xs text-muted">{verified ? t("account.avatarHint") : t("account.err.avatarVerify")}</p>
      {problem ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The 6-digit code sent to a new account's email. Until it is typed, the account works (shelf,
 * sync) but cannot open word lists. `onDone` runs after the right code.
 */
function EmailCodeBox({
  email,
  onDone,
  signup,
}: {
  email: string;
  onDone?: () => void;
  /** A sign-up in progress: the code makes the account, and Send again starts the sign-up over. */
  signup?: { ticket: string; resend: () => Promise<void>; back: () => void };
}) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setProblem(t("account.err.code"));
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      if (signup) await finishSignUp(email, digits, signup.ticket);
      else await confirmEmailCode(digits);
      onDone?.();
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (busy) return;
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      if (signup) await signup.resend();
      else await sendEmailCode();
      setNote(t("account.codeResent"));
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void onConfirm(event)} data-email-code>
      <p className="text-sm text-muted">{t(signup ? "account.codeIntroSignup" : "account.codeIntro", { email })}</p>
      <label className="grid gap-1 text-sm font-medium" htmlFor="account-email-code">
        {t("account.codeLabel")}
        <input
          id="account-email-code"
          className={cn(field, "text-center text-xl tracking-[0.4em] tabular-nums")}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          data-email-code-input
        />
      </label>
      {problem ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
          {problem}
        </p>
      ) : null}
      {note ? (
        <p className="text-sm text-muted" role="status" data-email-code-note>
          {note}
        </p>
      ) : null}
      <button type="submit" className={btn.primary} disabled={busy} data-email-code-confirm>
        {busy ? t("account.working") : t("account.codeConfirm")}
      </button>
      <button type="button" className={btn.quiet} disabled={busy} onClick={() => void onResend()} data-email-code-resend>
        {t("account.codeResend")}
      </button>
      <p className="text-xs text-muted">{t("account.codeSpam")}</p>
      {signup ? (
        <button
          type="button"
          className="justify-self-start text-sm font-medium text-accent hover:underline"
          disabled={busy}
          onClick={signup.back}
          data-email-code-back
        >
          {t("account.codeWrongAddress")}
        </button>
      ) : null}
    </form>
  );
}

function GlossaryAllowance() {
  const { t } = useT();
  const quota = useGlossaryQuota((state) => state.quota);
  useEffect(() => {
    void useGlossaryQuota.getState().refresh();
  }, []);
  if (!quota) return null;
  return (
    <div className="mt-4 rounded-xl border border-line px-4 py-3" data-account-glossary>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{t("account.glossaryTitle")}</p>
        {quota.unlimited ? (
          <p className="text-sm text-muted" data-account-glossary-count>
            {t("account.glossaryUnlimited")}
          </p>
        ) : null}
      </div>
      {quota.unlimited ? null : (
        <>
          <QuotaRow label={t("account.glossaryNovels")} count={quota.novel} />
          {quota.speech ? <QuotaRow label={t("account.glossarySpeeches")} count={quota.speech} /> : null}
          <p className="mt-2 text-xs text-muted">{t("account.glossaryHint")}</p>
        </>
      )}
    </div>
  );
}

/** Sign in, create an account, or manage the one already in use. */
export function AccountDialog() {
  const { t } = useT();
  const open = useAccount((state) => state.dialogOpen);
  const mode = useAccount((state) => state.mode);
  const resetToken = useAccount((state) => state.resetToken);
  const phase = useAccount((state) => state.phase);
  const role = useAccount((state) => state.role);
  const emailSaved = useAccount((state) => state.email);
  const nicknameSaved = useAccount((state) => state.nickname);
  const nicknamePrompt = useAccount((state) => state.nicknamePrompt);
  const emailVerified = useAccount((state) => state.emailVerified);
  const sync = useAccount((state) => state.sync);
  const [askSignOut, setAskSignOut] = useState(false);
  const resetEmailReady = useAccount((state) => state.resetEmail);
  const closeDialog = useAccount((state) => state.closeDialog);
  const openDialog = useAccount((state) => state.openDialog);

  const [email, setEmail] = useState("");
  /** The address a sign-up code was sent to, until the code is typed. */
  const [pendingSignup, setPendingSignup] = useState("");
  /** The ticket the server gave this sign-up; resending and finishing need it. */
  const [signupTicket, setSignupTicket] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotNote, setForgotNote] = useState("");
  const [forgotTurnstileToken, setForgotTurnstileToken] = useState("");
  const resetForgotTurnstile = useRef<() => void>(() => {});

  useEffect(() => {
    if (mode === "forgot") {
      setForgotNote("");
      setForgotTurnstileToken("");
      setForgotEmail(email);
    }
  }, [mode, email]);
  const [deleting, setDeleting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [nickname, setNickname] = useState("");
  const resetTurnstile = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setAgain("");
    setShow(false);
    setProblem("");
    setNote("");
    setForgotEmail("");
    setForgotBusy(false);
    setForgotNote("");
    setForgotTurnstileToken("");
    setDeleting(false);
    setBusy(false);
    setTurnstileToken("");
    setNickname(useAccount.getState().nickname ?? "");
    if (emailSaved) setEmail(emailSaved);
  }, [open, emailSaved]);

  function setMode(next: AccountMode) {
    setProblem("");
    setNote("");
    setTurnstileToken("");
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
    // Only registration asks for the human check; login does not (see functions/lib/handlers.ts).
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
        const started = await signUp(address, password, turnstileToken);
        setSignupTicket(started.ticket);
        setPendingSignup(started.email);
      } else {
        await signIn(address, password);
        closeDialog();
      }
    } catch (error) {
      if (mode === "register") resetTurnstile.current();
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function onForgotSubmit(event: FormEvent) {
    event.preventDefault();
    if (forgotBusy) return;
    const address = forgotEmail.trim().toLowerCase();
    setProblem("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setProblem(t("account.err.email"));
      return;
    }
    if (SITE_KEY && !forgotTurnstileToken) {
      setProblem(t("account.err.turnstile"));
      return;
    }
    setForgotBusy(true);
    setForgotNote("");
    try {
      await requestPasswordReset(address, forgotTurnstileToken || undefined);
      setForgotNote(t("account.forgotSent"));
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setForgotTurnstileToken("");
      resetForgotTurnstile.current();
      setForgotBusy(false);
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

  async function onSaveNickname(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setProblem("");
    setNote("");
    const cleaned = cleanNickname(nickname);
    if (!cleaned) {
      setProblem(t("account.err.nickname"));
      return;
    }
    setBusy(true);
    try {
      await saveNickname(cleaned);
      setNickname(cleaned);
      if (nicknamePrompt) closeDialog();
      else setNote(t("account.nicknameSaved"));
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = phase === "in" && emailSaved && mode !== "reset";
  const signingUp = Boolean(pendingSignup) && mode === "register" && !signedIn;
  const emailHint = mode === "register" || mode === "login" ? suggestEmail(email) : "";
  // A new account types its emailed code first; the nickname question comes after.
  const checking = Boolean(signedIn && !emailVerified);
  const prompting = signedIn && nicknamePrompt && !checking;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? openDialog(mode, resetToken) : closeDialog())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-paper p-5 text-ink shadow-lift sm:p-6"
          data-account-dialog
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl font-semibold">
              {mode === "reset"
                ? t("account.resetTitle")
                : mode === "forgot"
                  ? t("account.forgotTitle")
                  : checking || signingUp
                    ? t("account.codeTitle")
                    : prompting
                      ? t("account.nicknamePromptTitle")
                      : t("account.title")}
            </Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className={signedIn || signingUp ? "sr-only" : "mt-2 text-sm text-muted"}>
            {checking || signingUp
              ? t("account.codeTitle")
              : prompting
              ? t("account.nicknamePrompt")
              : signedIn
                ? t("account.title")
                : mode === "forgot"
                  ? t("account.forgotIntro")
                  : t("account.desc")}
          </Dialog.Description>

          {signingUp ? (
            <div className="mt-4">
              <EmailCodeBox
                email={pendingSignup}
                signup={{
                  ticket: signupTicket,
                  // A fresh code without a new human check (the server allows one a minute).
                  resend: () => resendSignUpCode(pendingSignup, signupTicket),
                  back: () => {
                    setPendingSignup("");
                    resetTurnstile.current();
                    setTurnstileToken("");
                  },
                }}
                onDone={() => {
                  setPendingSignup("");
                  setPassword("");
                  setAgain("");
                  useAccount.getState().patch({ nicknamePrompt: true, dialogOpen: true });
                }}
              />
            </div>
          ) : checking && emailSaved ? (
            <div className="mt-4">
              <EmailCodeBox email={emailSaved} />
            </div>
          ) : prompting ? (
            <form className="mt-5 grid gap-3" onSubmit={(event) => void onSaveNickname(event)} data-nickname-prompt>
              <label className="grid gap-1 text-sm font-medium" htmlFor="account-nickname">
                {t("account.nickname")}
                <input
                  id="account-nickname"
                  className={field}
                  value={nickname}
                  maxLength={16}
                  autoComplete="nickname"
                  autoFocus
                  onChange={(event) => setNickname(event.target.value)}
                  data-account-nickname
                />
              </label>
              <p className="text-xs text-muted">{t("account.nicknameHint")}</p>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
                  {problem}
                </p>
              ) : null}
              <button type="submit" className={btn.primary} disabled={busy} data-account-nickname-save>
                {busy ? t("account.working") : t("account.nicknameSave")}
              </button>
              <button type="button" className={btn.quiet} disabled={busy} onClick={() => closeDialog()} data-nickname-later>
                {t("account.nicknameLater")}
              </button>
            </form>
          ) : signedIn ? (
            <div className="mt-5">
              <p className="text-sm font-semibold" data-account-signed-in>
                {t("account.signedIn", { email: emailSaved })}
              </p>
              <AvatarPicker name={nickname || emailSaved || ""} />
              <ReadingOverviewPanel />
              <GlossaryAllowance />
              <form className="mt-5 grid gap-2" onSubmit={(event) => void onSaveNickname(event)}>
                <label className="grid gap-1 text-sm font-medium" htmlFor="account-nickname-edit">
                  {t("account.nickname")}
                  <input
                    id="account-nickname-edit"
                    className={field}
                    value={nickname}
                    maxLength={16}
                    autoComplete="nickname"
                    onChange={(event) => setNickname(event.target.value)}
                    data-account-nickname
                  />
                </label>
                <p className="text-xs text-muted">{t("account.nicknameHint")}</p>
                {cleanNickname(nickname) !== (nicknameSaved ?? null) ? (
                  <button type="submit" className={cn(btn.quiet, "justify-start")} disabled={busy} data-account-nickname-save>
                    {t("account.nicknameSave")}
                  </button>
                ) : null}
              </form>
              {role === "admin" || isSponsorAdmin(emailSaved) ? (
                <button
                  type="button"
                  className={cn(btn.primary, "mt-5 w-full justify-center")}
                  onClick={() => {
                    closeDialog();
                    navigate({ kind: "admin" });
                  }}
                  data-account-admin
                >
                  {t("admin.title")}
                </button>
              ) : null}
              <button
                type="button"
                className={cn(btn.quiet, "mt-3 w-full justify-start")}
                onClick={() => setAskSignOut(true)}
                disabled={busy}
                data-account-logout
              >
                {busy ? t("account.working") : t("account.logout")}
              </button>
              <ConfirmDialog
                open={askSignOut}
                onOpenChange={setAskSignOut}
                title={t("account.logoutTitle")}
                description={t("account.logoutBody")}
                confirmLabel={t("account.logoutConfirm")}
                onConfirm={() => {
                  setBusy(true);
                  // The page reloads when the device is clear.
                  void signOut().catch(() => setBusy(false));
                }}
              />
              {syncLabel(sync, t) ? (
                <p className="mt-3 text-sm text-muted" data-account-sync>
                  {syncLabel(sync, t)}
                </p>
              ) : null}
              <details className="mt-5 rounded-xl border border-line px-4 py-1 open:pb-4" data-account-more>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                  {t("account.more")}
                </summary>
                <div className="grid gap-3">
                  <button type="button" className={cn(btn.quiet, "justify-start")} onClick={() => void onExport()} disabled={busy}>
                    {t("account.export")}
                  </button>
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
                </div>
              </details>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                  {problem}
                </p>
              ) : null}
              {note ? <p className="text-sm text-accent">{note}</p> : null}
            </div>
          ) : mode === "forgot" ? (
            <form className="mt-5 grid gap-3" onSubmit={(event) => void onForgotSubmit(event)} data-account-forgot>
              <button type="button" className={cn(btn.ghost, "justify-start px-0")} onClick={() => setMode("login")} data-account-forgot-back>
                {t("account.backToLogin")}
              </button>
              <label className="grid gap-1 text-sm font-medium" htmlFor="account-forgot-email">
                {t("account.forgotEmail")}
                <input
                  id="account-forgot-email"
                  className={field}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={forgotEmail}
                  onChange={(event) => setForgotEmail(event.target.value)}
                  data-account-forgot-email
                />
              </label>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
                  {problem}
                </p>
              ) : null}
              <Turnstile
                action="reset"
                id="mw-turnstile-reset"
                onToken={setForgotTurnstileToken}
                resetRef={resetForgotTurnstile}
              />
              {forgotNote ? <p className="text-sm text-accent">{forgotNote}</p> : null}
              <button type="submit" className={btn.primary} disabled={forgotBusy} data-account-forgot-send>
                {forgotBusy ? t("account.working") : t("account.forgotSend")}
              </button>
            </form>
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
                  {emailHint ? (
                    <span className="text-sm font-normal text-warn" role="status" data-account-email-hint>
                      {t("account.emailDidYouMean")}{" "}
                      <button
                        type="button"
                        className="font-semibold underline underline-offset-2"
                        onClick={() => setEmail(emailHint)}
                        data-account-email-fix
                      >
                        {emailHint}
                      </button>
                      ?
                    </span>
                  ) : null}
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
              {mode === "register" ? (
                <Turnstile
                  key={mode}
                  action="signup"
                  id="mw-turnstile"
                  onToken={setTurnstileToken}
                  resetRef={resetTurnstile}
                />
              ) : null}
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
                resetEmailReady ? (
                  <button type="button" className={cn(btn.ghost, "justify-start px-0")} onClick={() => setMode("forgot")} data-account-forgot-open>
                    {t("account.forgot")}
                  </button>
                ) : (
                  <p className="text-xs text-muted">{t("account.forgotBody")}</p>
                )
              ) : null}
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
