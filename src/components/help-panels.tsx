import { ChevronDown, Lightbulb, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getParagraphNoteFlags, paragraphBlocks } from "@/lib/help-lookup";
import { useT } from "@/lib/i18n";
import { loadSentenceView, type ParagraphHelpView, type SentenceInParagraph } from "@/lib/help-flow";
import { FloatingAside } from "@/components/floating-card";
import { btn, cn } from "@/components/ui";
import { CreditLine } from "@/components/credit-line";
import { flowText } from "@/lib/flow-text";
import { lastLineBox, planBulbs, MARGIN_BULB_SIZE, type BulbSpot } from "@/lib/paragraph-bulbs";
import { SIDE_PANEL } from "@/components/side-panel";

/*
 * Help for paragraphs and sentences. Everything here is an overlay (position: fixed):
 * nothing is added to the reading text, so the text can never move when help opens.
 */

/* ------------------------------------------------------------------ bulbs next to the paragraphs */

type Block = { el: Element; ok: boolean };
type Geo = {
  bulbs: BulbSpot[];
  bar: { top: number; height: number; left: number } | null;
};

/**
 * A permanent bulb beside the last line of each paragraph that owns a real note. Prefer the
 * last word's right margin; a narrow phone can use a smaller margin bulb instead. If neither
 * margin safely fits, omit the bulb rather than cover text. No hover is needed, and paragraphs
 * without notes show nothing. The bulbs are position: fixed overlays, so they
 * take no room in the page and the text never moves. Which spots to draw is pure geometry
 * (planBulbs in src/lib/paragraph-bulbs.ts). While help is open, a thin bar in the margin shows
 * which paragraph it is about.
 */

export function ParagraphBulbs({
  articleRef,
  version,
  bookId,
  chapter,
  notesVersion,
  activeIndex,
  onOpen,
}: {
  articleRef: React.RefObject<HTMLElement | null>;
  /** changes when the chapter text changes */
  version: unknown;
  bookId: string;
  /** 0-based chapter on screen, or an extra id such as "x2" */
  chapter: number | string;
  /** changes when the book's word list (and so its paragraph notes) changes */
  notesVersion: unknown;
  activeIndex: number | null;
  onOpen: (index: number) => void;
}) {
  const { t } = useT();
  const blocks = useRef<Block[]>([]);
  const active = useRef<number | null>(activeIndex);
  active.current = activeIndex;
  const frame = useRef(0);
  const [geo, setGeo] = useState<Geo>({ bulbs: [], bar: null });

  const measure = useCallback(() => {
    frame.current = 0;
    const art = articleRef.current;
    if (!art) return;
    const ar = art.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const viewport = { width: vw, height: vh, headerHeight: Math.max(0, Math.round(header)) };
    const rects = blocks.current.map((block) => (block.ok ? lastLineBox(block.el, viewport) : null));
    const bulbs = planBulbs({
      flags: blocks.current.map((block) => block.ok),
      rects,
      viewportWidth: vw,
      viewportHeight: vh,
      headerHeight: Math.max(0, Math.round(header)),
    });
    let bar: Geo["bar"] = null;
    if (active.current !== null) {
      const r = blocks.current[active.current]?.el.getBoundingClientRect();
      if (r && r.bottom > 56 && r.top < vh) {
        const top = Math.max(r.top, 56);
        bar = {
          top: Math.round(top),
          height: Math.round(Math.min(r.bottom, vh) - top),
          left: Math.round(Math.max(4, ar.left - 10)),
        };
      }
    }
    const next: Geo = { bulbs, bar };
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [articleRef]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(measure);
  }, [measure]);

  // The paragraph list: numbered with the shared rule (the same as the word lists use). A bulb
  // belongs only to a paragraph that has a real paragraph explanation in the word list; paragraphs
  // that only hold word or phrase entries get none. Until the list has answered, no paragraph has one.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const list = paragraphBlocks(root).map((el) => ({
      el,
      text: flowText(el),
    }));
    blocks.current = list.map(({ el }) => ({ el, ok: false }));
    schedule();
    let alive = true;
    void getParagraphNoteFlags(
      bookId,
      chapter,
      list.map((item) => item.text),
    ).then((flags) => {
      if (!alive) return;
      blocks.current = list.map((item, index) => ({
        el: item.el,
        ok: flags[index] === true,
      }));
      schedule();
    });
    return () => {
      alive = false;
    };
  }, [articleRef, version, bookId, chapter, notesVersion, schedule]);

  useEffect(() => {
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const art = articleRef.current;
    const observer = art ? new ResizeObserver(schedule) : null;
    if (art) observer?.observe(art);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [articleRef, schedule, version]);

  // The bar and the bulbs follow the page when help opens or closes.
  useEffect(() => {
    schedule();
  }, [activeIndex, schedule]);

  return (
    <>
      {geo.bar ? (
        <div
          aria-hidden
          data-para-ui
          className="pointer-events-none fixed z-20 w-[3px] rounded-full bg-accent"
          style={{ top: geo.bar.top, height: geo.bar.height, left: geo.bar.left }}
        />
      ) : null}
      {geo.bulbs.map((spot) => (
        <button
          key={spot.index}
          type="button"
          data-para-ui
          data-para-marker={spot.index}
          aria-label={t("hp.simplifyAria")}
          title={t("hp.simplifyAria")}
          onClick={() => onOpen(spot.index)}
          className={cn(
            "fixed z-20 inline-flex items-center justify-center rounded-full transition-colors",
            spot.index === activeIndex
              ? "border-2 border-accent bg-accent text-accent-ink"
              : "border border-line bg-card text-accent hover:bg-accent-soft",
            // Do not let a shadow/focus ring spend the narrow fallback's 2px text gap.
            spot.size === MARGIN_BULB_SIZE
              ? "focus-visible:outline-offset-0"
              : spot.index === activeIndex ? "shadow-sm" : "shadow-xs",
          )}
          style={{ top: spot.top, left: spot.left, width: spot.size, height: spot.size }}
        >
          <Lightbulb
            className={spot.size === MARGIN_BULB_SIZE ? "size-3" : spot.small ? "size-[0.95rem]" : "size-[1.05rem]"}
            aria-hidden
          />
        </button>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ paragraph panel */

export type ParagraphPanelState =
  { status: "loading" } | { status: "none" } | { status: "ready"; view: ParagraphHelpView };

export function ParagraphPanel({
  state,
  anchor,
  onClose,
  onWord,
}: {
  state: ParagraphPanelState;
  /** the paragraph the card should sit next to on a wide screen */
  anchor: HTMLElement | null;
  onClose: () => void;
  onWord: (word: string) => void;
}) {
  const { t } = useT();
  // The simple retelling is what the bulb is for, so it is open as soon as the panel appears.
  const [open, setOpen] = useState(true);
  const paragraph = state.status === "ready" ? state.view.paragraph : null;
  const sentences = state.status === "ready" ? state.view.sentences : [];
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("hp.panelAria")}
      kind="para"
      className={cn(
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop glass",
        "inset-x-0 bottom-0 max-h-[52dvh] rounded-t-3xl border-t pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
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
            data-panel-close
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
            {paragraph ? (
              <>
                {paragraph.credit ? <CreditLine id={paragraph.credit} /> : null}
                <section className="grid gap-1" aria-label={t("hp.mainIdea")}>
                  <h3 className="text-xs font-semibold text-muted">{t("hp.mainIdea")}</h3>
                  <p className="text-[1.05rem] leading-relaxed" lang="en" data-part="main-idea">
                    {paragraph.mainIdea}
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
                      {paragraph.simple}
                    </p>
                  ) : null}
                </section>

                {paragraph.hardWords.length > 0 ? (
                  <section className="grid gap-1.5" aria-label={t("hp.hardWords")}>
                    <h3 className="text-xs font-semibold text-muted">{t("hp.hardHint")}</h3>
                    <div className="flex flex-wrap gap-2">
                      {paragraph.hardWords.map((word) => (
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
            ) : null}

            {sentences.length > 0 ? (
              <section
                className={cn("grid gap-3", paragraph && "border-t border-line/70 pt-3")}
                aria-label={t("hp.sentences")}
                data-part="sentences"
              >
                <h3 className="text-xs font-semibold text-muted">{t("hp.sentences")}</h3>
                {sentences.map((note, at) => (
                  <SentenceNote key={`${at}:${note.context}`} note={note} />
                ))}
              </section>
            ) : null}
          </>
        )}

        <p className="border-t border-line pt-3 text-xs leading-snug text-muted">
          {t("hp.footer")}
        </p>
      </div>
    </FloatingAside>
  );
}

/** One sentence note in the paragraph panel: which sentence (its context), then the help. */
function SentenceNote({ note }: { note: SentenceInParagraph }) {
  const { t } = useT();
  return (
    <div className="grid gap-1.5" data-sentence-note>
      <blockquote
        className="border-l-2 border-line pl-2.5 font-display text-[0.92rem] leading-relaxed text-muted italic"
        lang="en"
        data-part="sentence-context"
      >
        {note.context}
      </blockquote>
      {note.credit ? <CreditLine id={note.credit} /> : null}
      <p className="text-[1.02rem] leading-relaxed" lang="en" data-part="easier">
        {note.simple}
      </p>
      {note.grammar ? (
        <p className="text-sm leading-snug" lang="en" data-part="grammar">
          <span className="mr-1.5 text-xs font-semibold text-muted">{t("hp.grammar")}</span>
          {note.grammar}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sentence hint (inside the word card) */

/**
 * One quiet line under the meaning when the word list has a note for this sentence. It takes no
 * more room than a link: the note itself opens in the paragraph panel, the same place as the bulb,
 * so a reader learns one place for paragraph and sentence help. Most sentences have no note, and
 * then nothing is drawn.
 */
export function SentenceHint({
  bookId,
  chapter,
  sentence,
  onOpen,
}: {
  bookId: string;
  chapter: number | string;
  sentence: string;
  onOpen: () => void;
}) {
  const { t } = useT();
  const [has, setHas] = useState(false);

  useEffect(() => {
    let live = true;
    setHas(false);
    void loadSentenceView({ bookId, chapter, text: sentence }).then((view) => {
      if (live) setHas(view !== null);
    });
    return () => {
      live = false;
    };
  }, [bookId, chapter, sentence]);

  if (!has) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-h-8 items-center gap-1 justify-self-start self-start text-xs font-medium text-accent hover:underline"
      data-sentence-hint
    >
      <Lightbulb className="size-3.5" aria-hidden />
      {t("hp.explain")}
    </button>
  );
}
