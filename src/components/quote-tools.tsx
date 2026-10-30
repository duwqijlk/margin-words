import { Check, Quote, Undo2 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flowText } from "@/lib/flow-text";
import { useT } from "@/lib/i18n";
import { QUOTES_PER_BOOK } from "@/lib/limits";
import { joinSpans, makeQuote } from "@/lib/quote-model";
import { drawSpans, flashSpan, markLayer, sentenceAtPoint, type QuoteSpan } from "@/lib/quote-marks";
import { useQuotes } from "@/lib/quote-store";
import { readerParagraphBlocks } from "@/lib/reader-anchor";
import { btn, cn } from "@/components/ui";

export type QuoteToolsHandle = {
  /** Keep these spans of the page as quotes (joined where they touch), light them up, say so. */
  keep: (spans: QuoteSpan[]) => void;
  /** A short note in the same place ("Copied"). */
  note: (text: string) => void;
};

type Toast = { id: number; text: string; undo?: string[] };

/**
 * Quotes in the reader (design system SelectionBar, pick mode): pick mode itself, where a tap picks
 * a whole sentence instead of opening a word (taps go to this layer first and never reach the
 * words), the bar at the bottom with the count, Cancel and Keep, and the note after keeping, with
 * Undo. The selection bar (passage-feedback.tsx) keeps quotes through `keep`.
 */
export const QuoteTools = forwardRef<
  QuoteToolsHandle,
  {
    rootRef: { readonly current: HTMLElement | null };
    /** Changes with the page on screen: picks never carry over to another chapter. */
    pageKey: string;
    /** Changes when the text is laid out again (font, size, width): the marks are drawn again. */
    layoutKey: string;
    book: { key: string; title: string; author: string } | null;
    chapter: number;
    chapterTitle: string;
    picking: boolean;
    onPickingChange: (on: boolean) => void;
  }
>(function QuoteTools({ rootRef, pageKey, layoutKey, book, chapter, chapterTitle, picking, onPickingChange }, ref) {
  const { t, tn } = useT();
  const [picks, setPicks] = useState<QuoteSpan[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);

  const say = useCallback((text: string, undo?: string[]) => {
    toastId.current += 1;
    setToast({ id: toastId.current, text, ...(undo ? { undo } : {}) });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((now) => (now?.id === toast.id ? null : now)), toast.undo ? 5000 : 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const keep = useCallback(
    (spans: QuoteSpan[]) => {
      const root = rootRef.current;
      if (!root || !book || chapter < 0 || spans.length === 0) return;
      const blocks = readerParagraphBlocks(root);
      const textOf = (paragraph: number) => flowText(blocks[paragraph]);
      const joined = joinSpans(spans, (paragraph, from, to) => textOf(paragraph).slice(from, to));
      const now = Date.now();
      const quotes = joined
        .filter((span) => span.end > span.start && textOf(span.paragraph))
        .map((span, index) =>
          makeQuote({
            book: book.key,
            title: book.title,
            author: book.author,
            chapter,
            chapterTitle,
            paragraph: span.paragraph,
            text: textOf(span.paragraph),
            start: span.start,
            end: span.end,
            now: now + index,
          }),
        );
      if (quotes.length === 0) return;
      const result = useQuotes.getState().add(quotes);
      if (result === "full") {
        say(t("quote.full", { n: QUOTES_PER_BOOK }));
        return;
      }
      for (const span of joined) flashSpan(root, span);
      if (result === "same") {
        say(t("quote.already"));
        return;
      }
      say(quotes.length > 1 ? tn("quote.keptMany", quotes.length) : t("quote.kept"), quotes.map((quote) => quote.id));
    },
    [rootRef, book, chapter, chapterTitle, say, t, tn],
  );

  useImperativeHandle(ref, () => ({ keep, note: (text: string) => say(text) }), [keep, say]);

  // Another chapter, or pick mode turned off: nothing stays picked.
  useEffect(() => setPicks([]), [pageKey, picking]);

  // Taps in pick mode pick sentences. Captured before the page's own handlers, so a word is not looked up.
  useEffect(() => {
    if (!picking) return;
    const onClick = (event: MouseEvent) => {
      const root = rootRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (!root || !target || !root.contains(target)) return;
      if (target.closest("[data-para-ui], [role='dialog']")) return;
      event.preventDefault();
      event.stopPropagation();
      const span = sentenceAtPoint(root, target, event.clientX, event.clientY);
      if (!span) return;
      setPicks((now) => {
        const at = now.findIndex((item) => item.paragraph === span.paragraph && item.start === span.start);
        return at >= 0 ? now.filter((_, index) => index !== at) : [...now, span];
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [picking, rootRef]);

  // Esc leaves pick mode.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPickingChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, onPickingChange]);

  // The picked sentences, washed in green, drawn again whenever the text moves.
  useEffect(() => {
    const root = rootRef.current;
    if (!picking || !root || picks.length === 0) return;
    const layer = markLayer();
    const draw = () => drawSpans(layer, root, picks, "quote-mark");
    draw();
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(draw);
      observer.observe(root);
    } catch {
      // Older engines: the resize listener below still redraws.
    }
    window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", draw);
      layer.remove();
    };
  }, [picking, picks, rootRef, layoutKey]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {picking ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 sm:bottom-4 sm:mx-auto sm:max-w-md"
          data-para-ui
          data-pick-bar
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-t-2xl border-t border-float-edge bg-float py-3 pr-3.5 pb-[calc(12px+env(safe-area-inset-bottom))] pl-4 text-ink shadow-pop sm:rounded-2xl sm:border sm:pb-3">
            <span className="min-w-0 text-sm text-muted" role="status" data-pick-count={picks.length}>
              {picks.length > 0 ? tn("quote.picked", picks.length) : t("quote.pickHint")}
            </span>
            <button type="button" className={cn(btn.ghost, "min-h-10")} onClick={() => onPickingChange(false)} data-pick-cancel>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={cn(btn.primary, "min-h-10")}
              disabled={picks.length === 0}
              onClick={() => {
                const chosen = picks;
                onPickingChange(false);
                keep(chosen);
              }}
              data-pick-save
            >
              <Quote className="size-4" aria-hidden />
              {t("quote.keepShort")}
            </button>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "toast-in fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded bg-ink py-2.5 pr-2.5 pl-4 text-sm text-paper shadow-lift",
            picking ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]",
          )}
          data-quote-toast
        >
          <Check className="size-4 shrink-0 text-accent-soft" strokeWidth={3} aria-hidden />
          <p className="m-0 min-w-0 flex-1 leading-snug">{toast.text}</p>
          {toast.undo ? (
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded px-3 font-bold text-mark hover:bg-paper/15"
              onClick={() => {
                useQuotes.getState().remove(toast.undo ?? []);
                setToast(null);
              }}
              data-quote-undo
            >
              <Undo2 className="size-4" aria-hidden />
              {t("discover.undo")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
});
