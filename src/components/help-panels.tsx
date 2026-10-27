import { ChevronDown, Lightbulb, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getParagraphNoteFlags, paragraphBlocks, sentenceHelpNow } from "@/lib/help-lookup";
import { useT } from "@/lib/i18n";
import { loadSentenceView, type ParagraphHelpView, type SentenceInParagraph } from "@/lib/help-flow";
import { FloatingAside } from "@/components/floating-card";
import { btn, cn } from "@/components/ui";
import { CreditLine } from "@/components/credit-line";
import { flowText } from "@/lib/flow-text";
import { lastLineBox, planBulbs, MARGIN_BULB_SIZE, type BulbSpot } from "@/lib/paragraph-bulbs";
import { containsContext } from "@/lib/help-match";
import { noteSentenceRange } from "@/lib/note-sentence";
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
  paragraphEl,
  startSentence,
  onRevealSentence,
  onClose,
  onWord,
}: {
  state: ParagraphPanelState;
  /** the paragraph the card should sit next to on a wide screen */
  anchor: HTMLElement | null;
  /** the paragraph on the page, so the sentences the notes explain can be marked in it */
  paragraphEl?: Element | null;
  /** the sentence a word card was opened on: its note starts selected */
  startSentence?: string;
  /** Keep a marked sentence in view: called with its top and bottom on screen. */
  onRevealSentence?: (top: number, bottom: number) => void;
  onClose: () => void;
  onWord: (word: string) => void;
}) {
  const { t } = useT();
  // The simple retelling is what the bulb is for, so it is open as soon as the panel appears.
  const [open, setOpen] = useState(true);
  const paragraph = state.status === "ready" ? state.view.paragraph : null;
  const sentences = state.status === "ready" ? state.view.sentences : [];
  const [chosen, setChosen] = useState<number | null>(null);
  // Coming from a word card, the note of that sentence is the one the reader asked about.
  useEffect(() => {
    if (!startSentence || sentences.length === 0) return;
    const at = sentences.findIndex((note) => containsContext(startSentence, note.context));
    if (at >= 0) setChosen(at);
    // Only when the notes arrive: a later click picks freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences.length, startSentence]);
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
      {paragraphEl && sentences.length > 0 ? (
        <SentenceMarks
          paragraphEl={paragraphEl}
          contexts={sentences.map((note) => note.context)}
          chosen={chosen}
          onChoose={setChosen}
          onReveal={onRevealSentence}
        />
      ) : null}
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
            <p className="text-xs leading-relaxed text-muted" data-part="help-source-intro">
              {t("hp.sourceIntro")}
            </p>
            {paragraph ? (
              <section
                className="grid min-w-0 gap-2"
                aria-label={t("hp.paragraphSection")}
                data-part="paragraph-help"
              >
                <h3 className="text-sm font-semibold">{t("hp.paragraphSection")}</h3>
                <div className="grid min-w-0 gap-3 rounded-lg border border-line bg-paper/50 p-3">
                  <HelpSource credit={paragraph.credit} />
                  <section className="grid gap-1" aria-label={t("hp.mainIdea")}>
                    <h4 className="text-xs font-semibold text-muted">{t("hp.mainIdea")}</h4>
                    <p
                      className="break-words text-[1.05rem] leading-relaxed"
                      lang="en"
                      data-part="main-idea"
                    >
                      {paragraph.mainIdea}
                    </p>
                  </section>

                  <section className="grid gap-1.5" aria-label={t("hp.simple")}>
                    <h4>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpen((value) => !value)}
                        className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-lg px-1 text-left text-sm font-semibold text-accent hover:bg-accent-soft/60"
                      >
                        <span>{t("hp.simple")}</span>
                        <span className="flex shrink-0 items-center gap-1 font-normal text-muted">
                          {open ? t("common.hide") : t("common.show")}
                          <ChevronDown
                            className={cn("size-4 transition-transform", open && "rotate-180")}
                            aria-hidden
                          />
                        </span>
                      </button>
                    </h4>
                    {open ? (
                      <p
                        className="break-words text-[1.02rem] leading-relaxed"
                        lang="en"
                        data-part="simple"
                      >
                        {paragraph.simple}
                      </p>
                    ) : null}
                  </section>

                  {paragraph.hardWords.length > 0 ? (
                    <section className="grid gap-1.5" aria-label={t("hp.hardWords")}>
                      <h4 className="text-xs font-semibold text-muted">{t("hp.hardHint")}</h4>
                      <div className="flex flex-wrap gap-2">
                        {paragraph.hardWords.map((word) => (
                          <button
                            key={word}
                            type="button"
                            data-hard-word={word}
                            onClick={() => onWord(word)}
                            lang="en"
                            className="min-h-10 max-w-full break-words rounded-full border border-line px-3.5 text-[0.95rem] font-medium hover:bg-accent-soft"
                          >
                            {word}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </section>
            ) : null}

            {sentences.length > 0 ? (
              <section
                className="grid min-w-0 gap-2"
                aria-label={t("hp.sentenceSection")}
                data-part="sentences"
              >
                <h3 className="text-sm font-semibold">{t("hp.sentenceSection")}</h3>
                {sentences.map((note, at) => (
                  <SentenceNote
                    key={`${at}:${note.context}`}
                    note={note}
                    chosen={chosen === at}
                    onChoose={() => setChosen((now) => (now === at ? null : at))}
                  />
                ))}
              </section>
            ) : null}
          </>
        )}

        <p
          className="border-t border-line pt-3 text-xs leading-snug text-muted"
          data-part="help-footer"
        >
          {t("hp.footer")}
        </p>
      </div>
    </FloatingAside>
  );
}

function HelpSource({ credit }: { credit?: string }) {
  const { t } = useT();
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line/70 pb-2 text-xs text-muted"
      data-help-source={credit ? "reader" : "word-list"}
    >
      <span className="shrink-0 font-medium">
        {t(credit ? "hp.sourceReader" : "hp.sourceBook")}
      </span>
      {credit ? (
        <div className="min-w-0 max-w-full">
          <CreditLine id={credit} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One sentence note in the paragraph panel: which sentence (its context), then the help. A tap
 * marks that sentence more strongly in the page, so the reader can see which one it explains.
 */
function SentenceNote({
  note,
  chosen,
  onChoose,
}: {
  note: SentenceInParagraph;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { t } = useT();
  return (
    <div
      // The yellow is the page's; the panel only says which note is chosen, with its line.
      className="grid min-w-0 gap-3 rounded-lg border border-line bg-paper/50 p-3"
      data-sentence-note
      data-chosen={chosen ? "" : undefined}
    >
      <HelpSource credit={note.credit} />
      <div className="grid min-w-0 gap-1">
        <span className="text-xs font-semibold text-muted">{t("hp.original")}</span>
        <button
          type="button"
          onClick={onChoose}
          aria-pressed={chosen}
          className={cn(
            "min-h-11 break-words pl-2.5 text-left font-display text-[0.92rem] leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            chosen ? "border-l-[3px] border-accent text-ink" : "border-l-2 border-line text-muted",
          )}
          lang="en"
          data-part="sentence-context"
        >
          {note.context}
        </button>
      </div>
      <div className="grid gap-1">
        <span className="text-xs font-semibold text-muted">{t("hp.explanation")}</span>
        <p className="break-words text-[1.02rem] leading-relaxed" lang="en" data-part="easier">
          {note.simple}
        </p>
      </div>
      {note.grammar ? (
        <p className="break-words text-sm leading-snug" lang="en" data-part="grammar">
          <span className="mr-1.5 text-xs font-semibold text-muted">{t("hp.grammar")}</span>
          {note.grammar}
        </p>
      ) : null}
    </div>
  );
}

type MarkBox = { note: number; top: number; left: number; width: number; height: number };

/**
 * While the panel is open, every sentence of the paragraph that has a note is marked in the page,
 * like a highlighter, and the chosen one more strongly. The marks are position: fixed boxes drawn
 * from the sentence's line boxes, under the text (pointer-events off), so nothing in the page moves
 * and a word under a mark still opens its card. A tap on a marked sentence, off a word, chooses its note.
 */
function SentenceMarks({
  paragraphEl,
  contexts,
  chosen,
  onChoose,
  onReveal,
}: {
  paragraphEl: Element;
  contexts: readonly string[];
  chosen: number | null;
  onChoose: (index: number) => void;
  /** Asked once the marks are drawn: the top of the chosen (or first) marked sentence on screen. */
  onReveal?: (top: number, bottom: number) => void;
}) {
  const [boxes, setBoxes] = useState<MarkBox[]>([]);
  const key = contexts.join("\u0001");
  const revealed = useRef("");
  useEffect(() => {
    if (!onReveal || boxes.length === 0) return;
    const note = chosen ?? boxes[0]?.note ?? 0;
    const tag = `${key}|${note}`;
    if (revealed.current === tag) return;
    revealed.current = tag;
    const mine = boxes.filter((box) => box.note === note);
    if (mine.length === 0) return;
    onReveal(Math.min(...mine.map((b) => b.top)), Math.max(...mine.map((b) => b.top + b.height)));
  }, [boxes, chosen, key, onReveal]);

  useEffect(() => {
    let frame = 0;
    // The floating card keeps clear of a paragraph marked this way (anchorBox in floating-panel.ts).
    paragraphEl.setAttribute("data-help-keep", "");
    const ranges = contexts.map((context) => noteSentenceRange(paragraphEl, context));
    const measure = () => {
      frame = 0;
      const next: MarkBox[] = [];
      ranges.forEach((range, note) => {
        if (!range) return;
        // A range reports one box per word button and text piece; they overlap and would stack
        // the colour. Join them into one box per line.
        const lines: MarkBox[] = [];
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 1 || r.height < 1) continue;
          const mid = r.top + r.height / 2;
          const line = lines.find((box) => mid > box.top && mid < box.top + box.height);
          if (line) {
            const right = Math.max(line.left + line.width, r.right);
            line.left = Math.min(line.left, r.left);
            line.width = right - line.left;
            const bottom = Math.max(line.top + line.height, r.bottom);
            line.top = Math.min(line.top, r.top);
            line.height = bottom - line.top;
          } else {
            lines.push({ note, top: r.top, left: r.left, width: r.width, height: r.height });
          }
        }
        for (const box of lines)
          next.push({
            note,
            top: Math.round(box.top),
            left: Math.round(box.left),
            width: Math.round(box.width),
            height: Math.round(box.height),
          });
      });
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(paragraphEl);
    return () => {
      paragraphEl.removeAttribute("data-help-keep");
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // `key` stands for `contexts`: a new array holding the same notes must not re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphEl, key]);

  // A tap in the page on a marked sentence picks its note. Capture, so it runs before the reader's
  // own tap handling closes the panel. A word under the mark still opens its card.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || !paragraphEl.contains(target) || target.closest?.("[data-word]")) return;
      const hit = boxes.find(
        (box) =>
          event.clientX >= box.left &&
          event.clientX <= box.left + box.width &&
          event.clientY >= box.top &&
          event.clientY <= box.top + box.height,
      );
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      onChoose(hit.note);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [boxes, onChoose, paragraphEl]);

  // A portal into the body: the panel is a transformed sheet, and position: fixed inside a
  // transformed parent is placed against that parent, which drew the marks over the panel.
  return createPortal(
    <>
      {boxes.map((box, at) => (
        <div
          key={at}
          aria-hidden
          data-para-ui
          data-sentence-mark={box.note}
          data-chosen={chosen === box.note ? "" : undefined}
          className={cn(
            "pointer-events-none fixed z-[1] rounded-[3px]",
            chosen === box.note ? "bg-mark/80" : "bg-mark/35",
          )}
          style={{ top: box.top, left: box.left - 1, width: box.width + 2, height: box.height }}
        />
      ))}
    </>,
    document.body,
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
  // Known at once when the book's notes are in memory, so the link is part of the card's first
  // frame instead of appearing a moment later and pushing the footer down.
  const known = () => {
    const now = sentenceHelpNow(bookId, chapter, sentence);
    return now === undefined ? undefined : Boolean(now?.simple?.trim());
  };
  const [has, setHas] = useState<boolean>(() => known() ?? false);

  useEffect(() => {
    let live = true;
    const now = known();
    setHas(now ?? false);
    if (now !== undefined) return;
    void loadSentenceView({ bookId, chapter, text: sentence }).then((view) => {
      if (live) setHas(view !== null);
    });
    return () => {
      live = false;
    };
    // `known` reads the same three values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
