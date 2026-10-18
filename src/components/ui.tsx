import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const btnBase =
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-[0.92rem] font-semibold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";

export const btn = {
  primary: cn(btnBase, "bg-accent text-accent-ink shadow-xs hover:bg-accent/90 hover:shadow-sm"),
  quiet: cn(btnBase, "border border-line/80 bg-card text-ink shadow-2xs hover:bg-accent-soft/50 hover:border-accent/40"),
  ghost: cn(btnBase, "text-ink hover:bg-accent-soft/60"),
  danger: cn(btnBase, "bg-warn text-accent-ink hover:opacity-90 shadow-xs"),
  icon: "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink transition-colors hover:bg-black/5 disabled:opacity-45",
} as const;

export const field =
  "min-h-11 w-full rounded-xl border border-line/80 bg-card px-3.5 text-base text-ink shadow-2xs placeholder:text-muted/60 transition-all focus:border-accent focus:shadow-xs focus:outline-none";

export const selectCls =
  "min-h-11 rounded-xl border border-line/80 bg-card px-3.5 text-base text-ink shadow-2xs transition-all focus:border-accent focus:outline-none";

export const chip =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 shadow-2xs";

/* ---------------------------------------------------------------- pronunciation */

let currentAudio: HTMLAudioElement | null = null;
/**
 * Bumped by every `speakEnglish` call. A newer call (the phrase that a tapped word turns out to
 * belong to) must silence the older one completely - including a fallback voice that the older,
 * already cancelled call would otherwise start on top of it.
 */
let spokenToken = 0;

/** Stop the audio element and any fallback voice. Returns the token of the call that owns the sound now. */
function stopSpeaking(): number {
  spokenToken += 1;
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      // A detached or broken element: the next call still takes over.
    }
    currentAudio = null;
  }
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {
    // No speech synthesis on this engine.
  }
  return spokenToken;
}

function speakWithSynthesis(spoken: string, token: number): boolean {
  // A newer word replaced this one while its audio was loading: stay silent.
  if (token !== spokenToken) return false;
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    synth.cancel();
    const voice = new SpeechSynthesisUtterance(spoken);
    voice.lang = "en-US";
    voice.rate = 0.9;
    synth.speak(voice);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pronunciation plays native dictionary audio, with built-in SpeechSynthesis as fallback.
 * Works on Kindle, Android e-ink readers (Boox, Meebook, etc.), and standard web browsers.
 *
 * One voice at a time. Every call stops what the previous one started: a tap speaks the word,
 * and when that word belongs to a phrase the phrase replaces it a moment later. Without the
 * stop, the word's `play()` rejects with `AbortError` (paused by the phrase), the old code took
 * that for a failure and spoke the word with the fallback voice, and both sounded at once.
 */
export function speakEnglish(text: string): boolean {
  const spoken = text.trim();
  if (!spoken) return false;
  if (typeof window === "undefined") return false;

  const clean = spoken.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (!clean) return false;

  const token = stopSpeaking();
  try {
    if (typeof Audio !== "undefined") {
      const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(clean)}&type=2`;
      const audio = new Audio(audioUrl);
      currentAudio = audio;
      const started = audio.play();
      if (started !== undefined) {
        started.catch((error: unknown) => {
          // `AbortError` is our own `pause()` in a newer call, not a failed playback.
          if ((error as { name?: string } | null)?.name === "AbortError") return;
          speakWithSynthesis(clean, token);
        });
      }
      return true;
    }
  } catch {
    // Audio element failed or blocked, fall through to speech synthesis
  }

  return speakWithSynthesis(clean, token);
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
  compact = false,
}: {
  text: string;
  label?: string;
  className?: string;
  /** Only the speaker icon, in a round 40px button. The name stays in the label and the tooltip. */
  compact?: boolean;
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
        compact
          ? "grid size-10 place-items-center rounded-full bg-accent-soft transition-colors hover:bg-accent hover:text-accent-ink"
          : "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent-soft",
        status === "error" ? "text-warn" : "text-accent",
        className,
      )}
      data-speak
    >
      <Volume2 className={compact ? "size-5" : "size-[1.1rem]"} aria-hidden />
      {compact ? null : status === "error" ? t("common.noSound") : name}
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
    <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line/70 bg-card shadow-xs sm:grid-cols-4 [&>div]:border-line/60 max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(even)]:border-l sm:[&>div:not(:first-child)]:border-l">
      {items.map((item) => (
        <div key={item.label} className="grid content-start gap-1 p-4 sm:p-5">
          <dt className="text-xs font-semibold tracking-wide text-muted/90">{item.label}</dt>
          <dd
            className={cn(
              "font-display text-2xl leading-none font-bold tabular-nums tracking-tight sm:text-3xl",
              item.tone === "warn" && "text-warn",
              item.tone === "good" && "text-accent",
            )}
          >
            {item.value}
          </dd>
          {item.hint ? <dd className="text-xs text-muted/80">{item.hint}</dd> : null}
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
  layout = "bar",
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  /** `wrap` gives each option its own cell on a phone, so four labels are not squeezed onto one line. */
  layout?: "bar" | "wrap";
}) {
  const wrap = layout === "wrap";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        wrap
          ? "grid grid-cols-2 gap-1.5 sm:flex sm:rounded-xl sm:bg-line/40 sm:p-1"
          : "flex rounded-xl bg-line/40 p-1 backdrop-blur-xs",
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 rounded-lg px-3 text-sm font-semibold transition-all duration-150",
            wrap ? "border border-line/60 whitespace-normal sm:flex-1 sm:border-0 sm:whitespace-nowrap" : "flex-1 whitespace-nowrap",
            option.value === value ? "bg-card text-ink shadow-xs" : "text-muted hover:text-ink",
            wrap && option.value !== value && "bg-card/40 sm:bg-transparent",
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
