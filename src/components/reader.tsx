import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Focus,
  List,
  Minus,
  Plus,
  Search,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadBookMeta, loadStoredBook, type Gloss, type StoredBook } from "@/lib/book-db";
import {
  cleanReadingRoot,
  pickSense,
  splitWords,
  wordTextNodes,
  type OtherMeaning,
} from "@/lib/glossary-format";
import { findPhrase, paragraphBlocks } from "@/lib/help-lookup";
import { loadParagraphView } from "@/lib/help-flow";
import { tr, useT, type Key } from "@/lib/i18n";
import { legacyChapter, overallProgress, useProgress } from "@/lib/progress-store";
import {
  COLUMN_MAX,
  COLUMN_MIN,
  FONT_STACKS,
  LEADINGS,
  readerVars,
  SIZE_MAX,
  SIZE_MIN,
  usePrefs,
  type FontKey,
  type Theme,
} from "@/lib/reader-prefs";
import {
  contextPos,
  indexBook,
  isEasyKey,
  lookupKey,
  sentenceAround,
  type WordStat,
} from "@/lib/text";
import { useVocab } from "@/lib/vocab-store";
import {
  btn,
  chip,
  cn,
  field,
  Highlighted,
  ProgressBar,
  Segmented,
  SpeakButton,
} from "@/components/ui";
import {
  ExplainSentence,
  ParagraphMarker,
  ParagraphPanel,
  type ParagraphPanelState,
} from "@/components/help-panels";

/* ------------------------------------------------------------------ book HTML */

function readingHtml(
  html: string,
  ready: Set<string>,
  resolve: (surface: string) => string,
): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  cleanReadingRoot(root);
  for (const el of [...root.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on") || attr.name === "href" || attr.name === "action")
        el.removeAttribute(attr.name);
      // The book's own inline styles would fight the reader's typography settings.
      if (attr.name === "style" || attr.name === "class") el.removeAttribute(attr.name);
    }
  }
  // Word rule and counting: src/lib/glossary-format.ts (shared with the command-line tools).
  const nodes = wordTextNodes(doc, root);
  let order = 0;
  const seenForms = new Map<string, number>();
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment();
    const parts = splitWords(node.data);
    parts.forEach((part, at) => {
      if (at % 2 === 1) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.word = part;
        button.dataset.i = String(order);
        order += 1;
        const form = part.toLowerCase();
        const nth = (seenForms.get(form) ?? 0) + 1;
        seenForms.set(form, nth);
        button.dataset.n = String(nth);
        button.textContent = part;
        const key = resolve(part);
        if (ready.has(key)) button.className = "book-hard";
        fragment.append(button);
      } else if (part) {
        fragment.append(doc.createTextNode(part));
      }
    });
    node.parentNode?.replaceChild(fragment, node);
  }
  return root.innerHTML;
}

/* ------------------------------------------------------------------ typography panel */

const THEMES: Array<{ value: Theme; label: Key; bg: string; fg: string }> = [
  { value: "light", label: "rs.theme.light", bg: "#f6f4ee", fg: "#1f1d1a" },
  { value: "sepia", label: "rs.theme.sepia", bg: "#f0e4c8", fg: "#3f3020" },
  { value: "dark", label: "rs.theme.dark", bg: "#14161a", fg: "#e9e6df" },
];
const LEADING_LABEL: Record<number, Key> = {
  1.6: "rs.leading.tight",
  1.8: "rs.leading.normal",
  2.05: "rs.leading.loose",
};

function ReaderSettings() {
  const { t } = useT();
  const prefs = usePrefs();
  const set = usePrefs((state) => state.set);
  return (
    <Popover.Root>
      <Popover.Trigger className={btn.icon} aria-label={t("rs.aria")}>
        <Type className="size-5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="anim-pop z-50 grid w-[min(22rem,calc(100vw-1rem))] gap-4 rounded-2xl border border-line bg-card p-4 text-ink shadow-pop"
        >
          <section className="grid gap-2" aria-label={t("rs.theme")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.theme")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  aria-pressed={prefs.theme === theme.value}
                  onClick={() => set({ theme: theme.value })}
                  className={cn(
                    "grid min-h-16 place-items-center gap-0.5 rounded-xl border-2 py-2 text-xs font-semibold transition-colors",
                    prefs.theme === theme.value
                      ? "border-accent"
                      : "border-line hover:border-muted",
                  )}
                  style={{ background: theme.bg, color: theme.fg }}
                >
                  <span className="font-display text-lg leading-none">Aa</span>
                  {t(theme.label)}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.font")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.font")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FONT_STACKS) as FontKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={prefs.font === key}
                  onClick={() => set({ font: key })}
                  className={cn(
                    "min-h-11 rounded-lg border px-2 text-base transition-colors",
                    prefs.font === key
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:bg-accent-soft/60",
                  )}
                  style={{ fontFamily: FONT_STACKS[key].css }}
                >
                  {FONT_STACKS[key].label}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.size")}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted">{t("rs.size")}</h3>
              <span className="text-xs tabular-nums text-muted">{prefs.size}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={btn.icon}
                aria-label={t("rs.smaller")}
                disabled={prefs.size <= SIZE_MIN}
                onClick={() => set({ size: Math.max(SIZE_MIN, prefs.size - 1) })}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <input
                type="range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={1}
                value={prefs.size}
                onChange={(event) => set({ size: Number(event.target.value) })}
                aria-label={t("rs.size")}
                className="h-11 flex-1 accent-[var(--accent)]"
              />
              <button
                type="button"
                className={btn.icon}
                aria-label={t("rs.bigger")}
                disabled={prefs.size >= SIZE_MAX}
                onClick={() => set({ size: Math.min(SIZE_MAX, prefs.size + 1) })}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.leading")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.leading")}</h3>
            <Segmented
              label={t("rs.leading")}
              value={prefs.leading}
              onChange={(value) => set({ leading: value })}
              options={LEADINGS.map((item) => ({
                value: item.value as number,
                label: t(LEADING_LABEL[item.value] ?? "rs.leading.normal"),
              }))}
            />
          </section>

          <section className="grid gap-2" aria-label={t("rs.width")}>
            <h3 className="text-xs font-semibold text-muted">
              {t("rs.width")} <span className="tabular-nums">{prefs.column}</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="w-10 text-xs text-muted">{t("rs.width.narrow")}</span>
              <input
                type="range"
                min={COLUMN_MIN}
                max={COLUMN_MAX}
                step={1}
                value={prefs.column}
                onChange={(event) => set({ column: Number(event.target.value) })}
                aria-label={t("rs.width")}
                data-reader-width
                className="h-11 flex-1 accent-[var(--accent)]"
              />
              <span className="w-10 text-right text-xs text-muted">{t("rs.width.wide")}</span>
            </div>
          </section>

          <button
            type="button"
            aria-pressed={prefs.focus}
            onClick={() => set({ focus: !prefs.focus })}
            className={cn(
              "flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-semibold",
              prefs.focus ? "border-accent bg-accent-soft" : "border-line",
            )}
          >
            <span className="flex items-center gap-2">
              <Focus className="size-4" aria-hidden />
              {t("rs.focus")}
              <span className="font-normal text-muted">{t("rs.focusHint")}</span>
            </span>
            {prefs.focus ? <Check className="size-4 text-accent" aria-hidden /> : null}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ contents drawer */

function Contents({
  chapters,
  current,
  onPick,
}: {
  chapters: Array<{ title: string }>;
  current: number;
  onPick: (index: number) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (open) currentRef.current?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={btn.icon} aria-label={t("contents.title")}>
        <List className="size-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-drawer fixed inset-y-0 left-0 z-50 flex w-[min(24rem,88vw)] flex-col border-r border-line bg-card text-ink shadow-pop">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <Dialog.Title className="font-display text-lg font-semibold">
              {t("contents.title")}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t("contents.desc")}</Dialog.Description>
            <Dialog.Close className={btn.icon} aria-label={t("contents.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          {chapters.length > 12 ? (
            <div className="border-b border-line p-3">
              <label className="relative block">
                <span className="sr-only">{t("contents.search")}</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  className={cn(field, "pl-9")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("contents.search")}
                  type="search"
                />
              </label>
            </div>
          ) : null}
          <ol className="scroll-thin flex-1 overflow-y-auto p-2">
            {chapters.map((chapter, index) => {
              if (q && !chapter.title.toLowerCase().includes(q)) return null;
              const active = index === current;
              return (
                <li key={`${chapter.title}-${index}`}>
                  <button
                    type="button"
                    ref={active ? currentRef : undefined}
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      onPick(index);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[0.95rem] leading-snug transition-colors",
                      active
                        ? "bg-accent-soft font-semibold text-accent"
                        : "hover:bg-accent-soft/60",
                    )}
                  >
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1" lang="en">
                      {chapter.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ word card */

function WordFacts({ stat, current }: { stat: WordStat | undefined; current: string }) {
  const { t, tn } = useT();
  if (!stat) return null;
  const others = stat.sentences.filter((sentence) => sentence !== current).slice(0, 1);
  return (
    <div className="grid gap-2 border-t border-line pt-3 text-sm text-muted">
      <p>
        {tn("facts.seen", stat.count)}
        {stat.chapters > 1 ? t("facts.chapters", { n: stat.chapters }) : ""}
        {stat.forms.length > 1 ? (
          <>
            {t("facts.forms")}
            <span lang="en">
              {stat.forms.map((form) => `${form.form} ×${form.count}`).join(", ")}
            </span>
          </>
        ) : null}
      </p>
      {others.map((sentence) => (
        <p key={sentence} lang="en" className="italic">
          “{sentence}”
        </p>
      ))}
    </div>
  );
}

function OtherMeanings({ items }: { items: OtherMeaning[] }) {
  const { t, tn } = useT();
  return (
    <details className="group rounded-lg border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none font-semibold text-muted select-none marker:hidden hover:text-ink">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight
            className="size-3.5 transition-transform group-open:rotate-90"
            aria-hidden
          />
          {t("other.title", { n: items.length })}
        </span>
      </summary>
      <ul className="mt-2 grid gap-2.5">
        {items.map((item) => (
          <li key={item.meaning} className="grid gap-0.5" lang="en">
            <span className="text-xs text-muted">
              {item.pos ? `${item.pos}` : t("other.another")}
              {item.chapters.length > 0
                ? ` · ${tn("other.chapters", item.chapters.length, {
                    list: item.chapters
                      .slice(0, 4)
                      .map((c) => c + 1)
                      .join(", "),
                  })}`
                : ""}
            </span>
            <span className="leading-snug">{item.meaning}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type CardState = {
  surface: string;
  key: string;
  pos: string;
  meaning: string;
  whyHard: string;
  sentence: string;
  ready: boolean;
  status: "ready" | "easy" | "unknown";
  /** other meanings of this word in the same book (only when the word list has them) */
  others?: OtherMeaning[];
  /** the author made this word up */
  coined?: boolean;
  /** the whole sentence (the card may show a shortened one) */
  fullSentence?: string;
  /** an example sentence from the word list, when it is not the sentence that was tapped */
  example?: string;
};

/** The whole sentence around a tapped word (not shortened). */
function wholeSentence(paragraph: string, surface: string, at: number): string {
  const exact = paragraph.slice(at, at + surface.length).toLowerCase() === surface.toLowerCase();
  const idx = exact ? at : paragraph.toLowerCase().indexOf(surface.toLowerCase());
  if (idx < 0) return paragraph.slice(0, 600);
  let start = 0;
  let end = paragraph.length;
  for (const mark of [".", "?", "!"]) {
    const a = paragraph.lastIndexOf(mark, idx - 1);
    if (a >= 0) start = Math.max(start, a + 1);
    const z = paragraph.indexOf(mark, idx + surface.length);
    if (z >= 0) end = Math.min(end, z + 1);
  }
  return paragraph.slice(start, end).trim();
}

type PhraseHit = {
  key: string;
  entry: { meaning: string; pos?: string; example?: string };
  matched: string;
};

function CoinedBadge() {
  const { t } = useT();
  return (
    <p
      className="inline-flex items-center gap-1.5 self-start rounded-full bg-mark/60 px-2.5 py-0.5 text-xs font-semibold text-ink"
      data-coined
    >
      <Sparkles className="size-3" aria-hidden />
      {t("card.coined")}
    </p>
  );
}

function WordCard({
  state,
  stat,
  saved,
  dock,
  side,
  phrase,
  bookId,
  chapter,
  noList,
  onClose,
  onToggle,
}: {
  state: CardState;
  /** a phrasal verb or idiom that contains the tapped word */
  phrase: PhraseHit | null;
  bookId: string;
  chapter: number;
  /** this book has no word list at all (for example a book the user added without one) */
  noList: boolean;
  stat: WordStat | undefined;
  saved: boolean;
  /** phone: which edge the sheet sits on (the opposite one from the tapped word) */
  dock: "bottom" | "top";
  /** desktop: which side the card sits on (the opposite one from the tapped word) */
  side: "left" | "right";
  onClose: () => void;
  onToggle: () => void;
}) {
  const { t } = useT();
  const showForm = state.key !== state.surface.toLowerCase();
  const meaningBlock =
    state.status === "unknown" ? (
      <p
        className="rounded-lg bg-accent-soft px-3 py-2.5 text-[0.95rem] leading-snug"
        role="status"
        data-part="no-meaning"
      >
        {t("card.noMeaning")}
        {noList ? <span className="mt-1 block text-muted">{t("card.noList")}</span> : null}
      </p>
    ) : (
      <p className="text-[1.05rem] leading-relaxed" lang="en" data-part="word-meaning">
        {state.meaning}
      </p>
    );
  return (
    <aside
      aria-label={t("card.aria", { word: state.key })}
      data-word-card
      data-dock={dock}
      data-side={side}
      className={cn(
        // Always out of the page flow (fixed): opening, moving or closing it can never move the text.
        "fixed z-40 max-h-[46dvh] overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop",
        // Phone: a sheet on the edge that is away from the tapped word.
        dock === "bottom"
          ? "anim-sheet inset-x-0 bottom-0 rounded-t-3xl border-t pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          : "anim-sheet-top inset-x-0 top-0 rounded-b-3xl border-b pt-[max(0.75rem,env(safe-area-inset-top))] pb-3",
        // Desktop: a card on the side that is away from the tapped word.
        "lg:inset-x-auto lg:top-[4.5rem] lg:bottom-5 lg:max-h-none lg:w-[21rem] lg:rounded-2xl lg:border lg:pt-5 lg:pb-5",
        side === "left" ? "lg:left-5" : "lg:right-5",
      )}
    >
      {dock === "bottom" ? (
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line lg:hidden" aria-hidden />
      ) : null}
      <div className="grid gap-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 className="font-display text-3xl leading-tight font-semibold break-words" lang="en">
              {phrase ? phrase.key : state.key}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {phrase ? (
                <span>
                  {t("common.inBook", { word: "\u0001" })
                    .split("\u0001")
                    .flatMap((piece, i) =>
                      i === 0
                        ? [piece]
                        : [
                            <span key="m" lang="en">
                              {phrase.matched}
                            </span>,
                            piece,
                          ],
                    )}
                </span>
              ) : (
                <>
                  {showForm ? (
                    <span>
                      {t("common.inBook", { word: "\u0001" })
                        .split("\u0001")
                        .flatMap((piece, i) =>
                          i === 0
                            ? [piece]
                            : [
                                <span key="m" lang="en">
                                  {state.surface}
                                </span>,
                                piece,
                              ],
                        )}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className={cn(btn.icon, "-mt-1 -mr-2")}
            onClick={onClose}
            aria-label={t("card.close")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phrase ? (
            <span className={cn(chip, "bg-accent-soft text-accent")} data-phrase-pos>
              {phrase.entry.pos ? (
                <span lang="en">{phrase.entry.pos}</span>
              ) : (
                t("card.phraseFallback")
              )}
            </span>
          ) : state.pos ? (
            <span className={cn(chip, "bg-accent-soft text-accent")}>
              <span lang="en">{state.pos}</span>
            </span>
          ) : state.status === "easy" ? (
            <span className={cn(chip, "bg-line text-muted")}>{t("card.easyChip")}</span>
          ) : null}
          <SpeakButton text={phrase ? phrase.key : state.key} className="-ml-1" />
        </div>

        {phrase ? (
          <>
            <p className="text-[1.05rem] leading-relaxed" lang="en" data-part="phrase-meaning">
              {phrase.entry.meaning}
            </p>
            <section
              className="grid gap-1.5 rounded-lg border border-line px-3 py-2.5"
              aria-label={t("card.alone")}
              data-part="word-alone"
            >
              <h3 className="text-xs font-semibold text-muted">{t("card.alone")}</h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display text-lg font-semibold" lang="en">
                  {state.key}
                </span>
                {state.pos ? (
                  <span className={cn(chip, "bg-line text-muted")}>
                    <span lang="en">{state.pos}</span>
                  </span>
                ) : null}
              </div>
              {meaningBlock}
              {state.coined ? <CoinedBadge /> : null}
            </section>
          </>
        ) : (
          <>
            {meaningBlock}
            {state.coined ? <CoinedBadge /> : null}
          </>
        )}

        {state.sentence ? (
          <figure className="grid gap-1 border-l-2 border-accent/50 pl-3">
            <figcaption className="text-xs font-semibold text-muted">
              {t("card.sentenceFrom")}
            </figcaption>
            <blockquote className="font-display text-[0.95rem] leading-relaxed">
              <Highlighted
                sentence={state.sentence}
                surface={phrase ? phrase.matched : state.surface}
              />
            </blockquote>
          </figure>
        ) : null}

        {state.sentence ? (
          <ExplainSentence
            key={`${chapter}|${state.sentence}`}
            bookId={bookId}
            chapter={chapter}
            sentence={state.fullSentence || state.sentence}
          />
        ) : null}

        {state.example ? (
          <figure className="grid gap-1 border-l-2 border-line pl-3" data-part="example">
            <figcaption className="text-xs font-semibold text-muted">
              {t("card.example")}
            </figcaption>
            <blockquote className="font-display text-[0.95rem] leading-relaxed">
              <Highlighted sentence={state.example} surface={state.surface} />
            </blockquote>
          </figure>
        ) : null}

        {state.whyHard && state.ready && state.status === "ready" ? (
          <p className="text-sm text-muted" lang="en">
            {state.whyHard}
          </p>
        ) : null}

        {state.others && state.others.length > 0 && state.status === "ready" ? (
          <OtherMeanings items={state.others} />
        ) : null}

        <WordFacts stat={stat} current={state.sentence} />

        <button
          type="button"
          className={saved ? btn.quiet : btn.primary}
          disabled={!saved && !state.ready}
          onClick={onToggle}
          aria-pressed={saved}
        >
          {saved ? (
            <>
              <Check className="size-4 text-accent" aria-hidden />
              {t("card.saved")}
            </>
          ) : (
            <>
              <BookMarked className="size-4" aria-hidden />
              {t("card.add")}
            </>
          )}
        </button>
      </div>
      {dock === "top" ? (
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-line lg:hidden" aria-hidden />
      ) : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ reader */

export function ReaderScreen({
  bookId,
  onBack,
  onNotebook,
}: {
  bookId: string;
  onBack: () => void;
  onNotebook: () => void;
}) {
  const { t } = useT();
  const words = useVocab((state) => state.words);
  const addWords = useVocab((state) => state.addWords);
  const removeWordByLemma = useVocab((state) => state.removeWordByLemma);
  const fillPrepared = useVocab((state) => state.fillPrepared);
  const prefs = usePrefs();
  const saveProgress = useProgress((state) => state.save);

  const [book, setBook] = useState<StoredBook | null>(null);
  const bookChaptersRaw = book?.chapters;
  const [missing, setMissing] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(() => {
    const saved = useProgress.getState().items[bookId];
    return saved ? saved.chapter : (legacyChapter(bookId) ?? -1);
  });
  const [scrolled, setScrolled] = useState(0);
  const [picked, setPicked] = useState<{
    surface: string;
    paragraph: string;
    index: string;
    /** which time this word form appears in the chapter (1-based) */
    nth: number;
    /** the paragraph text before the word */
    before: string;
  } | null>(null);
  // Where the word card sits. Decided when a word is tapped, so the card never covers it.
  const [place, setPlace] = useState<{ dock: "bottom" | "top"; side: "left" | "right" }>({
    dock: "bottom",
    side: "right",
  });
  // Paragraph help (overlay). `index` is the paragraph number from paragraphBlocks().
  const [help, setHelp] = useState<{
    index: number;
    dock: "bottom" | "top";
    side: "left" | "right";
  } | null>(null);
  const [helpState, setHelpState] = useState<ParagraphPanelState>({ status: "loading" });
  const helpToken = useRef(0);
  const [phraseHit, setPhraseHit] = useState<{ at: string; hit: PhraseHit } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const restore = useRef<number | null>(useProgress.getState().items[bookId]?.scroll ?? null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // First open: read the whole book once (chapter text is big).
    void loadStoredBook(bookId).then((next) => {
      if (!alive) return;
      if (!next) setMissing(true);
      else {
        setBook(next);
        fillPrepared(bookId, next.glossary);
      }
    });
    // A word list added or updated while the book is open (the "cibian-progress" event): merge it in.
    const refresh = () => {
      timer = null;
      void loadBookMeta(bookId).then((meta) => {
        if (!alive || !meta) return;
        setBook((prev) =>
          prev
            ? { ...prev, glossary: meta.glossary, pending: meta.pending, totalHard: meta.totalHard }
            : prev,
        );
        fillPrepared(bookId, meta.glossary);
      });
    };
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId !== bookId || timer) return;
      timer = setTimeout(refresh, 400);
    };
    window.addEventListener("cibian-progress", onProgress);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("cibian-progress", onProgress);
    };
  }, [bookId, fillPrepared]);

  const lastChapter = book ? Math.max(book.chapters.length - 1, 0) : 0;
  // A book opened for the first time starts at the first chapter with real text,
  // skipping the cover, title page and contents.
  const firstReal = useMemo(() => {
    if (!bookChaptersRaw) return 0;
    // "Real" prose = enough text, in paragraph-sized pieces (a contents page is many short lines).
    const at = bookChaptersRaw.findIndex((item) => {
      const chars = item.paragraphs.join(" ").length;
      return chars > 1200 && chars / Math.max(1, item.paragraphs.length) > 60;
    });
    return at < 0 ? 0 : at;
  }, [bookChaptersRaw]);
  const safeIndex = Math.min(chapterIndex < 0 ? firstReal : chapterIndex, lastChapter);
  const chapter = book?.chapters[safeIndex];
  const chapterHtml = chapter?.html ?? "";

  const marked = useMemo(() => {
    const ready = new Set<string>();
    // Word lists may name extra forms ("sawn" -> "saw"); the book's own list decides.
    const forms = new Map<string, string>();
    if (book) {
      for (const [key, gloss] of Object.entries(book.glossary)) {
        ready.add(key);
        for (const form of gloss.forms ?? []) if (!forms.has(form)) forms.set(form, key);
      }
    }
    return { ready, forms };
  }, [book]);
  const resolveKey = useCallback(
    (surface: string) => {
      const plain = lookupKey(surface);
      if (marked.ready.has(plain)) return plain;
      const exact = surface.toLowerCase();
      if (marked.ready.has(exact)) return exact;
      return marked.forms.get(exact) ?? plain;
    },
    [marked],
  );
  const linkedHtml = useMemo(
    () => (chapterHtml ? readingHtml(chapterHtml, marked.ready, resolveKey) : ""),
    [chapterHtml, marked, resolveKey],
  );
  const bookChapters = book?.chapters;
  const bookStats = useMemo(() => (bookChapters ? indexBook(bookChapters) : {}), [bookChapters]);

  const savedKeys = useMemo(
    () =>
      new Set(
        words.filter((word) => word.bookId === bookId).map((word) => word.lemma.toLowerCase()),
      ),
    [words, bookId],
  );

  // Paint saved words and the selected word straight onto the page. Doing it in the DOM
  // (not in the HTML string) keeps the scroll position and selection when you save a word.
  const pickedIndex = picked?.index ?? "";
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-word]")) {
      const key = resolveKey(button.dataset.word ?? "");
      button.classList.toggle("book-saved", savedKeys.has(key));
      button.classList.toggle("book-on", pickedIndex !== "" && button.dataset.i === pickedIndex);
    }
  }, [linkedHtml, savedKeys, pickedIndex, resolveKey]);

  // Restore the saved reading position once per chapter, after its text is on screen.
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root || !linkedHtml) return;
    const target = restore.current;
    restore.current = null;
    if (target === null || target <= 0) {
      window.scrollTo({ top: 0 });
      setScrolled(0);
      return;
    }
    const place = () => {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(1, root.offsetHeight - window.innerHeight);
      window.scrollTo({ top: top + target * span });
    };
    place();
    setScrolled(target);
    // Fonts, pictures and banners change the page height right after load; keep the
    // saved spot until the reader scrolls on their own (or a few seconds pass).
    let cancelled = false;
    const observer = new ResizeObserver(() => {
      if (!cancelled) place();
    });
    observer.observe(root);
    observer.observe(document.body);
    const stop = () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    const timer = setTimeout(stop, 2500);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [linkedHtml, safeIndex]);

  // Track and save position in the chapter.
  useEffect(() => {
    if (!book) return;
    let frame = 0;
    let saver: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      frame = 0;
      const root = articleRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const span = Math.max(1, rect.height - window.innerHeight);
      const value = Math.min(1, Math.max(0, -rect.top / span));
      setScrolled(value);
      if (saver) clearTimeout(saver);
      saver = setTimeout(() => saveProgress(bookId, { scroll: value }), 400);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (saver) clearTimeout(saver);
    };
  }, [book, bookId, saveProgress, safeIndex]);

  useEffect(() => {
    if (book) saveProgress(bookId, { chapter: safeIndex, chapters: book.chapters.length });
  }, [book, bookId, safeIndex, saveProgress]);

  const goChapter = useCallback(
    (index: number) => {
      if (!book) return;
      const next = Math.min(Math.max(0, index), book.chapters.length - 1);
      restore.current = null;
      setChapterIndex(next);
      setPicked(null);
      setHelp(null);
      setScrolled(0);
      saveProgress(bookId, { chapter: next, chapters: book.chapters.length, scroll: 0 });
      window.scrollTo({ top: 0 });
    },
    [book, bookId, saveProgress],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicked(null);
        setHelp(null);
      }
    };
    // A click anywhere outside the card (and not on a word) closes it.
    const onClickAway = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || !target.closest) return;
      const inside =
        'aside[data-word-card], aside[data-para-panel], [data-para-ui], button[data-word], header, [role="dialog"], [data-radix-popper-content-wrapper]';
      // A button inside a card may remove itself when it is pressed (for example "Explain this
      // sentence"). Look at the path the click took, so it still counts as a click inside.
      const path = (event.composedPath?.() ?? []) as Element[];
      if (target.closest(inside) || path.some((node) => node.matches?.(inside))) return;
      setPicked(null);
      setHelp(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClickAway);
    };
  }, []);

  const pickedKey = picked ? resolveKey(picked.surface) : "";
  // A phrasal verb or idiom that contains the tapped word (from the word list).
  const pickedSentence = picked
    ? wholeSentence(picked.paragraph, picked.surface, picked.before.length)
    : "";
  const phraseAt = picked ? `${picked.index}|${picked.surface}|${pickedSentence}` : "";
  useEffect(() => {
    if (!picked || !pickedSentence) return;
    let alive = true;
    const at = phraseAt;
    const surface = picked.surface;
    void findPhrase(bookId, pickedSentence, surface).then((hit) => {
      if (alive) setPhraseHit(hit ? { at, hit } : null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, phraseAt]);

  function paragraphElement(index: number): Element | null {
    const root = articleRef.current;
    return root ? (paragraphBlocks(root)[index] ?? null) : null;
  }

  function openHelp(index: number) {
    const el = paragraphElement(index);
    if (!el || !book) return;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const r = el.getBoundingClientRect();
    const art = articleRef.current?.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    setPicked(null);
    setHelp({
      index,
      // phone: the sheet goes on the edge that is away from the middle of the visible paragraph
      dock: (top + bottom) / 2 > window.innerHeight * 0.5 ? "top" : "bottom",
      // desktop: the side with more free room
      side: art && art.left > vw - art.right ? "left" : "right",
    });
    setHelpState({ status: "loading" });
    helpToken.current += 1;
    const token = helpToken.current;
    void loadParagraphView({
      bookId,
      chapter: safeIndex,
      paragraph: index,
      text,
    }).then((view) => {
      if (helpToken.current !== token) return;
      setHelpState(view ? { status: "ready", view } : { status: "none" });
    });
  }

  function closeHelp() {
    helpToken.current += 1;
    setHelp(null);
  }

  /** Open the word card for a word button on the page (shared by taps and the hard-word list). */
  function pickButton(button: Element) {
    const surface = button.getAttribute("data-word") ?? "";
    const block = button.closest("p, li, blockquote, h1, h2, h3, h4");
    const paragraph = (block?.textContent ?? surface).replace(/\s+/g, " ").trim();
    let before = "";
    if (block) {
      const range = document.createRange();
      range.setStart(block, 0);
      range.setEndBefore(button);
      before = range.toString().replace(/\s+/g, " ").trimStart();
    }
    // Put the card on the far side of the tapped word. Nothing here touches the
    // page: no scrolling, no padding. The text stays exactly where it is.
    const at = button.getBoundingClientRect();
    setPlace({
      dock: at.bottom > window.innerHeight * 0.54 ? "top" : "bottom",
      side: at.left + at.width / 2 < window.innerWidth / 2 ? "right" : "left",
    });
    closeHelp();
    setPhraseHit(null);
    setPicked({
      surface,
      paragraph,
      index: button.getAttribute("data-i") ?? "",
      nth: Number(button.getAttribute("data-n")) || 0,
      before,
    });
  }

  /** A hard word from the paragraph panel: find it in the paragraph and open its normal card. */
  function pickFromParagraph(word: string) {
    if (!help) return;
    const el = paragraphElement(help.index);
    if (!el) return;
    const tokens = (word.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).map((t) => t.toLowerCase());
    if (tokens.length === 0) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button[data-word]")];
    const same = (i: number) =>
      tokens.every((t, k) => (buttons[i + k]?.dataset.word ?? "").toLowerCase() === t);
    let at = -1;
    for (let i = 0; i < buttons.length; i += 1) {
      if (same(i)) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      at = buttons.findIndex((b) => tokens.includes((b.dataset.word ?? "").toLowerCase()));
      if (at < 0) return;
      pickButton(buttons[at] as Element);
      return;
    }
    const group = buttons.slice(at, at + tokens.length);
    const best =
      group.find((b) => b.classList.contains("book-hard")) ??
      [...group].sort((a, b) => (b.dataset.word?.length ?? 0) - (a.dataset.word?.length ?? 0))[0];
    if (best) pickButton(best);
  }

  if (missing) {
    return (
      <div className="mx-auto grid max-w-md gap-4 px-6 py-16 text-center">
        <p className="font-display text-2xl font-semibold">{t("reader.missingTitle")}</p>
        <p className="text-muted">{t("reader.missingBody")}</p>
        <button type="button" className={cn(btn.primary, "justify-self-center")} onClick={onBack}>
          {t("reader.backShelf")}
        </button>
      </div>
    );
  }

  if (!book || !chapter) {
    return (
      <div className="mx-auto grid max-w-md justify-items-center gap-4 px-6 py-24" aria-busy="true">
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="text-muted">{t("reader.opening")}</p>
      </div>
    );
  }

  /** The example sentence written in the word list, when it is not the sentence that was tapped. */
  function exampleOf(gloss: Gloss, sentence: string): string | undefined {
    const raw = (gloss as Gloss & { example?: unknown }).example;
    const example = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (!example) return undefined;
    const a = example.toLowerCase().replace(/[^a-z]+/g, "");
    const b = sentence.toLowerCase().replace(/[^a-z]+/g, "");
    return a && (b.includes(a) || a.includes(b)) ? undefined : example;
  }

  function cardFor(tap: NonNullable<typeof picked>): CardState {
    const { surface, paragraph } = tap;
    const key = resolveKey(surface);
    const gloss: Gloss | undefined = book?.glossary[key];
    const sentence = sentenceAround(paragraph, surface, tap.before.length);
    const fullSentence = wholeSentence(paragraph, surface, tap.before.length);
    if (gloss) {
      // Which meaning fits this place in the book? (word list format version 2)
      const choice = pickSense(key, gloss, {
        chapter: safeIndex,
        surface,
        occurrence: tap.nth,
        paragraph,
        before: tap.before,
      });
      return {
        surface,
        key,
        pos: contextPos(surface, choice.pos),
        meaning: choice.meaning,
        whyHard: choice.whyHard,
        sentence,
        fullSentence,
        ready: true,
        status: "ready",
        others: choice.others,
        coined: gloss.coined === true,
        example: exampleOf(gloss, sentence),
      };
    }
    if (isEasyKey(key)) {
      return {
        surface,
        key,
        pos: "",
        meaning: tr("card.easy"),
        whyHard: "",
        sentence,
        fullSentence,
        ready: true,
        status: "easy",
      };
    }
    // Not in this book's word list: say so in a friendly way. Nothing is looked up online.
    return {
      surface,
      key,
      pos: "",
      meaning: "",
      whyHard: "",
      sentence,
      fullSentence,
      ready: false,
      status: "unknown",
    };
  }

  const card = picked ? cardFor(picked) : null;
  const alreadySaved = pickedKey ? savedKeys.has(pickedKey) : false;
  const noList = Object.keys(book.glossary).length === 0;
  const fraction = overallProgress({
    chapter: safeIndex,
    chapters: book.chapters.length,
    scroll: scrolled,
    updatedAt: 1,
  });
  const style = readerVars(prefs) as React.CSSProperties;
  const focus = prefs.focus;

  return (
    <div style={style} className="min-h-dvh">
      <header
        className={cn(
          "sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur transition-transform duration-300",
          focus && "-translate-y-full",
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-[calc(var(--reader-width,40rem)+4rem)] items-center gap-1 px-2 sm:px-4">
          <button
            type="button"
            className={btn.icon}
            onClick={onBack}
            aria-label={t("reader.backShelf")}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <Contents chapters={book.chapters} current={safeIndex} onPick={goChapter} />
          <div className="min-w-0 flex-1 px-2 text-center leading-tight">
            <p className="truncate font-display text-[0.95rem] font-semibold">{book.title}</p>
            <p className="truncate text-xs text-muted" lang="en">
              {chapter.title}
            </p>
          </div>
          <ReaderSettings />
          <button
            type="button"
            className={btn.icon}
            onClick={onNotebook}
            aria-label={t("reader.openNotebook")}
          >
            <BookMarked className="size-5" aria-hidden />
          </button>
        </div>
        <ProgressBar value={fraction} className="h-0.5 rounded-none" label={t("reader.progress")} />
      </header>

      {focus ? (
        <button
          type="button"
          onClick={() => prefs.set({ focus: false })}
          className="fixed top-3 right-3 z-30 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-card/90 px-3 text-xs font-semibold text-muted opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          <Focus className="size-3.5" aria-hidden />
          {t("reader.exitFocus")}
        </button>
      ) : null}

      <main className="px-5 pt-8 pb-12 sm:px-8 sm:pt-12">
        {linkedHtml ? (
          <article
            ref={articleRef}
            className="book-body"
            lang="en"
            onClick={(event) => {
              event.preventDefault();
              const button = (event.target as HTMLElement).closest("button[data-word]");
              if (!button) {
                setPicked(null);
                closeHelp();
                return;
              }
              pickButton(button);
            }}
            dangerouslySetInnerHTML={{ __html: linkedHtml }}
          />
        ) : (
          <article ref={articleRef} className="book-body" lang="en">
            <h2>{chapter.title}</h2>
            {chapter.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        )}

        <nav
          aria-label={t("reader.nav")}
          className="mx-auto mt-12 grid max-w-[var(--reader-width,40rem)] gap-3 border-t border-line pt-6"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(btn.quiet, "flex-1")}
              disabled={safeIndex <= 0}
              onClick={() => goChapter(safeIndex - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("reader.prev")}
            </button>
            <button
              type="button"
              className={cn(btn.primary, "flex-1")}
              disabled={safeIndex >= book.chapters.length - 1}
              onClick={() => goChapter(safeIndex + 1)}
            >
              {t("reader.next")}
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-center text-xs tabular-nums text-muted">
            {t("reader.chapterOf", {
              n: safeIndex + 1,
              total: book.chapters.length,
              pct: Math.round(fraction * 100),
            })}
          </p>
        </nav>
      </main>

      {linkedHtml ? (
        <ParagraphMarker
          articleRef={articleRef}
          version={linkedHtml}
          activeIndex={help ? help.index : null}
          hide={Boolean(help) || Boolean(picked)}
          onOpen={openHelp}
        />
      ) : null}

      {help ? (
        <ParagraphPanel
          state={helpState}
          dock={help.dock}
          side={help.side}
          onClose={closeHelp}
          onWord={pickFromParagraph}
        />
      ) : null}

      {card ? (
        <WordCard
          state={card}
          stat={bookStats[pickedKey]}
          saved={alreadySaved}
          dock={place.dock}
          side={place.side}
          phrase={phraseHit && phraseHit.at === phraseAt ? phraseHit.hit : null}
          bookId={bookId}
          noList={noList}
          chapter={safeIndex}
          onClose={() => setPicked(null)}
          onToggle={() => {
            if (!picked) return;
            if (alreadySaved) {
              removeWordByLemma(bookId, pickedKey);
              return;
            }
            addWords(bookId, [
              {
                surface: picked.surface,
                lemma: pickedKey,
                pos: card.pos,
                meaning: card.meaning,
                whyHard: card.whyHard,
                recommend: !isEasyKey(pickedKey),
                sentence: card.sentence,
                seen: bookStats[pickedKey]?.count,
                uses:
                  bookStats[pickedKey] && bookStats[pickedKey].uses.length > 1
                    ? bookStats[pickedKey].uses.join(" and ")
                    : "",
              },
            ]);
          }}
        />
      ) : null}
    </div>
  );
}
