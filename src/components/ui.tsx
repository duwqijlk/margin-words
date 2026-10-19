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
  quiet: cn(
    btnBase,
    "border border-line/80 bg-card text-ink shadow-2xs hover:bg-accent-soft/50 hover:border-accent/40",
  ),
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

/** Stop whatever is speaking and return the token that owns the sound from now on. */
function stopSpeaking(): number {
  spokenToken += 1;
  if (currentAudio) {
    const audio = currentAudio;
    currentAudio = null;
    try {
      audio.pause();
    } catch {
      // A detached or broken element: the next call still takes over.
    }
    audio.remove();
  }
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
  } catch {
    // No speech synthesis on this engine.
  }
  return spokenToken;
}

/** Characters that are punctuation at the edge of a word, never part of it. */
const EDGE_PUNCTUATION = /^[\s"'()[\]{}.,;:!?\u2014\u2013-]+|[\s"'()[\]{}.,;:!?\u2014\u2013-]+$/g;

/**
 * The text the voice service is asked for.
 *
 * Quotes, brackets and stray punctuation are dropped, but every LETTER is kept. The old rule kept
 * only `a-zA-Z0-9`, so "cafe" with an accent became "caf", "resume" with accents became "r", and
 * the reader heard a syllable that is not the word. Curly apostrophes are folded to the straight
 * one, which is the form the dictionary expects.
 */
function voiceText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(EDGE_PUNCTUATION, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The dictionary audio to try, in order. `type=2` is the British recording, `type=1` the American
 * one, and plenty of words exist in only one of the two - asking for both cuts the number of words
 * that end up on the synthesized fallback, which is the voice a reader hears as "wrong".
 */
function voiceUrls(text: string): string[] {
  const query = encodeURIComponent(text);
  return [
    `https://dict.youdao.com/dictvoice?audio=${query}&type=2`,
    `https://dict.youdao.com/dictvoice?audio=${query}&type=1`,
  ];
}

type AudioResult = "started" | "aborted" | "failed";

function playAudio(url: string, token: number): Promise<AudioResult> {
  return new Promise((resolve) => {
    if (typeof Audio === "undefined" || typeof document === "undefined" || !document.body) {
      resolve("failed");
      return;
    }
    let settled = false;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.style.display = "none";
    audio.src = url;
    const finish = (result: AudioResult) => {
      if (settled) return;
      settled = true;
      if (result !== "started") {
        audio.remove();
        if (currentAudio === audio) currentAudio = null;
      }
      resolve(result);
    };
    audio.addEventListener("error", () => finish("failed"), { once: true });
    audio.addEventListener(
      "ended",
      () => {
        if (currentAudio === audio) currentAudio = null;
        audio.remove();
      },
      { once: true },
    );
    // A detached `Audio` element does not start on some Android WebViews - the very devices this
    // path exists for. In the document, hidden, it does.
    document.body.appendChild(audio);
    currentAudio = audio;
    const started = audio.play();
    if (started && typeof started.then === "function") {
      started
        .then(() => finish(token === spokenToken ? "started" : "aborted"))
        .catch((error: unknown) => {
          // `AbortError` is our own `pause()` in a newer call, not a failed playback.
          finish((error as { name?: string } | null)?.name === "AbortError" ? "aborted" : "failed");
        });
    } else {
      finish("started");
    }
  });
}

let voiceCache: SpeechSynthesisVoice | null = null;

/**
 * An English voice, chosen once. `lang = "en-US"` alone lets the engine keep its default voice,
 * and on an Android reader that default is often the system voice, which reads English with the
 * wrong sounds - the flat, robotic voice a reader notices next to the dictionary recordings.
 */
function englishVoice(): SpeechSynthesisVoice | null {
  if (voiceCache) return voiceCache;
  try {
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    if (voices.length === 0) return null; // Still loading: try again on the next tap.
    const score = (voice: SpeechSynthesisVoice) => {
      const lang = String(voice.lang ?? "")
        .toLowerCase()
        .replace("_", "-");
      let value = 0;
      if (lang.startsWith("en-us")) value = 6;
      else if (lang.startsWith("en-gb")) value = 5;
      else if (lang.startsWith("en")) value = 3;
      if (value === 0) return 0;
      if (voice.localService) value += 1;
      if (/google|samantha|daniel|natural|enhanced|premium/i.test(voice.name ?? "")) value += 1;
      return value;
    };
    const best = voices
      .map((voice) => ({ voice, value: score(voice) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)[0];
    voiceCache = best?.voice ?? null;
    return voiceCache;
  } catch {
    return null;
  }
}

function speakWithSynthesis(spoken: string, token: number): boolean {
  // A newer word replaced this one while its audio was loading: stay silent.
  if (token !== spokenToken) return false;
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    const start = () => {
      if (token !== spokenToken) return;
      const utterance = new SpeechSynthesisUtterance(spoken);
      const voice = englishVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "en-US";
      utterance.rate = 0.9;
      synth.speak(utterance);
    };
    if (synth.speaking || synth.pending) {
      // Chrome on Android drops an utterance that is queued in the same task as `cancel()`.
      synth.cancel();
      setTimeout(start, 60);
    } else {
      start();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pronunciation plays the dictionary recording, with the device's own voice as the last resort.
 * Works on Kindle, Android e-ink readers (Boox, Meebook, etc.), and standard web browsers.
 *
 * One voice at a time. Every call stops what the previous one started: a tap speaks the word, and
 * when that word belongs to a phrase the phrase replaces it a moment later. Without the stop, the
 * word's `play()` rejects with `AbortError` (paused by the phrase), the old code took that for a
 * failure and spoke the word with the fallback voice, and both sounded at once.
 */
export function speakEnglish(text: string): boolean {
  const spoken = voiceText(text);
  if (!spoken) return false;
  if (typeof window === "undefined") return false;

  const token = stopSpeaking();
  const urls = voiceUrls(spoken);
  void (async () => {
    for (const url of urls) {
      const result = await playAudio(url, token);
      if (result === "started" || result === "aborted") return;
    }
    speakWithSynthesis(spoken, token);
  })();
  return true;
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
    const found = new RegExp(`(^|[^\\p{L}\\p{M}])(${escaped})(?![\\p{L}\\p{M}])`, "iu").exec(
      sentence,
    );
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
            wrap
              ? "border border-line/60 whitespace-normal sm:flex-1 sm:border-0 sm:whitespace-nowrap"
              : "flex-1 whitespace-nowrap",
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
