import { ChevronDown, Lightbulb, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { paragraphBlocks } from "@/lib/help-lookup";
import { useT } from "@/lib/i18n";
import { loadSentenceView, type ParagraphView, type SentenceView } from "@/lib/help-flow";
import { btn, cn } from "@/components/ui";
import { flowText } from "@/lib/flow-text";
import { SIDE_PANEL } from "@/components/side-panel";

/*
 * Help for paragraphs and sentences. Everything here is an overlay (position: fixed):
 * nothing is added to the reading text, so the text can never move when help opens.
 */

/* ------------------------------------------------------------------ marker next to a paragraph */

const wordCount = (text: string | null) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;

type Block = { el: Element; ok: boolean };
type Geo = {
  marker: { top: number; left: number; edge: boolean } | null;
  bar: { top: number; height: number; left: number; faint: boolean } | null;
};

/**
 * One small button, drawn in the margin next to a paragraph (or, when the screen has no
 * room in the margin, as a thin tab on the screen edge). It is position: fixed, so it takes
 * no room in the page. With a mouse it follows the paragraph under the pointer or the focused
 * word. On a touch screen it belongs to the paragraph at the reading line (about 40% down).
 * While help is open, a thin bar in the margin shows which paragraph it is about.
 */
export function ParagraphMarker({
  articleRef,
  version,
  activeIndex,
  hide,
  onOpen,
}: {
  articleRef: React.RefObject<HTMLElement | null>;
  /** changes when the chapter text changes */
  version: unknown;
  activeIndex: number | null;
  /** hide the button (a card or the help panel is open) */
  hide: boolean;
  onOpen: (index: number) => void;
}) {
  const { t } = useT();
  const blocks = useRef<Block[]>([]);
  const hover = useRef<number | null>(null);
  const focus = useRef<number | null>(null);
  const active = useRef<number | null>(activeIndex);
  active.current = activeIndex;
  const hidden = useRef(hide);
  hidden.current = hide;
  const canHover = useRef(true);
  const frame = useRef(0);
  const [markerIndex, setMarkerIndex] = useState<number | null>(null);
  const [geo, setGeo] = useState<Geo>({ marker: null, bar: null });

  const measure = useCallback(() => {
    frame.current = 0;
    const art = articleRef.current;
    if (!art) return;
    const ar = art.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const room = vw - ar.right >= 52;

    let index: number | null = null;
    if (canHover.current) index = hover.current ?? focus.current;
    else {
      const line = vh * 0.4;
      let after: number | null = null;
      let last: number | null = null;
      for (let i = 0; i < blocks.current.length; i += 1) {
        const block = blocks.current[i];
        if (!block?.ok) continue;
        const r = block.el.getBoundingClientRect();
        if (r.bottom < 56) continue;
        if (r.top <= line && r.bottom >= line) {
          index = i;
          break;
        }
        if (r.top > line) {
          after = i;
          break;
        }
        last = i;
      }
      if (index === null) index = after ?? last;
    }

    let marker: Geo["marker"] = null;
    if (index !== null) {
      const el = blocks.current[index]?.el;
      const r = el?.getBoundingClientRect();
      if (r && r.bottom > 64 && r.top < vh - 8) {
        if (room) {
          const top = Math.min(Math.max(r.top, 64) + 2, vh - 44);
          if (r.bottom - top > 24)
            marker = { top: Math.round(top), left: Math.round(ar.right + 10), edge: false };
        } else {
          marker = { top: 0, left: 0, edge: true };
        }
      }
    }
    let bar: Geo["bar"] = null;
    const a = active.current ?? (!canHover.current && !hidden.current ? index : null);
    if (a !== null) {
      const r = blocks.current[a]?.el.getBoundingClientRect();
      if (r && r.bottom > 56 && r.top < vh) {
        const top = Math.max(r.top, 56);
        bar = {
          top: Math.round(top),
          height: Math.round(Math.min(r.bottom, vh) - top),
          left: Math.round(Math.max(4, ar.left - 10)),
          faint: active.current === null,
        };
      }
    }
    const next: Geo = { marker, bar };
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setMarkerIndex((prev) => (prev === index ? prev : index));
  }, [articleRef]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(measure);
  }, [measure]);

  // The paragraph list: numbered with the shared rule (the same as the word lists use).
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    blocks.current = paragraphBlocks(root).map((el) => ({
      el,
      ok: /^(P|BLOCKQUOTE|LI|DIV)$/.test(el.tagName) && wordCount(flowText(el)) >= 8,
    }));
    hover.current = null;
    focus.current = null;
    schedule();
  }, [articleRef, version, schedule]);

  useEffect(() => {
    canHover.current =
      typeof window.matchMedia === "function" ? window.matchMedia("(hover: hover)").matches : true;
    const indexAt = (x: number, y: number): number | null => {
      const art = articleRef.current;
      if (!art) return null;
      const ar = art.getBoundingClientRect();
      if (x < ar.left - 8 || x > ar.right + 70) return null;
      let best: number | null = null;
      let bestGap = 24;
      for (let i = 0; i < blocks.current.length; i += 1) {
        const block = blocks.current[i];
        if (!block?.ok) continue;
        const r = block.el.getBoundingClientRect();
        if (r.top > y + 30) break;
        const gap = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
          if (gap === 0) break;
        }
      }
      return best;
    };
    const onMove = (event: MouseEvent) => {
      if (!canHover.current) return;
      const target = event.target as Element | null;
      if (target?.closest?.("header, aside, [role='dialog']")) {
        if (hover.current !== null) {
          hover.current = null;
          schedule();
        }
        return;
      }
      const next = indexAt(event.clientX, event.clientY);
      if (next !== hover.current) {
        hover.current = next;
        schedule();
      }
    };
    const indexOfNode = (node: Element | null) => {
      if (!node) return null;
      const at = blocks.current.findIndex((b) => b.ok && b.el.contains(node));
      return at < 0 ? null : at;
    };
    const art = articleRef.current;
    const onFocusIn = (event: FocusEvent) => {
      focus.current = indexOfNode(event.target as Element | null);
      schedule();
    };
    const onFocusOut = () => {
      focus.current = null;
      schedule();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    art?.addEventListener("focusin", onFocusIn);
    art?.addEventListener("focusout", onFocusOut);
    const observer = art ? new ResizeObserver(schedule) : null;
    if (art) observer?.observe(art);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      art?.removeEventListener("focusin", onFocusIn);
      art?.removeEventListener("focusout", onFocusOut);
      observer?.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [articleRef, schedule, version]);

  // The bar and the button follow the page when help opens or closes.
  useEffect(() => {
    schedule();
  }, [activeIndex, hide, schedule]);

  const showMarker = !hide && geo.marker && markerIndex !== null;
  return (
    <>
      {geo.bar ? (
        <div
          aria-hidden
          data-para-ui
          className={cn(
            "pointer-events-none fixed z-20 w-[3px] rounded-full bg-accent",
            geo.bar.faint && "opacity-35",
          )}
          style={{ top: geo.bar.top, height: geo.bar.height, left: geo.bar.left }}
        />
      ) : null}
      {showMarker && geo.marker ? (
        <button
          type="button"
          data-para-ui
          data-para-marker={markerIndex}
          aria-label={t("hp.simplifyAria")}
          title={t("hp.simplifyAria")}
          data-fab={geo.marker.edge ? "1" : undefined}
          onClick={() => {
            if (markerIndex !== null) onOpen(markerIndex);
          }}
          className={cn(
            "fixed z-20 inline-flex items-center justify-center border border-line bg-card text-accent shadow-sm transition-colors hover:bg-accent-soft",
            geo.marker.edge
              ? "right-3 bottom-5 h-11 gap-1.5 rounded-full px-3.5 text-sm font-semibold shadow-pop"
              : "size-9 rounded-full",
          )}
          style={geo.marker.edge ? undefined : { top: geo.marker.top, left: geo.marker.left }}
        >
          <Lightbulb className="size-[1.1rem]" aria-hidden />
          {geo.marker.edge ? t("hp.simplifyShort") : null}
        </button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ paragraph panel */

export type ParagraphPanelState =
  { status: "loading" } | { status: "none" } | { status: "ready"; view: ParagraphView };

export function ParagraphPanel({
  state,
  onClose,
  onWord,
}: {
  state: ParagraphPanelState;
  onClose: () => void;
  onWord: (word: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <aside
      aria-label={t("hp.panelAria")}
      data-para-panel
      className={cn(
        "fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop",
        "anim-sheet inset-x-0 bottom-0 max-h-[52dvh] rounded-t-3xl border-t pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        SIDE_PANEL,
        "md:bottom-auto md:max-h-[calc(100dvh-6.5rem)] md:pb-5",
      )}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden" aria-hidden />
      <div className="grid gap-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="font-display text-xl leading-tight font-semibold">{t("hp.title")}</h2>
          </div>
          <button
            type="button"
            className={cn(btn.icon, "-mt-2 -mr-2")}
            onClick={onClose}
            aria-label={t("hp.close")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {state.status === "loading" ? (
          <div className="grid gap-2" aria-busy="true" aria-label={t("hp.lookingAria")}>
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-line" />
            <p className="text-sm text-muted">{t("hp.looking")}</p>
          </div>
        ) : state.status === "none" ? (
          <p
            className="rounded-lg bg-accent-soft px-3 py-2.5 text-[0.95rem] leading-snug"
            role="status"
          >
            {t("hp.noPara")}
          </p>
        ) : (
          <>
            <section className="grid gap-1" aria-label={t("hp.mainIdea")}>
              <h3 className="text-xs font-semibold text-muted">{t("hp.mainIdea")}</h3>
              <p className="text-[1.05rem] leading-relaxed" lang="en" data-part="main-idea">
                {state.view.mainIdea}
              </p>
            </section>

            <section className="grid gap-1.5" aria-label={t("hp.simple")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="-mx-1 flex min-h-11 items-center justify-between gap-2 rounded-lg px-1 text-left text-sm font-semibold text-accent hover:bg-accent-soft/60"
              >
                <span>{t("hp.simple")}</span>
                <span className="flex items-center gap-1 font-normal text-muted">
                  {open ? t("common.hide") : t("common.show")}
                  <ChevronDown
                    className={cn("size-4 transition-transform", open && "rotate-180")}
                    aria-hidden
                  />
                </span>
              </button>
              {open ? (
                <p className="text-[1.02rem] leading-relaxed" lang="en" data-part="simple">
                  {state.view.simple}
                </p>
              ) : null}
            </section>

            {state.view.hardWords.length > 0 ? (
              <section className="grid gap-1.5" aria-label={t("hp.hardWords")}>
                <h3 className="text-xs font-semibold text-muted">{t("hp.hardHint")}</h3>
                <div className="flex flex-wrap gap-2">
                  {state.view.hardWords.map((word) => (
                    <button
                      key={word}
                      type="button"
                      data-hard-word={word}
                      onClick={() => onWord(word)}
                      lang="en"
                      className="min-h-10 rounded-full border border-line px-3.5 text-[0.95rem] font-medium hover:bg-accent-soft"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        <p className="border-t border-line pt-3 text-xs leading-snug text-muted">
          {t("hp.footer")}
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ explain a sentence (inside the word card) */

export function ExplainSentence({
  bookId,
  chapter,
  sentence,
}: {
  bookId: string;
  chapter: number;
  sentence: string;
}) {
  const { t } = useT();
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "none" }
    | { status: "ready"; view: SentenceView }
  >({ status: "idle" });
  const alive = useRef(true);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.status === "ready" || state.status === "none") {
      box.current?.scrollIntoView({ block: "nearest" });
    }
  }, [state.status]);

  function run() {
    setState({ status: "loading" });
    void loadSentenceView({ bookId, chapter, text: sentence }).then((view) => {
      if (!alive.current) return;
      setState(view ? { status: "ready", view } : { status: "none" });
    });
  }

  return (
    <div className="grid gap-2" data-explain>
      {state.status === "idle" ? (
        <button
          type="button"
          className={cn(btn.quiet, "min-h-10 self-start text-sm")}
          onClick={run}
        >
          <Lightbulb className="size-4 text-accent" aria-hidden />
          {t("hp.explain")}
        </button>
      ) : null}
      <div ref={box} className="grid gap-2" aria-live="polite">
        {state.status === "loading" ? (
          <div className="grid gap-2" aria-busy="true">
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <p className="text-sm text-muted">{t("hp.lookingSentence")}</p>
          </div>
        ) : null}
        {state.status === "none" ? (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm leading-snug" role="status">
            {t("hp.noSent")}
          </p>
        ) : null}
        {state.status === "ready" ? (
          <div className="grid gap-2.5 rounded-lg border border-line px-3 py-2.5">
            <span className="text-xs font-semibold text-muted">{t("hp.explain")}</span>
            <section className="grid gap-0.5" aria-label={t("hp.easier")}>
              <h4 className="text-xs font-semibold text-muted">{t("hp.easier")}</h4>
              <p className="text-[0.98rem] leading-relaxed" lang="en" data-part="easier">
                {state.view.simple}
              </p>
            </section>
            <section className="grid gap-0.5" aria-label={t("hp.grammar")}>
              <h4 className="text-xs font-semibold text-muted">{t("hp.grammar")}</h4>
              <p className="text-sm leading-snug" lang="en" data-part="grammar">
                {state.view.grammar}
              </p>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
