import { ChevronDown, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getParagraphNoteFlags, paragraphBlocks, sentenceHelpNow } from "@/lib/help-lookup";
import { useT } from "@/lib/i18n";
import { loadSentenceView, type ParagraphHelpView, type SentenceInParagraph } from "@/lib/help-flow";
import { FloatingAside } from "@/components/floating-card";
import { btn, cn } from "@/components/ui";
import { CreditLine } from "@/components/credit-line";
import { flowText } from "@/lib/flow-text";
import { containsContext } from "@/lib/help-match";
import { noteSentenceRange } from "@/lib/note-sentence";
import { SIDE_PANEL } from "@/components/side-panel";

/*
 * Help for paragraphs and sentences. The panels are overlays (position: fixed), so the text never
 * moves when help opens. The only thing put into the page is the ✦ mark after a paragraph that has
 * help, once per chapter (ParagraphMarks below).
 */

/* ------------------------------------------------------------------ ✦ marks at the end of the paragraphs */

/**
 * A ✦ after the last word of each paragraph that has help (a paragraph note, or a sentence note
 * inside it). It is part of the text flow, so the browser places it with the line: nothing is
 * measured on scroll, resize or turn, which is what made the old fixed lightbulbs stutter on phones.
 *
 * The mark is an EMPTY span; the glyph is drawn by CSS (`[data-para-marker]::before` in styles.css).
 * With no text node of its own it never reaches flowText, sentence ranges, reading anchors, word
 * counts or a selection's text, so every index computed from the page stays what it was.
 *
 * The marks are put in once per chapter text and word list (after the notes answer). Opening or
 * closing help only flips `data-active` on the mark and `data-para-active` on its paragraph; both
 * change colour and a box-shadow, never a size, so the page does not move.
 */

export function ParagraphMarks({
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
  const label = t("hp.simplifyAria");
  const open = useRef(onOpen);
  open.current = onOpen;
  const active = useRef(activeIndex);
  active.current = activeIndex;
  const blocks = useRef<Element[]>([]);
  const [placed, setPlaced] = useState(0);

  // The paragraph list: numbered with the shared rule (the same as the word lists use). A mark
  // belongs only to a paragraph that has real help in the word list. Until the list has answered,
  // no paragraph has one.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const list = paragraphBlocks(root);
    blocks.current = list;
    let alive = true;
    const added: Element[] = [];
    void getParagraphNoteFlags(
      bookId,
      chapter,
      list.map((el) => flowText(el)),
    ).then((flags) => {
      if (!alive) return;
      list.forEach((el, index) => {
        if (flags[index] !== true || !el.isConnected) return;
        const mark = el.ownerDocument.createElement("span");
        mark.setAttribute("data-para-ui", "");
        mark.setAttribute("data-para-marker", String(index));
        mark.setAttribute("role", "button");
        mark.setAttribute("tabindex", "0");
        mark.setAttribute("aria-label", label);
        mark.setAttribute("title", label);
        placeMark(el, mark);
        added.push(mark);
      });
      setPlaced((n) => n + 1);
    });
    return () => {
      alive = false;
      for (const mark of added) mark.remove();
      root.querySelector("[data-para-active]")?.removeAttribute("data-para-active");
    };
  }, [articleRef, version, bookId, chapter, notesVersion, label]);

  // One listener for every mark. Capture, so it runs before the reader's own tap handling (which
  // ignores [data-para-ui]) and before a link the mark may sit next to.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const markOf = (event: Event) =>
      (event.target as Element | null)?.closest?.("[data-para-marker]") ?? null;
    const fire = (mark: Element, event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(mark.getAttribute("data-para-marker"));
      if (Number.isInteger(index) && index >= 0) open.current(index);
    };
    const onClick = (event: MouseEvent) => {
      const mark = markOf(event);
      if (mark) fire(mark, event);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const mark = markOf(event);
      // Space would also turn the page: the mark keeps it.
      if (mark) fire(mark, event);
    };
    root.addEventListener("click", onClick, true);
    root.addEventListener("keydown", onKey, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("keydown", onKey, true);
    };
  }, [articleRef, version]);

  // Which paragraph the open help is about: colour only.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    for (const mark of Array.from(root.querySelectorAll("[data-para-marker]"))) {
      if (Number(mark.getAttribute("data-para-marker")) === activeIndex) mark.setAttribute("data-active", "");
      else mark.removeAttribute("data-active");
    }
    const block = activeIndex === null ? null : blocks.current[activeIndex];
    root.querySelector("[data-para-active]")?.removeAttribute("data-para-active");
    block?.setAttribute("data-para-active", "");
  }, [articleRef, activeIndex, placed]);

  return null;
}

/** Tags that start their own line: the mark never leaves the paragraph through one of these. */
const BLOCK_TAGS = /^(P|DIV|LI|UL|OL|BLOCKQUOTE|H[1-6]|FIGURE|SECTION|ARTICLE|TABLE|PRE)$/;

/**
 * Put `mark` right after the last visible character of `block`. It steps out of a word button and
 * of inline wrappers (em, a, span) that end the paragraph, so the mark is neither italic nor a
 * link, but it never steps out of a nested block: a blockquote whose last child is a <p> gets the
 * mark at the end of that <p>, not on a line of its own.
 */
function placeMark(block: Element, mark: Element): void {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && /\S/.test(node.nodeValue) && !node.parentElement?.closest("[data-para-ui]")) last = node;
  }
  if (!last) {
    block.appendChild(mark);
    return;
  }
  let at: Node = last;
  for (;;) {
    const parent: Element | null = at.parentElement;
    if (!parent || parent === block || BLOCK_TAGS.test(parent.tagName)) break;
    // Only climb when nothing visible follows inside the wrapper.
    let rest = at.nextSibling;
    while (rest && rest.nodeType === 3 && !/\S/.test(rest.nodeValue ?? "")) rest = rest.nextSibling;
    if (rest) break;
    at = parent;
  }
  at.parentNode?.insertBefore(mark, at.nextSibling);
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
  // The simple retelling is what the ✦ is for, so it is open as soon as the panel appears.
  const [open, setOpen] = useState(true);
  const paragraph = state.status === "ready" ? state.view.paragraph : null;
  const sentences = state.status === "ready" ? state.view.sentences : [];
  const [chosen, setChosen] = useState<number | null>(null);
  // Both kinds of help: one tab each, so a phone sheet shows one at a time instead of a long stack.
  const both = Boolean(paragraph) && sentences.length > 0;
  const [tab, setTab] = useState<"paragraph" | "sentences">("paragraph");
  // Coming from a word card, the note of that sentence is the one the reader asked about.
  useEffect(() => {
    if (!startSentence || sentences.length === 0) return;
    const at = sentences.findIndex((note) => containsContext(startSentence, note.context));
    if (at >= 0) {
      setChosen(at);
      setTab("sentences");
    }
    // Only when the notes arrive: a later click picks freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences.length, startSentence]);
  const showParagraph = Boolean(paragraph) && (!both || tab === "paragraph");
  const showSentences = sentences.length > 0 && (!both || tab === "sentences");
  // With no sentence marked, keep the paragraph itself in view above a phone sheet. (The marks
  // reveal their own sentence when the sentence tab is on.)
  const ready = state.status !== "loading";
  useEffect(() => {
    if (!ready || showSentences || !paragraphEl || !onRevealSentence) return;
    const frame = requestAnimationFrame(() => {
      const box = paragraphEl.getBoundingClientRect();
      onRevealSentence(box.top, box.bottom);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, showSentences, paragraphEl, onRevealSentence]);
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("hp.panelAria")}
      kind="para"
      className={cn(
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain [overflow-anchor:none] border-line bg-card px-5 text-ink shadow-pop ",
        "inset-x-0 bottom-0 max-h-[52dvh] rounded-t-3xl border-t pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        SIDE_PANEL,
        "md:bottom-auto md:max-h-[calc(100dvh-6.5rem)] md:pb-5",
      )}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden" aria-hidden />
      {paragraphEl ? <KeepClear el={paragraphEl} /> : null}
      {paragraphEl && showSentences ? (
        <SentenceMarks
          paragraphEl={paragraphEl}
          contexts={sentences.map((note) => note.context)}
          chosen={chosen}
          onChoose={setChosen}
          onReveal={onRevealSentence}
        />
      ) : null}
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 font-bold tracking-[-0.02em] text-lg leading-tight">
            <span className="text-accent" aria-hidden>
              ✦
            </span>
            <span data-part="help-title">{t("hp.title")}</span>
          </h2>
          <button
            type="button"
            className={cn(btn.icon, "-my-2 -mr-2")}
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
            {both ? (
              <div
                role="tablist"
                aria-label={t("hp.panelAria")}
                className="grid grid-cols-2 gap-1 rounded-xl bg-paper/70 p-1"
                data-part="help-tabs"
              >
                {(["paragraph", "sentences"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    aria-selected={tab === kind}
                    data-tab={kind}
                    onClick={(event) => {
                      setTab(kind);
                      // A new tab starts at its top; the browser's scroll anchoring would keep the old offset.
                      event.currentTarget.closest("aside")?.scrollTo?.(0, 0);
                    }}
                    className={cn(
                      "min-h-10 rounded-lg px-3 text-sm font-medium transition-colors",
                      tab === kind ? "bg-card text-ink shadow-xs" : "text-muted hover:text-ink",
                    )}
                  >
                    {kind === "paragraph"
                      ? t("hp.tabParagraph")
                      : `${t("hp.tabSentences")} · ${sentences.length}`}
                  </button>
                ))}
              </div>
            ) : null}

            {showParagraph && paragraph ? (
              <section
                className="grid min-w-0 gap-4"
                aria-label={t("hp.paragraphSection")}
                data-part="paragraph-help"
              >
                {both ? null : <h3 className="sr-only">{t("hp.paragraphSection")}</h3>}
                <section className="grid gap-1" aria-label={t("hp.mainIdea")}>
                  <h4 className="text-xs font-semibold tracking-wide text-accent">{t("hp.mainIdea")}</h4>
                  <p
                    className="break-words text-[1.05rem] leading-relaxed font-medium"
                    lang="en"
                    data-part="main-idea"
                  >
                    {paragraph.mainIdea}
                  </p>
                </section>

                <section className="grid gap-1" aria-label={t("hp.simple")}>
                  <h4>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpen((value) => !value)}
                      className="-mx-1 flex min-h-9 w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-lg px-1 text-left text-xs font-semibold tracking-wide text-accent hover:bg-accent-soft/60"
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
                    <h4 className="text-xs font-semibold tracking-wide text-accent">{t("hp.hardHint")}</h4>
                    <div className="flex flex-wrap gap-2">
                      {paragraph.hardWords.map((word) => (
                        <button
                          key={word}
                          type="button"
                          data-hard-word={word}
                          onClick={() => onWord(word)}
                          lang="en"
                          className="min-h-9 max-w-full break-words rounded border border-line px-3.5 text-[0.95rem] font-medium hover:bg-accent-soft"
                        >
                          {word}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                <HelpSource credit={paragraph.credit} />
              </section>
            ) : null}

            {showSentences ? (
              <section
                className="grid min-w-0"
                aria-label={t("hp.sentenceSection")}
                data-part="sentences"
              >
                {both ? null : <h3 className="sr-only">{t("hp.sentenceSection")}</h3>}
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

/**
 * While help is open, the floating card keeps clear of the paragraph it explains (anchorBox in
 * floating-panel.ts reads `data-help-keep`). A layout effect in a child of the card, so the mark is
 * there before the card places itself on its first frame.
 */
function KeepClear({ el }: { el: Element }) {
  useLayoutEffect(() => {
    el.setAttribute("data-help-keep", "");
    return () => el.removeAttribute("data-help-keep");
  }, [el]);
  return null;
}

/**
 * Who wrote this explanation, as one quiet line under it. Only a reader's accepted contribution
 * is credited by name; an explanation that came with the word list needs no label on every block.
 */
function HelpSource({ credit }: { credit?: string }) {
  if (!credit) return null;
  return (
    <div className="min-w-0 max-w-full" data-help-source="reader">
      <CreditLine id={credit} />
    </div>
  );
}

/**
 * One sentence note in the paragraph panel: the original sentence as a quote, then the help. A tap
 * on the quote marks that sentence more strongly in the page, so the reader can see which one it
 * explains. Notes are separated by a rule, not boxed, so a phone sheet keeps its width for text.
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
      className="grid min-w-0 gap-2 border-t border-line/70 py-3.5 first:border-t-0 first:pt-0 last:pb-0"
      data-sentence-note
      data-chosen={chosen ? "" : undefined}
    >
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        aria-label={`${t("hp.original")}: ${note.context}`}
        className={cn(
          "min-h-11 break-words rounded-r-md py-1 pr-1 pl-3 text-left font-display text-[0.95rem] leading-relaxed italic transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          chosen
            ? "border-l-[3px] border-accent bg-mark/35 text-ink"
            : "border-l-[3px] border-line text-muted hover:text-ink",
        )}
        lang="en"
        data-part="sentence-context"
      >
        {note.context}
      </button>
      <p className="break-words text-[1.02rem] leading-relaxed" lang="en" data-part="easier">
        {note.simple}
      </p>
      {note.grammar ? (
        <p className="break-words rounded-md bg-paper/70 px-2.5 py-1.5 text-sm leading-snug" lang="en" data-part="grammar">
          <span className="mr-1.5 text-xs font-semibold text-accent">{t("hp.grammar")}</span>
          {note.grammar}
        </p>
      ) : null}
      <HelpSource credit={note.credit} />
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
 * more room than a link: the note itself opens in the paragraph panel, the same place as the ✦ mark,
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
      <span aria-hidden>✦</span>
      {t("hp.explain")}
    </button>
  );
}
