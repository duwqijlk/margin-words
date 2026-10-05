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
import { loadBookExtras, loadBookMeta, loadStoredBook, type Gloss, type StoredBook } from "@/lib/book-db";
import { readingSlots } from "@/lib/epub";
import { phrasePoint, pointFromEntry } from "@/lib/gloss-ref";
import {
  entryAppliesAt,
  hasTrickySense,
  markWordRanges,
  pickSense,
  plainSurface,
  readingHtml,
  TAP_WORD_PATTERN,
  type OtherMeaning,
} from "@/lib/glossary-format";
import type { PhraseEntry } from "@/lib/glossary-extras";
import { hyphenateReadingHtml } from "@/lib/hyphenate";
import { phraseWordMarks, phraseWordRanges } from "@/lib/help-match";
import { findPhrase, paragraphBlocks } from "@/lib/help-lookup";
import { loadParagraphView } from "@/lib/help-flow";
import { tr, useT, type Key } from "@/lib/i18n";
import { useJump } from "@/lib/jump-store";
import { findSentence, makeAnchor, resolveAnchor, restoreReadingPlace, type TextAnchor } from "@/lib/position";
import { legacyChapter, overallProgress, useProgress } from "@/lib/progress-store";
import { bookSyncKey } from "@/lib/sync-merge";
import type { WordSource } from "@/lib/vocab-model";
import { hasSourceFrom, savedFromCard } from "@/lib/wordbook";
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
  resolveGlossKey,
  sentenceAround,
  surfaceOffset,
  type WordStat,
} from "@/lib/text";
import { useVocab } from "@/lib/vocab-store";
import { flowCutOffsets, flowText, flowTextBefore } from "@/lib/flow-text";
import { FloatingAside } from "@/components/floating-card";
import { MissingBook } from "@/components/missing-book";
import { READER_GUTTER, SIDE_PANEL } from "@/components/side-panel";
import {
  btn,
  cn,
  field,
  Highlighted,
  ProgressBar,
  Segmented,
  SpeakButton,
  speakEnglish,
} from "@/components/ui";
import {
  ExplainSentence,
  ParagraphBulbs,
  ParagraphPanel,
  type ParagraphPanelState,
} from "@/components/help-panels";

/* ------------------------------------------------------------------ book HTML */

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
  rows,
  onPickRow,
}: {
  chapters: Array<{ title: string }>;
  current: number;
  onPick: (index: number) => void;
  rows?: Array<{ key: string; mark: string; title: string; active: boolean }>;
  onPickRow?: (key: string) => void;
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
          {(rows ? rows.length : chapters.length) > 12 ? (
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
            {rows
              ? rows.map((row) => {
                  if (q && !row.title.toLowerCase().includes(q)) return null;
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        ref={row.active ? currentRef : undefined}
                        aria-current={row.active ? "true" : undefined}
                        onClick={() => {
                          onPickRow?.(row.key);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[0.95rem] leading-snug transition-colors",
                          row.active
                            ? "bg-accent-soft font-semibold text-accent"
                            : "hover:bg-accent-soft/60",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 text-right text-xs text-muted",
                            row.mark.length > 2 ? "w-12" : "w-7 tabular-nums",
                          )}
                        >
                          {row.mark}
                        </span>
                        <span className="min-w-0 flex-1" lang="en">
                          {row.title}
                        </span>
                      </button>
                    </li>
                  );
                })
              : null}
            {rows
              ? null
              : chapters.map((chapter, index) => {
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
  /** The same sense, said for this sentence. */
  here?: string;
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

/** The whole sentence around a tapped word, and where that word starts inside it. */
function locateSentence(
  paragraph: string,
  surface: string,
  at: number,
): { text: string; offset: number } {
  const idx = surfaceOffset(paragraph, surface, at);
  if (idx < 0) return { text: paragraph.slice(0, 600), offset: -1 };
  let start = 0;
  let end = paragraph.length;
  for (const mark of [".", "?", "!"]) {
    const a = paragraph.lastIndexOf(mark, idx - 1);
    if (a >= 0) start = Math.max(start, a + 1);
    const z = paragraph.indexOf(mark, idx + surface.length);
    if (z >= 0) end = Math.min(end, z + 1);
  }
  const raw = paragraph.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), offset: idx - start - lead };
}

/** The whole sentence around a tapped word (not shortened). */
function wholeSentence(paragraph: string, surface: string, at: number): string {
  return locateSentence(paragraph, surface, at).text;
}

type PhraseHit = {
  key: string;
  entry: { meaning: string; pos?: string; example?: string; here?: string };
  matched: string;
};

/** Part of speech beside the word. Large and high-contrast, and it drops under a long word. */
function wordPosClass(quiet = false) {
  return cn(
    "inline-flex max-w-full items-center rounded-full font-bold leading-none tracking-tight",
    quiet
      ? "bg-line px-3.5 py-1.5 text-xl text-ink"
      : "bg-accent px-4 py-2 text-2xl text-accent-ink",
  );
}

function SceneLine({ text, plain = false }: { text: string; plain?: boolean }) {
  const { t } = useT();
  return (
    <section className="grid gap-1" data-part="word-here">
      <h3 className="text-xs font-semibold text-muted">{t("card.here")}</h3>
      <p className={plain ? "text-[1.05rem] leading-relaxed" : "rounded-xl bg-paper px-3.5 py-3 text-[1.05rem] leading-relaxed"} lang="en">
        {text}
      </p>
    </section>
  );
}

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
  phrase,
  canSave,
  bookId,
  chapter,
  noteChapter,
  noList,
  anchor,
  onClose,
  onToggle,
}: {
  state: CardState;
  /** a phrasal verb or idiom that contains the tapped word */
  phrase: PhraseHit | null;
  /** The notebook can take this card. A phrase counts even when the tapped word has no entry of its own. */
  canSave: boolean;
  bookId: string;
  chapter: number;
  /** Chapter index, or an extra id such as "x3" when the note sits on a recovered contents file. */
  noteChapter?: number | string;
  /** this book has no word list at all (for example a book the user added without one) */
  noList: boolean;
  stat: WordStat | undefined;
  saved: boolean;
  /** the tapped word, so a wide screen can float the card next to it */
  anchor: HTMLElement | null;
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
      <p className="rounded-xl bg-paper px-3.5 py-3 text-[1.05rem] leading-relaxed" lang="en" data-part="word-meaning">
        {state.meaning}
      </p>
    );
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("card.aria", { word: state.key })}
      kind="word"
      className={cn(
        // Always out of the page flow (fixed): opening, moving or closing it can never move the text.
        // Phone: a sheet on the bottom edge. Tablet: a column on the right, in the gutter the page
        // keeps free (see READER_GUTTER). Wide screens float this card next to the tapped word.
        // A card with a scene line needs room for that line and the book sentence.
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop",
        state.here || phrase?.entry.here ? "max-h-[72dvh]" : "max-h-[46dvh]",
        "inset-x-0 bottom-0 rounded-t-3xl border-t pt-3",
        SIDE_PANEL,
      )}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden" aria-hidden />
      <div className="grid gap-3.5">
        <div className="grid min-w-0 gap-1">
          {/* The close control sits in the corner. A short float keeps the first line
              clear of it; the next line uses the full width, so a long word stays whole. */}
          <div className="relative flow-root min-w-0" data-word-head>
            <span className="float-right h-8 w-9" aria-hidden />
            <button
              type="button"
              className={cn(btn.icon, "absolute top-0 right-0 z-10 -mt-2 -mr-2")}
              onClick={onClose}
              aria-label={t("card.close")}
              data-panel-close
            >
              <X className="size-5" aria-hidden />
            </button>
            <h2
              className={cn(
                "inline font-display text-[1.85rem] leading-tight font-semibold tracking-tight",
                (phrase || state.pos || state.status === "easy") && "mr-3",
              )}
              lang="en"
            >
              {phrase ? phrase.key : state.key}
            </h2>
            {phrase ? (
              <span className={cn(wordPosClass(), "align-baseline")} data-phrase-pos data-word-pos>
                {phrase.entry.pos ? <span lang="en">{phrase.entry.pos}</span> : t("card.phraseFallback")}
              </span>
            ) : state.pos ? (
              <span className={cn(wordPosClass(), "align-baseline")} data-word-pos>
                <span lang="en">{state.pos}</span>
              </span>
            ) : state.status === "easy" ? (
              <span className={cn(wordPosClass(true), "align-baseline")} data-word-pos>
                {t("card.easyChip")}
              </span>
            ) : null}
          </div>
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

        <SpeakButton text={phrase ? phrase.key : state.key} className="-ml-3 w-fit" />

        {phrase ? (
          <>
            {phrase.entry.here ? (
              <h3 className="text-xs font-semibold text-muted" data-part="meaning-label">
                {t("card.plain")}
              </h3>
            ) : null}
            <p className="rounded-xl bg-paper px-3.5 py-3 text-[1.05rem] leading-relaxed" lang="en" data-part="phrase-meaning">
              {phrase.entry.meaning}
            </p>
            {phrase.entry.here ? <SceneLine text={phrase.entry.here} /> : null}
            <section
              className="grid gap-1.5 rounded-lg border border-line px-3 py-2.5"
              aria-label={t("card.alone")}
              data-part="word-alone"
            >
              <h3 className="text-xs font-semibold text-muted">{t("card.alone")}</h3>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
                <span className="w-fit max-w-full shrink-0 font-display text-lg font-semibold break-words" lang="en">
                  {state.key}
                </span>
                {state.pos ? (
                  <span className={wordPosClass(true)} data-word-pos>
                    <span lang="en">{state.pos}</span>
                  </span>
                ) : null}
              </div>
              {meaningBlock}
              {state.coined ? <CoinedBadge /> : null}
            </section>
          </>
        ) : state.here ? (
          <>
            <div className="grid gap-2 rounded-xl bg-paper px-3.5 py-3">
              <h3 className="text-xs font-semibold text-muted" data-part="meaning-label">
                {t("card.plain")}
              </h3>
              <p className="text-[1.05rem] leading-relaxed" lang="en" data-part="word-meaning">
                {state.meaning}
              </p>
              <SceneLine text={state.here} plain />
            </div>
            {state.coined ? <CoinedBadge /> : null}
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
            key={`${noteChapter ?? chapter}|${state.sentence}`}
            bookId={bookId}
            chapter={noteChapter ?? chapter}
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

        <div
          className={cn(
            // The main action stays in view while the card scrolls.
            "sticky bottom-0 z-10 -mx-5 grid bg-card px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5",
          )}
        >
          <button
            type="button"
            className={saved ? btn.quiet : btn.primary}
            disabled={!saved && !canSave}
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
      </div>
    </FloatingAside>
  );
}

/** Tablet only: a quiet hint in the right-hand column. Wide screens have no column, so this stays hidden. */
function SidePlaceholder() {
  const { t } = useT();
  return (
    <aside
      aria-hidden="true"
      data-side-placeholder
      className={cn(
        "pointer-events-none fixed z-0 hidden content-start gap-1 border border-dashed border-line px-5 py-5 text-sm text-muted",
        "md:grid lg:hidden",
        SIDE_PANEL,
        "md:bottom-auto md:h-40",
      )}
    >
      <p className="font-semibold">{t("reader.sideTitle")}</p>
      <p>{t("reader.sideHint")}</p>
      <p>{t("about.markPhrase")}</p>
      <p>{t("reader.trickyHint")}</p>
    </aside>
  );
}

/* ------------------------------------------------------------------ reader */

/** The first paragraph that is still (partly) below the top bar, as a file-independent place. */
function topAnchor(root: HTMLElement | null, chapter: number): TextAnchor | null {
  if (!root) return null;
  const blocks = paragraphBlocks(root);
  const at = blocks.findIndex((block) => block.getBoundingClientRect().bottom > 72);
  const block = at >= 0 ? blocks[at] : undefined;
  if (!block) return null;
  const text = flowText(block);
  return text ? makeAnchor({ chapter, paragraph: at, text, at: 0 }) : null;
}

export function ReaderScreen({
  bookId,
  onBack,
  onNotebook,
  onAddEpub,
  onDiscover,
}: {
  bookId: string;
  onBack: () => void;
  onNotebook: () => void;
  onAddEpub: () => void;
  onDiscover: () => void;
}) {
  const { t } = useT();
  const words = useVocab((state) => state.words);
  const shelfBook = useVocab((state) => state.books.find((item) => item.id === bookId));
  const saveWord = useVocab((state) => state.saveWord);
  const removeWordFromBook = useVocab((state) => state.removeWordFromBook);
  const setSourcePlaces = useVocab((state) => state.setSourcePlaces);
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
  const [extraId, setExtraId] = useState(
    () => useProgress.getState().items[bookId]?.extraId ?? "",
  );
  const [scrolled, setScrolled] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [picked, setPicked] = useState<{
    surface: string;
    paragraph: string;
    index: string;
    /** which time this word form appears in the chapter (1-based) */
    nth: number;
    /** the paragraph text before the word */
    before: string;
    /** which paragraph of the chapter this is, counted the way the word list counts them */
    block: number;
  } | null>(null);
  // Paragraph help (overlay). `index` is the paragraph number from paragraphBlocks().
  const [help, setHelp] = useState<{ index: number } | null>(null);
  const [helpState, setHelpState] = useState<ParagraphPanelState>({ status: "loading" });
  const helpToken = useRef(0);
  const [phraseHit, setPhraseHit] = useState<{ at: string; hit: PhraseHit } | null>(null);
  // True from the tap until the phrase lookup answers, so an easy word like "in" is not saved first.
  const [phrasePending, setPhrasePending] = useState(false);
  // Phrases live beside the word list. Empty until that record loads, then the dotted line appears.
  const [phraseList, setPhraseList] = useState<Record<string, PhraseEntry>>({});
  const [listSource, setListSource] = useState("");
  const articleRef = useRef<HTMLElement | null>(null);
  const restore = useRef<number | null>(useProgress.getState().items[bookId]?.scroll ?? null);
  // A place found through the file-independent anchor (saved position, or "go to the sentence" from the wordbook).
  const restoreAt = useRef<{ paragraph: number; flash: boolean } | null>(null);

  const waitingFile = useRef(false);
  // True once a full read is on screen. A word-list event before that must re-read the book:
  // patching an empty screen would drop the new list.
  const bookShown = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A full-book read keeps the IndexedDB snapshot from the moment it started. The word list
    // can be replaced while that read is still going (Alice's chapter text is large). Adopting
    // the snapshot afterwards would put the old list back on screen, after the refresh had
    // already shown the new one. Each newer request bumps this, and the older read is dropped.
    let generation = 0;
    waitingFile.current = false;
    bookShown.current = false;
    const adopt = (next: StoredBook, seen: number) => {
      if (!alive || seen !== generation) return;
      waitingFile.current = false;
      bookShown.current = true;
      const jump = useJump.getState().take(bookId);
      const saved = useProgress.getState().items[bookId];
      if (jump?.at && next.chapters.length > 0) {
        // A jump from the wordbook names a numbered chapter. It leaves an extra page.
        const hit = resolveAnchor(
          jump.at,
          next.chapters.map((item) => item.paragraphs),
        );
        restoreAt.current = { paragraph: hit.paragraph, flash: true };
        setChapterIndex(hit.chapter);
        setExtraId("");
      } else if (saved) {
        // extraId keeps the reader on that extra; the anchor is then a paragraph of the extra.
        const place = restoreReadingPlace(saved, {
          chapters: next.chapters.map((item) => item.paragraphs),
          extras: next.extras,
        });
        if (place.paragraph !== null) restoreAt.current = { paragraph: place.paragraph, flash: false };
        setExtraId(place.extraId);
        if (!place.extraId && place.paragraph !== null) setChapterIndex(place.chapter);
      }
      setMissing(false);
      setBook(next);
      fillPrepared(bookId, next.glossary);
    };
    const readWhole = (seen: number) => {
      void loadStoredBook(bookId).then((next) => {
        if (!alive || seen !== generation) return;
        if (!next) {
          waitingFile.current = true;
          setMissing(true);
        } else adopt(next, seen);
      });
    };
    // First open: read the whole book once (chapter text is big).
    readWhole(generation);
    // A word list added or updated while the book is open (the "cibian-progress" event): merge it in.
    // The same event fires when the missing file has just been downloaded or paired.
    const refresh = (seen: number) => {
      timer = null;
      if (!alive || seen !== generation) return;
      // Still loading, or the file just arrived: the light glossary read cannot draw the chapter.
      if (waitingFile.current || !bookShown.current) {
        readWhole(seen);
        return;
      }
      void loadBookMeta(bookId).then((meta) => {
        if (!alive || seen !== generation || !meta) return;
        setBook((prev) =>
          prev
            ? {
                ...prev,
                glossary: meta.glossary,
                pending: meta.pending,
                totalHard: meta.totalHard,
                ...(meta.bundled ? { bundled: meta.bundled } : {}),
              }
            : prev,
        );
        fillPrepared(bookId, meta.glossary);
      });
    };
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId !== bookId || timer) return;
      // Drop any full-book read that started before this write, before it can paint the old list.
      generation += 1;
      const seen = generation;
      timer = setTimeout(() => refresh(seen), 400);
    };
    window.addEventListener("cibian-progress", onProgress);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("cibian-progress", onProgress);
    };
  }, [bookId, fillPrepared]);

  useEffect(() => {
    let alive = true;
    setListSource("");
    const pull = () => {
      void loadBookExtras(bookId).then((extras) => {
        if (!alive) return;
        setPhraseList(extras?.phrases ?? {});
        setListSource(extras?.source ?? "");
      });
    };
    pull();
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId === bookId) pull();
    };
    window.addEventListener("cibian-progress", onProgress);
    return () => {
      alive = false;
      window.removeEventListener("cibian-progress", onProgress);
    };
  }, [bookId]);

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
  const activeExtra = book?.extras?.find((item) => item.id === extraId) ?? null;
  const chapterHtml = activeExtra ? (activeExtra.html ?? "") : (chapter?.html ?? "");
  const viewChapter = activeExtra ? -1 : safeIndex;
  const slots = useMemo(
    () => (book?.extras && book.extras.length > 0 ? readingSlots(book) : null),
    [book],
  );

  const marked = useMemo(() => {
    const ready = new Set<string>();
    // Entries that hold only position-based senses: underlined at their anchors, not everywhere.
    const sparse = new Map<string, Gloss>();
    // Entries with a sense flagged trickyMeaning: marked at the anchors where that sense resolves.
    const tricky = new Map<string, Gloss>();
    // Word lists may name extra forms ("sawn" -> "saw"); the book's own list decides.
    const forms = new Map<string, string>();
    // Stored key for each straightened spelling, so a curly apostrophe still finds the entry.
    const keys = new Map<string, string>();
    if (book) {
      for (const [key, gloss] of Object.entries(book.glossary)) {
        ready.add(key);
        if (!keys.has(key)) keys.set(key, key);
        const straight = plainSurface(key);
        if (!keys.has(straight)) keys.set(straight, key);
        if (gloss.senseOnly === true) sparse.set(key, gloss);
        if (hasTrickySense(gloss)) tricky.set(key, gloss);
        for (const form of gloss.forms ?? []) {
          const name = plainSurface(form);
          if (name && !forms.has(name)) forms.set(name, key);
        }
      }
    }
    return { ready, forms, sparse, tricky, keys };
  }, [book]);
  const resolveKey = useCallback(
    (surface: string) => resolveGlossKey(surface, marked.keys, marked.forms),
    [marked],
  );
  const linkedHtml = useMemo(() => {
    if (!chapterHtml) return "";
    const words = readingHtml(chapterHtml, marked.ready, resolveKey, viewChapter, marked.sparse, marked.tricky);
    const withPhrases =
      Object.keys(phraseList).length > 0
        ? markWordRanges(words, (paragraph) => phraseWordRanges(phraseList, paragraph), "book-phrase")
        : words;
    return hyphenateReadingHtml(withPhrases);
  }, [chapterHtml, marked, resolveKey, viewChapter, phraseList]);
  const bookChapters = book?.chapters;
  const bookStats = useMemo(() => (bookChapters ? indexBook(bookChapters) : {}), [bookChapters]);

  const bookKey = shelfBook ? bookSyncKey(shelfBook) : "";
  const savedKeys = useMemo(
    () =>
      new Set(
        words.filter((word) => bookKey !== "" && hasSourceFrom(word, bookKey)).map((word) => word.lemma.toLowerCase()),
      ),
    [words, bookKey],
  );

  // Paint saved words and the selected word straight onto the page. Doing it in the DOM
  // (not in the HTML string) keeps the scroll position and selection when you save a word.
  const pickedIndex = picked?.index ?? "";
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-word]")) {
      const key = resolveKey(button.dataset.word ?? "");
      const sparseOff =
        marked.sparse.has(key) &&
        !button.classList.contains("book-hard") &&
        !button.classList.contains("book-tricky");
      button.classList.toggle("book-saved", savedKeys.has(key) && !sparseOff);
      button.classList.toggle("book-on", pickedIndex !== "" && button.dataset.i === pickedIndex);
    }
    // A saved phrase marks its own words, not the single easy word that was tapped.
    const savedPhrases = Object.fromEntries(
      Object.entries(phraseList).filter(([key]) => savedKeys.has(key.toLowerCase())),
    );
    if (Object.keys(savedPhrases).length > 0) {
      const sel = "p, h1, h2, h3, h4, li, blockquote, div[data-para]";
      const all = [...root.querySelectorAll<HTMLElement>(sel)];
      const blocks = all.filter((block) => !all.some((other) => other !== block && block.contains(other)));
      for (const block of blocks) {
        const marks = phraseWordMarks(savedPhrases, flowText(block));
        if (marks.length === 0) continue;
        const starts = flowCutOffsets(
          block,
          (el) => el.localName === "button" && el.getAttribute?.("data-word") != null,
        );
        for (const button of block.querySelectorAll<HTMLButtonElement>("button[data-word]")) {
          if (button.closest(sel) !== block) continue;
          const word = button.getAttribute("data-word") ?? "";
          const start = starts.get(button);
          if (start === undefined || !word) continue;
          const end = start + word.length;
          if (marks.some((mark) => start >= mark.start && end <= mark.end)) button.classList.add("book-saved");
        }
      }
    }
  }, [linkedHtml, savedKeys, pickedIndex, resolveKey, marked, phraseList]);

  // Restore the saved reading position once per chapter, after its text is on screen.
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root || !linkedHtml) return;
    const target = restore.current;
    restore.current = null;
    const mark = restoreAt.current;
    restoreAt.current = null;
    const block = mark ? paragraphBlocks(root)[mark.paragraph] : undefined;
    let place: () => void;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    if (block) {
      place = () => {
        const top = block.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, top - 96) });
      };
      if (mark?.flash) {
        block.classList.add("book-flash");
        flashTimer = setTimeout(() => block.classList.remove("book-flash"), 3000);
      }
    } else if (target === null || target <= 0) {
      window.scrollTo({ top: 0 });
      setScrolled(0);
      return;
    } else {
      place = () => {
        const top = root.getBoundingClientRect().top + window.scrollY;
        const span = Math.max(1, root.offsetHeight - window.innerHeight);
        window.scrollTo({ top: top + target * span });
      };
    }
    place();
    if (!block && target !== null) setScrolled(target);
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
      if (flashTimer) clearTimeout(flashTimer);
      stop();
    };
  }, [linkedHtml, safeIndex, extraId]);

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
      saver = setTimeout(() => {
        const onExtra = Boolean(activeExtra);
        const anchor = topAnchor(articleRef.current, onExtra ? 0 : safeIndex);
        saveProgress(bookId, {
          scroll: value,
          ...(anchor ? { anchor } : {}),
          ...(onExtra && activeExtra ? { extraId: activeExtra.id } : {}),
        });
      }, 400);
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
  }, [book, bookId, saveProgress, safeIndex, activeExtra]);

  useEffect(() => {
    if (!book || !extraId) return;
    if (!book.extras?.some((item) => item.id === extraId)) setExtraId("");
  }, [book, extraId]);

  useEffect(() => {
    if (book) saveProgress(bookId, { chapter: safeIndex, chapters: book.chapters.length, extraId });
  }, [book, bookId, safeIndex, extraId, saveProgress]);

  // Positions saved before anchors existed get one now, from where the page actually is.
  useEffect(() => {
    if (!book || !linkedHtml) return;
    const timer = setTimeout(() => {
      const saved = useProgress.getState().items[bookId];
      if (extraId) {
        if (saved?.extraId === extraId && saved.anchor) return;
        const anchor = topAnchor(articleRef.current, 0);
        if (anchor) saveProgress(bookId, { anchor, extraId });
        return;
      }
      if (saved?.anchor && saved.anchor.chapter === safeIndex) return;
      const anchor = topAnchor(articleRef.current, safeIndex);
      if (anchor) saveProgress(bookId, { anchor });
    }, 900);
    return () => clearTimeout(timer);
  }, [book, bookId, linkedHtml, safeIndex, extraId, saveProgress]);

  // Saved words from before places were stored: find each sentence in this device's text once.
  useEffect(() => {
    if (!book || !bookKey) return;
    const timer = setTimeout(() => {
      const open = useVocab
        .getState()
        .words.flatMap((card) =>
          card.sources
            .filter((source) => source.book === bookKey && !source.ref && !source.at && source.sentence)
            .map((source) => ({ card, source })),
        );
      if (open.length === 0) return;
      const texts = book.chapters.map((item) => item.paragraphs);
      const updates = [];
      for (const { card, source } of open) {
        const sentence = source.sentence;
        if (!sentence) continue;
        const hit = findSentence(sentence, source.surface, texts, source.chapter);
        if (!hit) continue;
        updates.push({
          lemma: card.lemma,
          book: bookKey,
          sentence,
          chapter: hit.chapter,
          chapterTitle: book.chapters[hit.chapter]?.title,
          at: hit,
        });
      }
      setSourcePlaces(updates);
    }, 1200);
    return () => clearTimeout(timer);
  }, [book, bookKey, setSourcePlaces]);

  const goChapter = useCallback(
    (index: number) => {
      if (!book) return;
      const next = Math.min(Math.max(0, index), book.chapters.length - 1);
      restore.current = null;
      restoreAt.current = null;
      setExtraId("");
      setChapterIndex(next);
      setPicked(null);
      setHelp(null);
      setScrolled(0);
      const first = book.chapters[next]?.paragraphs[0] ?? "";
      saveProgress(bookId, {
        chapter: next,
        chapters: book.chapters.length,
        scroll: 0,
        extraId: "",
        anchor: first ? makeAnchor({ chapter: next, paragraph: 0, text: first, at: 0 }) : undefined,
      });
      window.scrollTo({ top: 0 });
    },
    [book, bookId, saveProgress],
  );

  const slotIndex = slots
    ? Math.max(
        0,
        slots.findIndex((slot) =>
          activeExtra
            ? slot.kind === "extra" && book?.extras?.[slot.index]?.id === activeExtra.id
            : slot.kind === "chapter" && slot.index === safeIndex,
        ),
      )
    : safeIndex;

  const goSlot = useCallback(
    (at: number) => {
      if (!book || !slots) return;
      const slot = slots[at];
      if (!slot) return;
      restore.current = null;
      restoreAt.current = null;
      setPicked(null);
      setHelp(null);
      setScrolled(0);
      if (slot.kind === "chapter") {
        setExtraId("");
        setChapterIndex(slot.index);
        const first = book.chapters[slot.index]?.paragraphs[0] ?? "";
        saveProgress(bookId, {
          chapter: slot.index,
          chapters: book.chapters.length,
          scroll: 0,
          extraId: "",
          anchor: first ? makeAnchor({ chapter: slot.index, paragraph: 0, text: first, at: 0 }) : undefined,
        });
      } else {
        const extra = book.extras?.[slot.index];
        if (!extra) return;
        setExtraId(extra.id);
        const first = extra.paragraphs[0] ?? "";
        saveProgress(bookId, {
          chapter: safeIndex,
          chapters: book.chapters.length,
          scroll: 0,
          extraId: extra.id,
          // The anchor is a paragraph of this extra. Restore searches only that extra.
          anchor: first ? makeAnchor({ chapter: 0, paragraph: 0, text: first, at: 0 }) : undefined,
        });
      }
      window.scrollTo({ top: 0 });
    },
    [book, slots, bookId, saveProgress, safeIndex],
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
  const located = picked
    ? locateSentence(picked.paragraph, picked.surface, picked.before.length)
    : null;
  const pickedSentence = located?.text ?? "";
  const phraseOffset = located?.offset ?? -1;
  const phraseAt = picked ? `${picked.index}|${picked.surface}|${pickedSentence}|${phraseOffset}` : "";
  useEffect(() => {
    // Phrase notes are anchored to this book's chapters. An extra (often the next
    // book's opening) must not pick one up from the same words.
    if (activeExtra) {
      setPhraseHit(null);
      setPhrasePending(false);
      return;
    }
    if (!picked || !pickedSentence) {
      setPhrasePending(false);
      return;
    }
    let alive = true;
    const at = phraseAt;
    const surface = picked.surface;
    const offset = phraseOffset;
    setPhrasePending(true);
    void findPhrase(bookId, pickedSentence, surface, offset >= 0 ? offset : undefined).then((hit) => {
      if (!alive) return;
      setPhraseHit(hit ? { at, hit } : null);
      setPhrasePending(false);
      const spoken = (resolveKey(surface) || surface).trim().toLowerCase();
      if (hit && hit.key.trim().toLowerCase() !== spoken) speakEnglish(hit.key);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, phraseAt, activeExtra]);

  function paragraphElement(index: number): Element | null {
    const root = articleRef.current;
    return root ? (paragraphBlocks(root)[index] ?? null) : null;
  }

  function openHelp(index: number) {
    const el = paragraphElement(index);
    if (!el || !book) return;
    const root = articleRef.current;
    const texts = root ? paragraphBlocks(root).map((block) => flowText(block)) : [];
    setAnchor(el instanceof HTMLElement ? el : null);
    setPicked(null);
    setHelp({ index });
    setHelpState({ status: "loading" });
    helpToken.current += 1;
    const token = helpToken.current;
    void loadParagraphView({
      bookId,
      chapter: activeExtra ? activeExtra.id : safeIndex,
      paragraph: index,
      texts,
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
    const block = button.closest("p, li, blockquote, h1, h2, h3, h4, div[data-para]");
    const paragraph = block ? flowText(block) : surface;
    const before = block ? flowTextBefore(block, button) : "";
    const blocks = articleRef.current ? paragraphBlocks(articleRef.current) : [];
    const blockAt = blocks.findIndex((item) => item.contains(button));
    closeHelp();
    setPhraseHit(null);
    setPhrasePending(!activeExtra);
    setAnchor(button instanceof HTMLElement ? button : null);
    setPicked({
      surface,
      paragraph,
      index: button.getAttribute("data-i") ?? "",
      nth: Number(button.getAttribute("data-n")) || 0,
      before,
      block: Math.max(0, blockAt),
    });
    speakEnglish(resolveKey(surface) || surface);
  }

  /** A hard word from the paragraph panel: find it in the paragraph and open its normal card. */
  function pickFromParagraph(word: string) {
    if (!help) return;
    const el = paragraphElement(help.index);
    if (!el) return;
    const tokens = (word.match(new RegExp(TAP_WORD_PATTERN, "gu")) ?? []).map((t) => plainSurface(t));
    if (tokens.length === 0) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button[data-word]")];
    const same = (i: number) =>
      tokens.every((t, k) => plainSurface(buttons[i + k]?.dataset.word ?? "") === t);
    let at = -1;
    for (let i = 0; i < buttons.length; i += 1) {
      if (same(i)) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      at = buttons.findIndex((b) => tokens.includes(plainSurface(b.dataset.word ?? "")));
      if (at < 0) return;
      pickButton(buttons[at] as Element);
      return;
    }
    const group = buttons.slice(at, at + tokens.length);
    const best =
      group.find((b) => b.classList.contains("book-hard") || b.classList.contains("book-tricky")) ??
      group.find((b) => b.classList.contains("book-phrase")) ??
      [...group].sort((a, b) => (b.dataset.word?.length ?? 0) - (a.dataset.word?.length ?? 0))[0];
    if (best) pickButton(best);
  }

  if (missing) {
    return (
      <MissingBook
        book={
          shelfBook ?? {
            id: bookId,
            title: "",
            author: "",
          }
        }
        onBack={onBack}
        onAddEpub={onAddEpub}
        onDiscover={onDiscover}
      />
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
    const sentence = sentenceAround(paragraph, surface, tap.before.length);
    const fullSentence = wholeSentence(paragraph, surface, tap.before.length);
    const tapAt = {
      chapter: viewChapter,
      surface,
      occurrence: tap.nth,
      paragraph,
      before: tap.before,
    };
    let gloss: Gloss | undefined = book?.glossary[key];
    // A senseOnly entry says nothing about the places its senses do not name.
    if (gloss && !entryAppliesAt(key, gloss, tapAt)) gloss = undefined;
    if (gloss) {
      // Which meaning fits this place in the book? (word list format version 2)
      const choice = pickSense(key, gloss, tapAt);
      return {
        surface,
        key,
        pos: contextPos(surface, choice.pos),
        meaning: choice.meaning,
        whyHard: choice.whyHard,
        here: choice.here,
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
  const shownPhrase = phraseHit && phraseHit.at === phraseAt ? phraseHit.hit : null;
  const saveAs = savedFromCard(
    {
      surface: picked?.surface ?? "",
      key: pickedKey,
      pos: card?.pos ?? "",
      meaning: card?.meaning ?? "",
    },
    shownPhrase
      ? {
          key: shownPhrase.key,
          matched: shownPhrase.matched,
          pos: shownPhrase.entry.pos,
          meaning: shownPhrase.entry.meaning,
        }
      : null,
  );
  const alreadySaved = saveAs.lemma
    ? savedKeys.has(saveAs.lemma.toLowerCase()) &&
      (shownPhrase != null || !(marked.sparse.has(pickedKey) && card?.status !== "ready"))
    : false;
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
        {/* Full width on purpose: tying this bar to --reader-width slides the text-width control while it is dragged. */}
        <div className="mx-auto flex h-14 w-full items-center gap-1 px-2 sm:px-4">
          <button
            type="button"
            className={btn.icon}
            onClick={onBack}
            aria-label={t("reader.backShelf")}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <Contents
            chapters={book.chapters}
            current={safeIndex}
            onPick={goChapter}
            rows={
              slots
                ? slots.map((slot) => {
                    if (slot.kind === "chapter") {
                      return {
                        key: `c${slot.index}`,
                        mark: String(slot.index + 1),
                        title: book.chapters[slot.index]?.title ?? "",
                        active: !activeExtra && slot.index === safeIndex,
                      };
                    }
                    const extra = book.extras?.[slot.index];
                    return {
                      key: `x${extra?.id ?? slot.index}`,
                      mark: t("reader.extra"),
                      title: extra?.title || t("reader.extra"),
                      active: Boolean(extra && extra.id === activeExtra?.id),
                    };
                  })
                : undefined
            }
            onPickRow={(key) => {
              if (!slots) return;
              const at = slots.findIndex((slot) =>
                slot.kind === "chapter"
                  ? key === `c${slot.index}`
                  : key === `x${book.extras?.[slot.index]?.id ?? slot.index}`,
              );
              if (at >= 0) goSlot(at);
            }}
          />
          <div className="min-w-0 flex-1 px-2 text-center leading-tight">
            <p className="truncate font-display text-[0.95rem] font-semibold">{book.title}</p>
            <p className="truncate text-xs text-muted" lang="en">
              {activeExtra ? activeExtra.title || t("reader.extra") : chapter.title}
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

      <main className={cn("px-5 pt-8 pb-12 sm:px-8 sm:pt-12", READER_GUTTER)}>
        {linkedHtml ? (
          <article
            ref={articleRef}
            className="book-body"
            lang="en"
            data-segmentation={book.segmentation === 2 ? "2" : undefined}
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
        ) : activeExtra ? (
          <article ref={articleRef} className="book-body" lang="en">
            {activeExtra.title ? <h2>{activeExtra.title}</h2> : null}
            {activeExtra.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
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
              disabled={slots ? slotIndex <= 0 : safeIndex <= 0}
              onClick={() => (slots ? goSlot(slotIndex - 1) : goChapter(safeIndex - 1))}
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("reader.prev")}
            </button>
            <button
              type="button"
              className={cn(btn.primary, "flex-1")}
              disabled={slots ? slotIndex >= slots.length - 1 : safeIndex >= book.chapters.length - 1}
              onClick={() => (slots ? goSlot(slotIndex + 1) : goChapter(safeIndex + 1))}
            >
              {t("reader.next")}
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-center text-xs tabular-nums text-muted">
            {activeExtra
              ? t("reader.extraOf", { pct: Math.round(fraction * 100) })
              : t("reader.chapterOf", {
                  n: safeIndex + 1,
                  total: book.chapters.length,
                  pct: Math.round(fraction * 100),
                })}
          </p>
        </nav>
      </main>

      {!card && !help ? <SidePlaceholder /> : null}

      {linkedHtml ? (
        <ParagraphBulbs
          articleRef={articleRef}
          version={linkedHtml}
          bookId={bookId}
          chapter={activeExtra ? activeExtra.id : safeIndex}
          notesVersion={book?.glossary}
          activeIndex={help ? help.index : null}
          onOpen={openHelp}
        />
      ) : null}

      {help ? (
        <ParagraphPanel
          key={help.index}
          state={helpState}
          anchor={anchor}
          onClose={closeHelp}
          onWord={pickFromParagraph}
        />
      ) : null}

      {card ? (
        <WordCard
          state={card}
          stat={bookStats[pickedKey]}
          saved={!phrasePending && alreadySaved}
          phrase={shownPhrase}
          canSave={!phrasePending && (card.ready || shownPhrase != null)}
          bookId={bookId}
          noList={noList}
          chapter={viewChapter}
          noteChapter={activeExtra?.fromToc ? activeExtra.id : viewChapter}
          anchor={anchor}
          onClose={() => setPicked(null)}
          onToggle={() => {
            if (!picked || !shelfBook || phrasePending) return;
            if (!shownPhrase && !card.ready) return;
            if (alreadySaved) {
              removeWordFromBook(bookKey, saveAs.lemma);
              return;
            }
            const listId = book?.bundled || listSource;
            const gloss = book?.glossary[saveAs.lemma] ?? book?.glossary[saveAs.lemma.toLowerCase()];
            const ref = shownPhrase
              ? phrasePoint(listId)
              : gloss
                ? pointFromEntry(listId, saveAs.lemma, gloss, {
                    chapter: viewChapter,
                    surface: picked.surface,
                    occurrence: picked.nth,
                    paragraph: picked.paragraph,
                    before: picked.before,
                  })
                : undefined;
            const source: WordSource = ref
              ? {
                  book: bookKey,
                  surface: saveAs.surface,
                  savedAt: Date.now(),
                  ref,
                  ...(saveAs.pos ? { pos: saveAs.pos } : {}),
                  ...(ref.chapter !== undefined ? { chapter: ref.chapter } : {}),
                }
              : {
                  book: bookKey,
                  title: shelfBook.title,
                  author: shelfBook.author,
                  chapter: safeIndex,
                  ...(chapter.title ? { chapterTitle: chapter.title } : {}),
                  surface: saveAs.surface,
                  savedAt: Date.now(),
                  ...(saveAs.pos ? { pos: saveAs.pos } : {}),
                };
            saveWord(
              {
                surface: saveAs.surface,
                lemma: saveAs.lemma,
                pos: saveAs.pos,
                meaning: "",
                whyHard: "",
                recommend: !isEasyKey(saveAs.lemma),
                sentence: "",
              },
              source,
            );
          }}
        />
      ) : null}
    </div>
  );
}
