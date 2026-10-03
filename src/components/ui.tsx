import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const btnBase =
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-lg px-4 text-[0.95rem] font-semibold transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";

export const btn = {
  primary: cn(btnBase, "bg-accent text-accent-ink shadow-[0_1px_0_rgb(0_0_0/0.18)] hover:opacity-90"),
  quiet: cn(btnBase, "border border-line bg-card text-ink hover:bg-accent-soft"),
  ghost: cn(btnBase, "text-ink hover:bg-accent-soft"),
  danger: cn(btnBase, "bg-warn text-accent-ink hover:opacity-90"),
  icon: "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-accent-soft disabled:opacity-45",
} as const;

export const field =
  "min-h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink placeholder:text-muted focus:border-accent";

export const selectCls =
  "min-h-11 rounded-lg border border-line bg-card px-3 text-base text-ink focus:border-accent";

export const chip =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5";

/* ---------------------------------------------------------------- pronunciation */

/**
 * Pronunciation uses the voice that is built into the browser or phone (works offline).
 * Nothing is sent anywhere. Call this from the click that opened the word: a later effect
 * often runs after the browser has dropped the user gesture, and then speech stays silent.
 */
export function speakEnglish(text: string): boolean {
  const spoken = text.trim();
  if (!spoken) return false;
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const voice = new SpeechSynthesisUtterance(spoken);
    voice.lang = "en-US";
    voice.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(voice);
    return true;
  } catch {
    return false;
  }
}

export function useSpeak() {
  const [status, setStatus] = useState<"idle" | "error">("idle");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function play(text: string) {
    const ok = speakEnglish(text);
    if (alive.current) setStatus(ok ? "idle" : "error");
  }
  return { status, play };
}

export function SpeakButton({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { t } = useT();
  const { status, play } = useSpeak();
  const name = label ?? t("common.listen");
  return (
    <button
      type="button"
      onClick={() => play(text)}
      aria-label={`${name}: ${text}`}
      title={status === "error" ? t("common.noSound") : name}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent-soft",
        status === "error" ? "text-warn" : "text-accent",
        className,
      )}
    >
      <Volume2 className="size-[1.1rem]" aria-hidden />
      {status === "error" ? t("common.noSound") : name}
    </button>
  );
}

/* ---------------------------------------------------------------- small pieces */

/** The example sentence with the studied word (or phrase) marked. Whole words only. */
export function Highlighted({ sentence, surface }: { sentence: string; surface: string }) {
  let index = -1;
  let length = 0;
  if (surface) {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const found = new RegExp(`(^|[^\\p{L}\\p{M}])(${escaped})(?![\\p{L}\\p{M}])`, "iu").exec(sentence);
    if (found) {
      index = found.index + (found[1]?.length ?? 0);
      length = found[2]?.length ?? 0;
    } else {
      index = sentence.toLowerCase().indexOf(surface.toLowerCase());
      length = surface.length;
    }
  }
  if (index < 0) return <span lang="en">{sentence}</span>;
  return (
    <span lang="en">
      {sentence.slice(0, index)}
      <mark className="rounded bg-mark px-0.5 font-semibold text-ink">
        {sentence.slice(index, index + length)}
      </mark>
      {sentence.slice(index + length)}
    </span>
  );
}

export function ProgressBar({
  value,
  className,
  label,
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={cn("h-1.5 overflow-hidden rounded-full bg-line", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A quiet row of numbers (notebook, review). One card, thin dividers; two columns on a phone. */
export function StatRow({
  items,
}: {
  items: ReadonlyArray<{
    label: string;
    value: number | string;
    tone?: "plain" | "warn" | "good";
    hint?: string;
  }>;
}) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-card sm:grid-cols-4 [&>div]:border-line max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(even)]:border-l sm:[&>div:not(:first-child)]:border-l">
      {items.map((item) => (
        <div key={item.label} className="grid content-start gap-0.5 px-4 py-3.5">
          <dt className="text-xs font-semibold text-muted">{item.label}</dt>
          <dd
            className={cn(
              "font-display text-3xl leading-none font-semibold tabular-nums",
              item.tone === "warn" && "text-warn",
              item.tone === "good" && "text-accent",
            )}
          >
            {item.value}
          </dd>
          {item.hint ? <dd className="text-xs text-muted">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-line/60 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 flex-1 rounded-md px-2 text-sm font-semibold transition-colors",
            option.value === value ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { t } = useT();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <AlertDialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 text-ink shadow-pop">
          <AlertDialog.Title className="font-display text-xl font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[0.95rem] text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel className={btn.quiet}>{t("common.cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action className={btn.danger} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
