import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, MessageSquareText, Quote, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { PASSAGE_NOTE_MAX, SUGGESTION_MAX } from "@/lib/limits";
import { readPassage, type PassagePick } from "@/lib/passage-pick";
import { sentenceSpans, sentencesOf } from "@/lib/quote-model";
import { spanRange, type QuoteSpan } from "@/lib/quote-marks";
import { cn } from "@/components/ui";

type PassageReason = "hard" | "phrase" | "wrong" | "suggested";

/** A selection of more sentences than this, or more characters, is kept as its whole paragraph. */
const WHOLE_SENTENCES = 3;
const WHOLE_CHARS = 500;
/** Leave short word groups precise for feedback; only longer passages snap to whole sentences. */
const SNAP_WORDS = 12;

function finePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
}

/** What "keep" keeps for a selection: its whole sentences, or the whole paragraph when it is long. */
function quoteSpanOf(pick: Pick<PassagePick, "paragraph" | "start" | "end" | "text">): QuoteSpan & { whole: boolean } {
  const span = sentencesOf(pick.text, pick.start, pick.end);
  const inside = sentenceSpans(pick.text).filter((item) => item.end > span.start && item.start < span.end).length;
  if (inside > WHOLE_SENTENCES || span.end - span.start > WHOLE_CHARS)
    return { paragraph: pick.paragraph, start: 0, end: pick.text.length, whole: true };
  return { paragraph: pick.paragraph, ...span, whole: false };
}

/**
 * The selection bar (design system SelectionBar): a dark bar by a selection inside one paragraph.
 * Its first button keeps the selection as a quote (its whole sentences; the whole paragraph when it
 * is long), then Copy, then "Ask about this", which opens the card that sends the selected words
 * with their place (chapter, paragraph, a few words around) to /api/feedback/passage. On a wide
 * screen only a longer passage snaps to whole sentences; short feedback selections stay exact.
 * Taps on single words are untouched: those open the word card.
 */
/** Widest the open card gets (22rem), and the gap it keeps from each screen edge. */
const CARD_MAX = 352;
const EDGE = 12;

export function PassageFeedback({
  rootRef,
  bookId,
  bookTitle,
  chapter,
  chapters,
  catalogId,
  glossaryRev,
  enabled,
  onQuote,
  onCopied,
}: {
  /** The page's article. A ref, because the article is mounted after the first render. */
  rootRef: { readonly current: HTMLElement | null };
  bookId: string;
  bookTitle?: string;
  chapter: number;
  /** How many chapters this copy of the book has, so a chapter number can be checked. */
  chapters?: number;
  /** The catalog book, `<catalog>:<id>` (src/lib/catalog-id.ts); "" for a list the reader added. */
  catalogId?: string;
  glossaryRev?: string;
  /** False while a word card or a help panel is open, or for a chapter with no fixed number. */
  enabled: boolean;
  /** Keep the span as a quote; absent where quotes cannot be kept (a book not on the shelf). */
  onQuote?: (span: QuoteSpan) => void;
  onCopied?: () => void;
}) {
  const { t } = useT();
  const [pick, setPick] = useState<PassagePick | null>(null);
  const [crossed, setCrossed] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PassageReason | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const openRef = useRef(false);
  openRef.current = open;
  // A few words get a short meaning, like a word card; a sentence or more gets room to explain.
  const noteMax = pick?.span === "sentence" ? PASSAGE_NOTE_MAX : Math.max(SUGGESTION_MAX, 300);

  useEffect(() => {
    if (!enabled) {
      setPick(null);
      setCrossed(null);
      return;
    }
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      // Wait for the drag to settle; a phone moves the handles many times a second.
      timer = window.setTimeout(() => {
        const root = rootRef.current;
        if (openRef.current || !root) return;
        const found = readPassage(root);
        if (!found) {
          setPick(null);
          setCrossed(null);
        } else if ("crossed" in found) {
          setPick(null);
          setCrossed({ x: found.x, y: found.y });
        } else {
          setCrossed(null);
          setPick(found);
        }
      }, 250);
    };
    document.addEventListener("selectionchange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", update);
    };
  }, [enabled, rootRef]);

  // Long mouse selections become whole sentences; short phrases remain precise for feedback.
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onUp = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !finePointer() || !(event.target instanceof Node) || !root.contains(event.target)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (openRef.current) return;
        const found = readPassage(root);
        if (!found || "crossed" in found) return;
        if (found.selected.split(/\s+/).length < SNAP_WORDS) return;
        const span = sentencesOf(found.text, found.start, found.end);
        if (span.start === found.start && span.end === found.end) return;
        const range = spanRange(found.block, span.start, span.end);
        const selection = window.getSelection();
        if (!range || !selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
      }, 0);
    };
    document.addEventListener("mouseup", onUp);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseup", onUp);
    };
  }, [enabled, rootRef]);

  // A new chapter or book starts clean.
  useEffect(() => {
    setPick(null);
    setCrossed(null);
    setOpen(false);
  }, [bookId, chapter]);

  function close() {
    setOpen(false);
    setPick(null);
    setReason(null);
    setText("");
    setState("idle");
    window.getSelection()?.removeAllRanges();
  }

  async function send() {
    if (!pick || state === "sending") return;
    const suggestion = text.trim().slice(0, noteMax);
    const why: PassageReason = reason ?? "suggested";
    if (why === "suggested" && !suggestion) return;
    setState("sending");
    try {
      const response = await fetch("/api/feedback/passage", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookId,
          bookTitle,
          ...(catalogId ? { catalogId } : {}),
          chapter,
          chapters,
          paragraph: pick.paragraph,
          start: pick.start,
          end: pick.end,
          span: pick.span,
          selected: pick.selected,
          before: pick.before,
          after: pick.after,
          reason: why,
          glossaryRev,
          ...(suggestion ? { suggestion } : {}),
        }),
      });
      setState(response.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (typeof document === "undefined") return null;
  const place = open ? pick : (pick ?? crossed);
  if (!place) return null;
  // Under the selection, so it never sits on the phone's own copy menu (that opens above it).
  // Centred on the selection but kept on screen: the open card is as wide as the screen allows
  // (CARD_MAX, less a margin each side), so its centre must stay half that width plus the margin
  // from either edge. A fixed 150px let a 352px card hang 26px off a 390px phone.
  const screenWidth = document.documentElement.clientWidth;
  const cardWidth = Math.min(CARD_MAX, screenWidth - 2 * EDGE);
  const half = open ? cardWidth / 2 + EDGE : 150;
  const style = {
    left: Math.min(Math.max(place.x, window.scrollX + half), window.scrollX + screenWidth - half),
    top: place.y + 10,
    ...(open ? { width: cardWidth } : {}),
  };

  if (!open) {
    // Above the selection with a mouse (design system SelectionBar); under it on touch, so it never
    // sits on the phone's own copy menu (that opens above it).
    const above = finePointer() && pick !== null && pick.top - window.scrollY > 72;
    const keep = pick && onQuote ? quoteSpanOf(pick) : null;
    const copy = async () => {
      if (!pick) return;
      try {
        await navigator.clipboard.writeText(pick.selected);
      } catch {
        document.execCommand("copy");
      }
      window.getSelection()?.removeAllRanges();
      setPick(null);
      onCopied?.();
    };
    const barButton =
      "inline-flex min-h-10 items-center gap-1.5 px-3 text-[13px] font-bold whitespace-nowrap text-paper hover:bg-paper/15 [&+&]:shadow-[-1px_0_0_rgb(var(--paper-rgb)/0.16)]";
    return createPortal(
      <div
        className={cn("absolute z-40 -translate-x-1/2", above && "-translate-y-full")}
        style={{ ...style, top: above && pick ? pick.top - 10 : style.top }}
        data-para-ui
        data-passage-ui
      >
        {pick ? (
          <div
            role="toolbar"
            aria-label={t("quote.barAria")}
            className="flex overflow-hidden rounded-xl bg-ink p-1 shadow-lift"
            // Keep the selection: a press would clear it before the click.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            data-selection-bar
          >
            {keep ? (
              <button
                type="button"
                className={cn(barButton, "rounded-lg text-mark")}
                onClick={() => {
                  window.getSelection()?.removeAllRanges();
                  setPick(null);
                  onQuote?.({ paragraph: keep.paragraph, start: keep.start, end: keep.end });
                }}
                data-quote-keep={keep.whole ? "whole" : "sentence"}
              >
                <Quote className="size-4" aria-hidden />
                {keep.whole ? t("quote.keepWhole") : t("quote.keep")}
              </button>
            ) : null}
            <button type="button" className={barButton} onClick={() => void copy()} data-quote-copy>
              <Copy className="size-4" aria-hidden />
              {t("quote.copy")}
            </button>
            {!pick.long ? (
              <button type="button" className={barButton} onClick={() => setOpen(true)} data-passage-ask>
                <MessageSquareText className="size-4" aria-hidden />
                {t("passage.ask")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded bg-ink/85 px-3 py-1.5 text-xs text-paper shadow-lift" role="status" data-passage-crossed>
            {t("passage.oneParagraph")}
          </p>
        )}
      </div>,
      document.body,
    );
  }

  const reasonButton = (value: Exclude<PassageReason, "suggested">, label: string) => (
    <button
      type="button"
      onClick={() => setReason((now) => (now === value ? null : value))}
      aria-pressed={reason === value}
      className={cn(
        "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
        reason === value
          ? "border-accent bg-accent text-accent-ink"
          : "border-line/60 bg-card text-ink/80 hover:border-line hover:text-ink",
      )}
      data-passage-reason={value}
    >
      {label}
    </button>
  );
  const canSend = state !== "sending" && (reason !== null || text.trim().length > 0);

  return createPortal(
    <div
      className="absolute z-40 -translate-x-1/2 rounded-2xl border border-float-edge bg-float p-4 text-ink shadow-lift"
      style={style}
      role="dialog"
      aria-label={t("passage.title")}
      data-para-ui
      data-passage-card
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{t("passage.title")}</p>
        <button
          type="button"
          className="-mt-1 -mr-1 grid size-8 place-items-center rounded-lg text-muted hover:text-ink"
          onClick={close}
          aria-label={t("common.close")}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <blockquote
        className="mt-2 line-clamp-3 border-l-2 border-line pl-2.5 text-sm text-muted italic"
        lang="en"
        data-passage-selected
      >
        {pick?.selected}
      </blockquote>
      {state === "done" ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" role="status" data-passage-thanks>
          <Check className="size-3.5" aria-hidden />
          {t("passage.thanks")}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {reasonButton("hard", t("passage.hard"))}
            {reasonButton("phrase", t("passage.phrase"))}
            {reasonButton("wrong", t("passage.wrong"))}
          </div>
          <textarea
            // 16px on phones: iOS Safari zooms the whole page into a smaller field and stays zoomed.
            className="mt-3 min-h-16 w-full resize-none rounded-lg border border-line/80 bg-card px-2.5 py-2 text-base text-ink sm:text-sm placeholder:text-muted/60 focus:border-accent focus:outline-none"
            value={text}
            maxLength={noteMax}
            rows={pick?.span === "sentence" ? 4 : 2}
            placeholder={t("passage.placeholder")}
            aria-label={t("passage.placeholder")}
            onChange={(event) => setText(event.target.value.slice(0, noteMax))}
            data-passage-text
          />
          <div className="mt-1 flex items-center justify-between gap-2 text-[0.7rem] text-muted">
            <span>{state === "error" ? t("passage.error") : t("passage.hint")}</span>
            <span className="tabular-nums">
              {[...text].length}/{noteMax}
            </span>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void send()}
              className="inline-flex min-h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
              data-passage-send
            >
              {state === "sending" ? t("account.working") : t("card.feedbackSend")}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
