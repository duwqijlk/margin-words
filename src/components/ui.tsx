import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { usePrefs } from "@/lib/reader-prefs";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// Buttons (design system "Keep reading"): 44px high, 4px corners, 15px bold labels. One primary per
// screen; secondary is a 1px edge outline; disabled is 40% opacity.
const btnBase =
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded px-4 text-[0.9375rem] leading-tight font-bold transition-[background-color,border-color,color,transform] duration-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

export const btn = {
  primary: cn(btnBase, "bg-accent text-accent-ink hover:bg-accent/90"),
  /** Secondary: transparent with a 1px edge border; the sheet ground on hover. */
  quiet: cn(btnBase, "border border-edge text-ink hover:bg-sheet"),
  ghost: cn(btnBase, "text-ink hover:bg-sheet"),
  danger: cn(btnBase, "bg-warn text-accent-ink hover:bg-warn/90"),
  /** 44×44, ink-2; the current one turns brand (aria-current / text-accent), never filled. */
  icon: "inline-flex size-11 shrink-0 items-center justify-center rounded text-muted transition-colors duration-100 hover:bg-sheet hover:text-ink disabled:opacity-40",
} as const;

// Inputs, selects and search fields look the same: paper ground, 1px edge border, 4px corners.
// Focused, the border and an inner ring turn brand (2px of brand in all).
export const field =
  "min-h-11 w-full rounded border border-edge bg-paper px-3 text-base text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-100 focus:border-accent focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb))] focus:outline-none";

export const selectCls =
  "min-h-11 rounded border border-edge bg-paper px-3 text-base text-ink transition-[border-color,box-shadow] duration-100 focus:border-accent focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb))] focus:outline-none";

export const chip =
  "inline-flex items-center rounded px-2 py-0.5 text-xs font-bold leading-5";

/**
 * Second-level tabs as plain text (Discover's Novels / Speeches, Overview's sections): the row has a
 * hairline under it, the current tab is ink with a short line under it. One look for both pages.
 */
export const subTabs = {
  // No scrolling: two or three short words always fit, and a scroll box showed a scrollbar for the 1px overlap.
  row: "flex gap-6 border-b border-line",
  tab: "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-[0.9375rem] transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  on: "border-accent font-bold text-ink",
  off: "border-transparent text-muted hover:text-ink",
} as const;

/* ---------------------------------------------------------------- pronunciation */

export type PronunciationAccent = "UK" | "US";
/** `started` can be followed by `failed` if playback fails after starting. */
export type PronunciationOutcome = "started" | "failed" | "aborted";
export type PronunciationOptions = {
  accent?: PronunciationAccent;
  onOutcome?: (outcome: PronunciationOutcome) => void;
};

type PronunciationRequest = {
  token: number;
  accent?: PronunciationAccent;
  preferredAccent: PronunciationAccent;
  cancelAttempt: (() => void) | null;
  notify: (outcome: PronunciationOutcome) => void;
  finish: (outcome?: PronunciationOutcome) => void;
};

let currentAudio: HTMLAudioElement | null = null;
let cancelPronunciation: (() => void) | null = null;
// A newer word/phrase owns the entire pipeline, not just the current recording. Cancelling also
// settles a pending play promise, even on engines that never resolve or reject it after pause().
let spokenToken = 0;
const PRONUNCIATION_START_TIMEOUT = 8000;

/** Stop whatever is speaking and return the token that owns the sound from now on. */
function stopSpeaking(): number {
  spokenToken += 1;
  const token = spokenToken;
  const cancel = cancelPronunciation;
  cancelPronunciation = null;
  cancel?.();
  // A callback may itself start a new pronunciation. Do not cancel that newer owner's sound.
  if (token !== spokenToken) return token;
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
  return token;
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
 * Every recording comes from uapis, keyless: one public media URL per accent.
 * The labeled IPA controls ask for exactly the accent on the button. Generic callers try the
 * reader's preferred accent first, then the other recording, before a synthesized fallback.
 */
function uapisAudioUrl(text: string, accent: PronunciationAccent): string {
  const params = new URLSearchParams({
    word: text,
    accent: accent === "UK" ? "uk" : "us",
  });
  return `https://uapis.cn/api/v1/dictionary/audio?${params.toString()}`;
}

function voiceUrls(text: string, preferredAccent: PronunciationAccent): string[] {
  const accents: PronunciationAccent[] = [preferredAccent, preferredAccent === "UK" ? "US" : "UK"];
  return accents.map((accent) => uapisAudioUrl(text, accent));
}

function playAudio(url: string, request: PronunciationRequest): Promise<PronunciationOutcome> {
  return new Promise((resolve) => {
    if (request.token !== spokenToken) {
      resolve("aborted");
      return;
    }
    if (typeof Audio === "undefined" || typeof document === "undefined" || !document.body) {
      resolve("failed");
      return;
    }
    const audio = document.createElement("audio");
    let disposed = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const cleanup = (pause: boolean) => {
      if (disposed) return;
      disposed = true;
      clearTimer();
      audio.removeEventListener("playing", onStarted);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
      if (request.cancelAttempt === cancel) request.cancelAttempt = null;
      if (currentAudio === audio) currentAudio = null;
      if (pause) {
        try {
          audio.pause();
        } catch {
          // Removal and request settlement must still happen if this engine cannot pause.
        }
      }
      audio.remove();
    };
    const cancel = () => {
      cleanup(true);
      resolve("aborted");
    };
    const onStarted = () => {
      if (disposed) return;
      if (request.token !== spokenToken) {
        cancel();
        return;
      }
      if (started) return;
      started = true;
      clearTimer();
      request.notify("started");
      resolve("started");
    };
    const fail = (result: "failed" | "aborted") => {
      if (disposed) return;
      const outcome = request.token === spokenToken ? result : "aborted";
      cleanup(true);
      resolve(outcome);
      // The promise already resolved on start; a later media error still reaches the button.
      if (started || outcome === "aborted") request.finish(outcome);
    };
    const onError = () => fail("failed");
    const onEnded = () => {
      if (disposed) return;
      onStarted();
      cleanup(false);
      request.finish();
    };
    request.cancelAttempt = cancel;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.style.display = "none";
    audio.src = url;
    audio.addEventListener("playing", onStarted);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    // A detached `Audio` element does not start on some Android WebViews - the very devices this
    // path exists for. In the document, hidden, it does.
    document.body.appendChild(audio);
    currentAudio = audio;
    if (request.accent) timer = setTimeout(onError, PRONUNCIATION_START_TIMEOUT);
    try {
      const playing = audio.play();
      if (playing && typeof playing.then === "function") {
        playing.then(onStarted, (error: unknown) => {
          fail((error as { name?: string } | null)?.name === "AbortError" ? "aborted" : "failed");
        });
      } else if (!request.accent) {
        // Older engines do not return a promise. Explicit accents wait for an actual playing event.
        onStarted();
      }
    } catch {
      fail("failed");
    }
  });
}

/**
 * Choose an English voice for the current preference. `lang = "en-US"` alone lets the engine keep its default voice,
 * and on an Android reader that default is often the system voice, which reads English with the
 * wrong sounds - the flat, robotic voice a reader notices next to the real recordings.
 */
function englishVoice(preferredAccent: PronunciationAccent, strict = false): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    if (voices.length === 0) return null; // Still loading: try again on the next tap.
    const score = (voice: SpeechSynthesisVoice) => {
      const lang = String(voice.lang ?? "").toLowerCase().replace(/_/g, "-");
      let value = 0;
      const matching = (preferredAccent === "UK" ? /^en-gb(?:-|$)/ : /^en-us(?:-|$)/).test(lang);
      if (strict && !matching) return 0;
      if (matching) value = 10;
      else if (/^en-(?:us|gb)(?:-|$)/.test(lang)) value = 5;
      else if (/^en(?:-|$)/.test(lang)) value = 3;
      if (value === 0) return 0;
      if (voice.localService) value += 1;
      if (/google|samantha|daniel|natural|enhanced|premium/i.test(voice.name ?? "")) value += 1;
      return value;
    };
    const best = voices
      .map((voice) => ({ voice, value: score(voice) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)[0];
    return best?.voice ?? null;
  } catch {
    return null;
  }
}

function speakWithSynthesis(spoken: string, request: PronunciationRequest): boolean {
  if (request.token !== spokenToken) return false;
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const synth = window.speechSynthesis;
    const voice = englishVoice(request.accent ?? request.preferredAccent, Boolean(request.accent));
    if (request.accent && !voice) return false;
    let disposed = false;
    let started = false;
    let utterance: SpeechSynthesisUtterance | null = null;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      disposed = true;
      clearTimeout(delay);
      clearTimeout(timer);
      if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
      if (request.cancelAttempt === cleanup) request.cancelAttempt = null;
    };
    const fail = (outcome: "failed" | "aborted") => {
      if (disposed) return;
      cleanup();
      if (request.token !== spokenToken) outcome = "aborted";
      else {
        try {
          synth.cancel();
        } catch {
          // The error outcome must still reach the button on a broken engine.
        }
      }
      request.finish(outcome);
    };
    const onStarted = () => {
      if (disposed) return;
      if (request.token !== spokenToken) {
        fail("aborted");
        return;
      }
      if (started) return;
      started = true;
      clearTimeout(timer);
      request.notify("started");
    };
    const start = () => {
      if (disposed) return;
      if (request.token !== spokenToken) {
        fail("aborted");
        return;
      }
      try {
        utterance = new SpeechSynthesisUtterance(spoken);
        if (voice) utterance.voice = voice;
        utterance.lang =
          request.accent === "UK" ? "en-GB" : request.accent === "US" ? "en-US" : voice?.lang ?? "en-US";
        utterance.rate = 0.9;
        utterance.onstart = onStarted;
        utterance.onend = () => {
          if (disposed) return;
          onStarted();
          cleanup();
          request.finish();
        };
        utterance.onerror = (event) =>
          fail(event.error === "canceled" || event.error === "interrupted" ? "aborted" : "failed");
        synth.speak(utterance);
        // Existing generic callers and older engine mocks accept speak() without an onstart event.
        if (!request.accent) onStarted();
      } catch {
        fail("failed");
      }
    };
    request.cancelAttempt = cleanup;
    if (request.accent) timer = setTimeout(() => fail("failed"), PRONUNCIATION_START_TIMEOUT);
    try {
      if (synth.paused) synth.resume();
      if (synth.speaking || synth.pending) {
        // Chrome on Android drops an utterance queued in the same task as cancel().
        synth.cancel();
        delay = setTimeout(start, 60);
      } else {
        start();
      }
    } catch {
      fail("failed");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit UK/US buttons use one matching uapis recording, never a different accent or fallback voice.
 * Generic callers keep the uapis recordings first, with the device voice as the last resort.
 * The uapis request is intentionally keyless; callers must not add credentials or rotate keys.
 *
 * One voice at a time. Every call stops what the previous one started: a tap speaks the word, and
 * when that word belongs to a phrase the phrase replaces it a moment later. Without the stop, the
 * word's `play()` rejects with `AbortError` (paused by the phrase), the old code took that for a
 * failure and spoke the word with the fallback voice, and both sounded at once.
 */
export function speakEnglish(text: string, options: PronunciationOptions = {}): boolean {
  const spoken = voiceText(text);
  if (!spoken || typeof window === "undefined") return false;

  const token = stopSpeaking();
  let finished = false;
  let lastOutcome: PronunciationOutcome | undefined;
  const notify = (outcome: PronunciationOutcome) => {
    if (finished || lastOutcome === outcome) return;
    lastOutcome = outcome;
    try {
      options.onOutcome?.(outcome);
    } catch {
      // UI observers must not break cleanup or start another fallback.
    }
  };
  const finish = (outcome?: PronunciationOutcome) => {
    if (finished) return;
    // Detach this owner before notifying: an observer may immediately start a new request.
    if (cancelPronunciation === cancel) cancelPronunciation = null;
    request.cancelAttempt?.();
    request.cancelAttempt = null;
    if (outcome) notify(outcome);
    finished = true;
  };
  const request: PronunciationRequest = {
    token,
    accent: options.accent,
    preferredAccent: usePrefs.getState().pronunciationAccent,
    cancelAttempt: null,
    notify,
    finish,
  };
  const cancel = () => finish("aborted");
  if (token !== spokenToken) {
    finish("aborted");
    return true;
  }
  cancelPronunciation = cancel;
  if (options.accent) {
    // One labeled accent maps to one uapis recording; never substitute another accent or a voice.
    void playAudio(uapisAudioUrl(spoken, options.accent), request).then((outcome) => {
      if (finished || token !== spokenToken) {
        finish("aborted");
      } else if (outcome !== "started") {
        finish(outcome);
      }
    });
    return true;
  }
  void (async () => {
    try {
      for (const url of voiceUrls(spoken, request.preferredAccent)) {
        if (finished || token !== spokenToken) {
          finish("aborted");
          return;
        }
        const result = await playAudio(url, request);
        if (finished || token !== spokenToken || result === "aborted") {
          finish("aborted");
          return;
        }
        if (result === "started") return;
      }
      if (finished || token !== spokenToken) finish("aborted");
      else if (!speakWithSynthesis(spoken, request)) finish("failed");
    } catch {
      finish(token === spokenToken ? "failed" : "aborted");
    }
  })();
  return true;
}

export function useSpeak(
  accent?: PronunciationAccent,
  onOutcome?: (outcome: PronunciationOutcome) => void,
) {
  const [playback, setPlayback] = useState<{
    text: string;
    accent?: PronunciationAccent;
    outcome: "idle" | "loading" | PronunciationOutcome;
  }>({ text: "", outcome: "idle" });
  const alive = useRef(true);
  const requestId = useRef(0);
  const observer = useRef(onOutcome);
  observer.current = onOutcome;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestId.current += 1;
      // Do not globally stop here: another mounted button may already own the newer sound.
    };
  }, []);

  function reset() {
    requestId.current += 1;
    if (alive.current) setPlayback({ text: "", accent, outcome: "idle" });
  }
  function play(text: string) {
    const id = ++requestId.current;
    if (alive.current) setPlayback({ text, accent, outcome: "loading" });
    const update = (outcome: PronunciationOutcome) => {
      if (!alive.current || id !== requestId.current) return;
      setPlayback({ text, accent, outcome });
      observer.current?.(outcome);
    };
    const ok = speakEnglish(text, { accent, onOutcome: update });
    if (!ok) update("failed");
  }
  const outcome = playback.accent === accent ? playback.outcome : "idle";
  return {
    status: outcome === "failed" ? ("error" as const) : ("idle" as const),
    playbackStatus: outcome,
    playedText: playback.text,
    play,
    reset,
  };
}

export function SpeakButton({
  text,
  label,
  className,
  compact = false,
  accent,
  onOutcome,
}: {
  text: string;
  label?: string;
  className?: string;
  /** Icon only: accents use a text-sized icon; generic controls keep the round button. */
  compact?: boolean;
  accent?: PronunciationAccent;
  onOutcome?: (outcome: PronunciationOutcome) => void;
}) {
  const { t } = useT();
  const { playbackStatus, playedText, play, reset } = useSpeak(accent, onOutcome);
  useEffect(() => {
    reset();
    // Changing the visible word invalidates feedback, but must not stop a newer button's audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, accent]);
  const outcome = playedText === text ? playbackStatus : "idle";
  const failed = outcome === "failed";
  const name =
    label ?? (accent ? t(accent === "UK" ? "ipa.listenUk" : "ipa.listenUs") : t("common.listen"));
  const failure = accent
    ? t(accent === "UK" ? "ipa.audioFailedUk" : "ipa.audioFailedUs")
    : t("common.noSound");
  const button = (
    <button
      type="button"
      onClick={() => play(text)}
      aria-label={`${name}: ${text}`}
      title={failed ? failure : name}
      className={cn(
        compact
          ? accent
            ? "grid size-11 place-items-center rounded transition-colors hover:bg-accent-soft"
            : "grid size-10 place-items-center rounded-full border border-accent/25 bg-accent-soft transition-colors hover:bg-accent hover:text-accent-ink shadow-2xs"
          : "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line/60 px-3 text-sm font-semibold transition-colors hover:bg-accent-soft",
        failed ? "text-warn" : "text-accent",
        className,
      )}
      data-speak
      data-speak-accent={accent}
      data-speak-status={outcome}
    >
      <Volume2 className={compact ? accent ? "size-[1em]" : "size-5" : "size-[1.1rem]"} aria-hidden />
      {compact ? null : failed ? failure : name}
    </button>
  );
  if (!accent) return button;
  return (
    <span data-speak-control className="inline-flex max-w-full flex-col items-start">
      {button}
      {failed ? (
        <span data-speak-error role="status" className="max-w-full text-xs text-warn">
          {failure}
        </span>
      ) : null}
    </span>
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
      className={cn("h-0.5 overflow-hidden bg-line", className)}
    >
      <div
        className="h-full bg-accent transition-[width] duration-300"
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
    <dl className="grid grid-cols-2 overflow-hidden rounded-2xl bg-card sm:grid-cols-4 [&>div]:border-line/60 max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(even)]:border-l sm:[&>div:not(:first-child)]:border-l">
      {items.map((item) => (
        <div key={item.label} className="grid content-start gap-1 p-4 sm:p-5">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd
            className={cn(
              "text-2xl leading-none font-semibold tabular-nums tracking-tight sm:text-3xl",
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
          ? "grid grid-cols-2 gap-1.5 sm:flex sm:gap-0 sm:divide-x sm:divide-line sm:overflow-hidden sm:rounded sm:border sm:border-edge"
          : "flex divide-x divide-line overflow-hidden rounded border border-edge",
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 min-w-16 px-3 text-sm transition-colors duration-100",
            wrap
              ? "rounded border border-edge whitespace-normal sm:flex-1 sm:rounded-none sm:border-0 sm:whitespace-nowrap"
              : "flex-1 whitespace-nowrap",
            option.value === value ? "bg-accent-soft font-bold text-accent" : "text-muted hover:bg-sheet hover:text-ink",
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
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <AlertDialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-paper p-5 text-ink shadow-lift ">
          <AlertDialog.Title className="text-lg font-semibold">
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
