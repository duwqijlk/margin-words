import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Camera, ChevronRight, Download, Eye, EyeOff, Pencil, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
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
import { SettingsBody } from "@/components/get-books";
import { NewTag } from "@/components/tutorial-tab";
import { useTutorialNews } from "@/lib/tutorial";
import { useT, type Key } from "@/lib/i18n";
import { dayLabel, useGlossaryQuota, type QuotaCount } from "@/lib/glossary-quota";
import { btn, cn, ConfirmDialog, field, panel, PanelHandle, ProgressBar, Segmented } from "@/components/ui";

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
    <label className="grid gap-1.5 text-sm font-bold" htmlFor={id}>
      {label}
      <span className="relative">
        <input
          id={id}
          className={cn(field, "pr-12 font-normal")}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          data-account-password={id}
        />
        <button
          type="button"
          className={cn(btn.icon, "absolute top-1/2 right-0.5 -translate-y-1/2 text-faint")}
          onClick={onToggle}
          aria-label={show ? t("account.hidePassword") : t("account.showPassword")}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </span>
    </label>
  );
}

/** One weekly count, novels or speeches: name, a 6px bar and "3 / 7" (design system AccountDialog). */
function QuotaRow({ label, count }: { label: string; count: QuotaCount }) {
  const { t } = useT();
  const text = t("account.glossaryCount", { used: count.used, limit: count.limit });
  const full = count.used >= count.limit;
  return (
    <div className="grid min-h-12 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-1 text-[15px]" data-account-glossary-row>
      <span>{label}</span>
      <ProgressBar className="h-1.5 rounded-full bg-line [&>div]:rounded-full" value={count.used / count.limit} label={`${label} ${text}`} />
      <em className={cn("text-sm not-italic [font-variant-numeric:tabular-nums]", full ? "font-bold text-warn" : "text-muted")} data-account-glossary-count>
        {text}
      </em>
      {full && count.resetAt ? (
        <p className="col-span-3 m-0 pb-1 text-xs text-faint" data-account-glossary-reset>
          {t("quota.backOn", { day: dayLabel(count.resetAt) })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The top of the signed-in account (design system AccountDialog): a 64px round picture with a camera
 * button to change it, the nickname with a pencil that turns it into a field in place (Save / cancel,
 * the hint under it), and the email it is signed in with.
 */
function Profile({
  email,
  nickname,
  onNickname,
  onSave,
  busy,
}: {
  email: string;
  nickname: string;
  onNickname: (value: string) => void;
  onSave: (event: FormEvent) => Promise<boolean>;
  busy: boolean;
}) {
  const { t, locale } = useT();
  const publicId = useAccount((state) => state.publicId);
  const avatar = useAccount((state) => state.avatar);
  const verified = useAccount((state) => state.emailVerified);
  const saved = useAccount((state) => state.nickname) ?? "";
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const nickField = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const shown = saved || email;

  useEffect(() => {
    if (editing) nickField.current?.select();
  }, [editing]);

  function stopEditing() {
    setEditing(false);
    window.requestAnimationFrame(() => pencil.current?.focus());
  }

  async function onPick(file: File | undefined) {
    if (!file || working) return;
    setWorking(true);
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
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  }

  async function onRemove() {
    if (working) return;
    setWorking(true);
    setProblem("");
    try {
      await removeAvatar();
    } catch (error) {
      setProblem(t(errorKey(error)));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid gap-2" data-account-avatar>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
        <div className="relative">
          {publicId ? (
            <Avatar id={publicId} name={shown} version={avatar} size={64} eager />
          ) : (
            <span className="grid size-16 place-items-center rounded-full bg-accent text-2xl font-bold text-accent-ink" aria-hidden>
              {[...shown.trim()][0]?.toUpperCase() ?? ""}
            </span>
          )}
          {publicId ? (
            <button
              type="button"
              className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-paper bg-ink text-paper disabled:opacity-60"
              disabled={working || !verified}
              onClick={() => input.current?.click()}
              aria-label={t("account.avatarChange")}
              title={verified ? t("account.avatarHint") : t("account.err.avatarVerify")}
              data-account-avatar-change
            >
              <Camera className="size-3.5" aria-hidden />
            </button>
          ) : null}
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
        <div className="min-w-0">
          {editing ? (
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5"
              onSubmit={(event) => {
                void onSave(event).then((ok) => {
                  if (ok) stopEditing();
                });
              }}
              data-account-nickname-form
            >
              <input
                ref={nickField}
                className={cn(field, "min-h-10 text-base font-bold")}
                value={nickname}
                maxLength={16}
                autoComplete="nickname"
                aria-label={t("account.nickname")}
                onChange={(event) => onNickname(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onNickname(saved);
                    stopEditing();
                  }
                }}
                data-account-nickname
              />
              <button type="submit" className={cn(btn.primary, "min-h-10 px-3.5")} disabled={busy} data-account-nickname-save>
                {t("account.save")}
              </button>
              <button
                type="button"
                className={cn(btn.icon, "size-10 min-h-10")}
                aria-label={t("common.cancel")}
                onClick={() => {
                  onNickname(saved);
                  stopEditing();
                }}
              >
                <X className="size-5" aria-hidden />
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-0.5">
              <b className="min-w-0 truncate text-[22px] leading-tight font-bold tracking-[-0.02em]" data-account-name>
                {shown}
              </b>
              <button
                ref={pencil}
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded text-faint transition-colors duration-100 hover:bg-sheet hover:text-ink"
                aria-label={t("account.editNickname")}
                onClick={() => setEditing(true)}
                data-account-nickname-edit
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <p className="m-0 mt-1 text-[13px] leading-snug text-faint wrap-any" data-account-signed-in>
            {editing ? (
              t("account.nicknameHintLong")
            ) : (
              <>
                {t("account.signedIn", { email })}
                {avatar ? (
                  <>
                    {" · "}
                    <button type="button" className="text-faint underline underline-offset-2 hover:text-ink" disabled={working} onClick={() => void onRemove()} data-account-avatar-remove>
                      {t("account.avatarRemoveLong")}
                    </button>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>
      {problem ? (
        <p className="m-0 rounded bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-account-error>
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
    <section className={panel.group} aria-label={t("account.glossaryTitle")} data-account-glossary>
      <h3 className={panel.groupTitle}>{t("account.glossaryTitle")}</h3>
      <div className={panel.box}>
        {quota.unlimited ? (
          <div className={panel.row}>
            <span>{t("account.glossaryNovels")} · {t("account.glossarySpeeches")}</span>
            <span className="text-sm text-muted" data-account-glossary-count>
              {t("account.glossaryUnlimited")}
            </span>
          </div>
        ) : (
          <>
            <QuotaRow label={t("account.glossaryNovels")} count={quota.novel} />
            {quota.speech ? <QuotaRow label={t("account.glossarySpeeches")} count={quota.speech} /> : null}
          </>
        )}
      </div>
      {quota.unlimited ? null : <p className={panel.note}>{t("account.glossaryHint")}</p>}
    </section>
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
  const nicknamePrompt = useAccount((state) => state.nicknamePrompt);
  const emailVerified = useAccount((state) => state.emailVerified);
  const sync = useAccount((state) => state.sync);
  const [askSignOut, setAskSignOut] = useState(false);
  const [view, setView] = useState<"account" | "settings">("account");
  const tutorialNews = useTutorialNews();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const settingsEntry = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);
  useLayoutEffect(() => {
    setView("account");
  }, [open, mode, resetToken]);
  useLayoutEffect(() => {
    if (open && view === "settings") titleRef.current?.focus();
  }, [open, view]);
  function backToAccount() {
    setView("account");
    requestAnimationFrame(() => settingsEntry.current?.focus());
  }
  function dismissForNavigation() {
    restoreFocus.current = false;
    closeDialog();
  }
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

  async function onSaveNickname(event: FormEvent): Promise<boolean> {
    event.preventDefault();
    if (busy) return false;
    setProblem("");
    setNote("");
    const cleaned = cleanNickname(nickname);
    if (!cleaned) {
      setProblem(t("account.err.nickname"));
      return false;
    }
    setBusy(true);
    try {
      await saveNickname(cleaned);
      setNickname(cleaned);
      if (nicknamePrompt) closeDialog();
      else setNote(t("account.nicknameSaved"));
      return true;
    } catch (error) {
      setProblem(t(errorKey(error)));
      return false;
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
        <Dialog.Overlay className={panel.overlay} />
        <Dialog.Content className={panel.content} data-account-dialog
            onOpenAutoFocus={() => { restoreFocus.current = true; }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (restoreFocus.current) document.querySelector<HTMLButtonElement>("[data-account-button]")?.focus();
            }}>
          <PanelHandle />
          <div className={panel.head}>
            <div className="flex min-w-0 items-center gap-2">
              {view === "settings" ? (
                <button type="button" className={btn.icon} onClick={backToAccount} aria-label={t("account.backToAccount")} data-account-back>
                  <ArrowLeft className="size-5" aria-hidden />
                </button>
              ) : null}
            <Dialog.Title ref={titleRef} tabIndex={-1} className={panel.title}>
              {view === "settings" ? t("settings.title") : mode === "reset"
                ? t("account.resetTitle")
                : mode === "forgot"
                  ? t("account.forgotTitle")
                  : checking || signingUp
                    ? t("account.codeTitle")
                    : prompting
                      ? t("account.nicknamePromptTitle")
                      : t("account.title")}
            </Dialog.Title>
            </div>
            <Dialog.Close className={cn(btn.icon, "-mr-2.5")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className={view === "settings" || signedIn || signingUp ? "sr-only" : panel.desc}>
            {view === "settings" ? t("settings.desc") : checking || signingUp
              ? t("account.codeTitle")
              : prompting
              ? t("account.nicknamePrompt")
              : signedIn
                ? t("account.title")
                : mode === "forgot"
                  ? t("account.forgotIntro")
                  : t("account.desc")}
          </Dialog.Description>

          <div hidden={view !== "account"} data-account-home>
            <div className={cn(panel.box, "mb-5")}>
              <button ref={settingsEntry} type="button" className={panel.row} onClick={() => setView("settings")} data-account-settings>
                <span className={panel.rowLabel}>{t("settings.title")}{tutorialNews ? <span className="ml-2"><NewTag /></span> : null}</span>
                <ChevronRight className={panel.rowIcon} aria-hidden />
              </button>
            </div>
          {signingUp ? (
            <div>
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
            <div>
              <EmailCodeBox email={emailSaved} />
            </div>
          ) : prompting ? (
            <form className="grid gap-3" onSubmit={(event) => void onSaveNickname(event)} data-nickname-prompt>
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
            <div className="grid gap-5">
              <Profile email={emailSaved} nickname={nickname} onNickname={setNickname} onSave={onSaveNickname} busy={busy} />
              <ReadingOverviewPanel />
              <GlossaryAllowance />
              <section className={panel.group} aria-label={t("account.title")} data-account-more>
                <div className={panel.box}>
                  <button type="button" className={panel.row} onClick={() => void onExport()} disabled={busy} data-account-export>
                    <span className={panel.rowLabel}>{t("account.export")}</span>
                    <Download className={panel.rowIcon} aria-hidden />
                  </button>
                  <button type="button" className={panel.row} onClick={() => setAskSignOut(true)} disabled={busy} data-account-logout>
                    <span className={panel.rowLabel}>{busy ? t("account.working") : t("account.logout")}</span>
                    <ChevronRight className={panel.rowIcon} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={cn(panel.row, "text-warn")}
                    onClick={() => setDeleting((value) => !value)}
                    aria-expanded={deleting}
                    data-account-delete
                  >
                    <span>{t("account.delete")}</span>
                    <ChevronRight className={cn(panel.rowIcon, "text-warn transition-transform", deleting && "rotate-90")} aria-hidden />
                  </button>
                  {deleting ? (
                    <form className="grid gap-3 py-3" onSubmit={(event) => void onDelete(event)}>
                      <p className="m-0 text-sm text-warn">{t("account.deleteWarn")}</p>
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
                  ) : null}
                </div>
                <p className={panel.note} data-account-sync>
                  {t("account.syncNote")}
                  {syncLabel(sync, t) ? <> {syncLabel(sync, t)}</> : null}
                </p>
              </section>
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
              {problem ? (
                <p className="m-0 rounded bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                  {problem}
                </p>
              ) : null}
              {note ? <p className="m-0 text-sm text-accent" role="status">{note}</p> : null}
            </div>
          ) : mode === "forgot" ? (
            <form className="grid gap-3" onSubmit={(event) => void onForgotSubmit(event)} data-account-forgot>
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
            <form className="grid gap-3" onSubmit={(event) => void onSubmit(event)}>
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
                <label className="grid gap-1.5 text-sm font-bold" htmlFor="account-email">
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
                  <button type="button" className={cn(btn.bare, "justify-self-center px-2 text-sm text-accent")} onClick={() => setMode("forgot")} data-account-forgot-open>
                    {t("account.forgot")}
                  </button>
                ) : null
              ) : null}
            </form>
          )}
          </div>
          {view === "settings" ? <div className="grid gap-4 sm:gap-5" data-settings-panel><SettingsBody onDismiss={dismissForNavigation} /></div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
