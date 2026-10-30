import { Check, ChevronDown, ChevronRight, Flame, Layers, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { dueLabel, streakOf, summarize } from "@/lib/srs";
import { modeLabel, savedReviewMode, saveReviewMode, usableMode, type ReviewMode, type ReviewPool } from "@/lib/review-mode";
import { bookSyncKey } from "@/lib/sync-merge";
import { isDue, isMastered, type Book, type VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { focusSentence } from "@/lib/text";
import { hasSourceFrom } from "@/lib/wordbook";
import { useGlossFiles, usePresentedWord } from "@/components/presented-word";
import { presentWord } from "@/lib/gloss-ref";
import { WordSources } from "@/components/word-sources";
import { QuoteBook } from "@/components/quote-book";
import { useQuotes } from "@/lib/quote-store";
import { notebookTab, rememberNotebookTab } from "@/lib/router";
import { WordIpa } from "@/components/word-ipa";
import { MemoryLadder, ModeCards, WeekChart } from "@/components/review-parts";
import {
  btn,
  cn,
  ConfirmDialog,
  field,
  Highlighted,
  selectCls,
  StatRow,
  subTabs,
  TabInk,
} from "@/components/ui";

type Filter = "all" | "due" | "learning" | "mastered";
type Order = "new" | "az" | "next";

const FILTERS: Array<{ value: Filter; label: Key }> = [
  { value: "all", label: "nb.filter.all" },
  { value: "due", label: "nb.filter.due" },
  { value: "learning", label: "nb.filter.learning" },
  { value: "mastered", label: "nb.filter.mastered" },
];

const PAGE = 30;

/** "Review today" in warn, "In 4 days" quiet, "Mastered" on a highlighter (design system WordRow). */
function DueText({ word }: { word: VocabEntry }) {
  const mastered = isMastered(word);
  const due = !mastered && isDue(word);
  return (
    <span
      className={cn(
        "text-[13px] leading-snug whitespace-nowrap",
        mastered ? "rounded-sm bg-mark px-1 text-ink" : due ? "font-bold text-warn" : "text-faint",
      )}
      data-due={mastered ? "done" : due ? "warn" : "plain"}
    >
      {dueLabel(word)}
    </span>
  );
}

/**
 * One saved word as a dictionary line (design system WordRow), rows split by rules, no card: the
 * headword in Literata with the form met in the book, the UK / US rows with their own speakers,
 * the meaning, the sentence from the book and where it was met. On the right the memory ladder,
 * when it is due, and Mastered / Relearn and Delete (shown on hover on a wide screen, always on
 * touch). A mastered word has a highlighter under its headword.
 */
function WordRow({
  word,
  books,
  onAskDelete,
}: {
  word: VocabEntry;
  books: Book[];
  onAskDelete: () => void;
}) {
  const { t, tn } = useT();
  const markMastered = useVocab((state) => state.markMastered);
  const relearn = useVocab((state) => state.relearn);
  const mastered = isMastered(word);
  const shown = usePresentedWord(word, books) ?? word;
  const bookCount = new Set(word.sources.map((source) => source.book)).size;
  const note = [bookCount > 1 ? tn("nb.inBooks", bookCount) : "", word.seen ? tn("row.seenPlain", word.seen) : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      className="nb-row grid grid-cols-1 gap-x-8 gap-y-3 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:py-5"
      data-word-row
      data-mastered={mastered || undefined}
    >
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="m-0 font-display text-2xl leading-tight font-semibold tracking-[-0.01em] wrap-any" lang="en">
            <span className={mastered ? "head-mark" : undefined}>{word.lemma}</span>
          </h3>
          {word.surface.toLowerCase() !== word.lemma.toLowerCase() ? (
            <span className="text-[13px] text-faint">
              {t("common.inBook", { word: "\u0001" })
                .split("\u0001")
                .flatMap((piece, i) =>
                  i === 0
                    ? [piece]
                    : [
                        <span key="m" lang="en">
                          {word.surface}
                        </span>,
                        piece,
                      ],
                )}
            </span>
          ) : null}
        </div>
        <WordIpa word={word.lemma} surface={word.surface} phrase={/\s/.test(word.lemma)} />
        {shown.sources.length > 0 ? (
          <WordSources word={shown} books={books} note={note || undefined} />
        ) : (
          <>
            {shown.meaning ? (
              <p className="m-0 text-base leading-normal wrap-any" lang="en" data-source-meaning>
                {shown.pos ? <span className="mr-1.5 text-[13px] text-faint">{shown.pos}</span> : null}
                {shown.meaning}
              </p>
            ) : null}
            {shown.sentence ? (
              <p className="source-sentence m-0 font-display text-[15px] leading-relaxed text-muted italic wrap-any" data-source-sentence>
                <Highlighted sentence={focusSentence(shown.sentence, shown.surface || shown.lemma)} surface={shown.surface || shown.lemma} />
              </p>
            ) : null}
            {note ? <p className="m-0 text-[13px] text-faint">{note}</p> : null}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 sm:grid sm:content-between sm:justify-items-end">
        <div className="flex items-center gap-2.5">
          <MemoryLadder stage={word.stage} />
          <DueText word={word} />
        </div>
        <div className="nb-actions -mr-2 flex items-center gap-1">
          {mastered ? (
            <button type="button" className={cn(btn.bare, "min-h-10 px-2.5 text-sm text-accent")} onClick={() => relearn(word.id)}>
              <RotateCcw className="size-4" aria-hidden />
              {t("row.relearn")}
            </button>
          ) : (
            <button type="button" className={cn(btn.bare, "min-h-10 px-2.5 text-sm text-accent")} onClick={() => markMastered(word.id)}>
              <Check className="size-4" aria-hidden />
              {t("row.mastered")}
            </button>
          )}
          <button
            type="button"
            className={cn(btn.bare, "min-h-10 px-2.5 text-faint hover:text-warn")}
            onClick={onAskDelete}
            aria-label={t("row.deleteAria", { word: word.lemma })}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * The review launcher (design system ReviewLauncher), right under the notebook's header, so every
 * review passes through it: how many words are due and the streak, the three ways to review (the
 * last one remembered), the start button with the chosen way under it, the next 7 days and a link
 * to the review data page. With nothing due the button practises the words still being learnt.
 */
function ReviewLauncher({
  stats,
  words,
  streak,
  onStart,
  onData,
}: {
  stats: ReturnType<typeof summarize>;
  words: number;
  streak: number;
  onStart: (pool: ReviewPool, mode: ReviewMode) => void;
  onData: () => void;
}) {
  const { t, tn } = useT();
  const [picked, setPicked] = useState<ReviewMode>(() => savedReviewMode());
  const mode = usableMode(picked, words);
  const pool: ReviewPool = stats.due > 0 ? "due" : stats.learning > 0 ? "learning" : "all";
  const count = pool === "due" ? stats.due : pool === "learning" ? stats.learning : stats.total;
  const label =
    pool === "due" ? t("nb.startReview", { n: count }) : pool === "learning" ? t("rv.practiceLearning", { n: count }) : t("rv.practiceAll", { n: count });
  return (
    <section
      className="launcher grid grid-cols-1 items-center gap-3.5 rounded-2xl bg-sheet p-4 shadow-hero lg:grid-cols-[9rem_minmax(0,1fr)_14rem] lg:gap-x-7 lg:gap-y-5 lg:px-6 lg:py-5"
      aria-label={t("rv.title")}
      data-review-launcher
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 lg:grid lg:gap-0.5">
        {stats.due > 0 ? (
          <>
            <b className="font-display text-[40px] leading-none font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums] lg:text-5xl" data-launch-due>
              {stats.due}
            </b>
            <span className="text-sm text-muted">{tn("rv.dueText", stats.due)}</span>
          </>
        ) : (
          <b className="text-xl leading-snug font-bold tracking-[-0.02em]" data-launch-done>
            {t("nb.allDone")}
          </b>
        )}
        <small className="inline-flex basis-full items-center gap-1.5 text-[13px] text-muted lg:mt-1.5">
          <Flame className="size-4 text-warn" aria-hidden />
          {streak > 0 ? tn("nb.streak", streak) : t("rv.streakStart")}
        </small>
      </div>

      <ModeCards
        compact
        value={mode}
        words={words}
        onChange={(next) => {
          setPicked(next);
          saveReviewMode(next);
        }}
      />

      <div className="grid gap-1.5 text-center">
        <button type="button" className={cn(btn.primary, "min-h-12 w-full")} onClick={() => onStart(pool, mode)} data-review-start>
          <Layers className="size-4" aria-hidden />
          {label}
        </button>
        <span className="text-[13px] text-faint">{t("nb.withMode", { mode: t(modeLabel(mode)) })}</span>
      </div>

      <div className="grid grid-cols-1 items-end gap-0.5 border-t border-line pt-3 lg:col-span-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-5 lg:pt-3.5">
        <div className="sm:max-w-[26rem]">
          <WeekChart upcoming={stats.upcoming} mini />
        </div>
        <button type="button" className={cn(btn.bare, "-ml-2 min-h-10 justify-self-start px-2 text-sm text-accent lg:ml-0")} onClick={onData} data-review-data>
          {t("nb.reviewData")}
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

export function Notebook({
  books,
  words,
  bookId,
  onBookChange,
  onReview,
  onReviewData,
  onOpenBook,
}: {
  books: Book[];
  words: VocabEntry[];
  bookId: string | null;
  onBookChange: (bookId: string | null) => void;
  onReview: (bookId: string | null, pool: ReviewPool, mode: ReviewMode) => void;
  onReviewData: (bookId: string | null) => void;
  onOpenBook: (bookId: string) => void;
}) {
  const { t } = useT();
  const removeWord = useVocab((state) => state.removeWord);
  const log = useVocab((state) => state.log);
  const glossFiles = useGlossFiles();
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("new");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [deleting, setDeleting] = useState<VocabEntry | null>(null);
  // Words or quotes (design system QuoteBook): one page, two halves. The history entry keeps the half.
  const [tab, setTab] = useState<"words" | "quotes">(() => notebookTab());
  const quoteCount = useQuotes((state) => state.quotes.length);
  useEffect(() => {
    const back = () => setTab(notebookTab());
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const pickTab = (next: "words" | "quotes") => {
    setTab(next);
    rememberNotebookTab(next);
  };

  const activeBook = bookId ? books.find((book) => book.id === bookId) : undefined;
  const activeKey = activeBook ? bookSyncKey(activeBook) : "";
  // One list for every book. A book filter only narrows it; the schedule is the same either way.
  const scoped = useMemo(() => {
    if (!bookId) return words;
    if (!activeKey) return [];
    return words
      .filter((word) => hasSourceFrom(word, activeKey))
      .map((word) => ({
        ...word,
        sources: [
          ...word.sources.filter((source) => source.book === activeKey),
          ...word.sources.filter((source) => source.book !== activeKey),
        ],
      }));
  }, [words, bookId, activeKey]);
  const perBook = useMemo(
    () => new Map(books.map((book) => [book.id, words.filter((word) => hasSourceFrom(word, bookSyncKey(book))).length])),
    [books, words],
  );
  const stats = useMemo(() => summarize(scoped), [scoped]);
  const streak = useMemo(() => streakOf(log), [log]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = scoped.filter((word) => {
      if (filter === "due" && !isDue(word)) return false;
      if (filter === "learning" && isMastered(word)) return false;
      if (filter === "mastered" && !isMastered(word)) return false;
      if (!q) return true;
      const shown = presentWord(word, glossFiles);
      return `${shown.lemma} ${shown.surface} ${shown.meaning} ${shown.sentence} ${shown.sources
        .map((source) => `${source.title ?? ""} ${source.sentence ?? ""} ${source.meaning ?? ""} ${source.chapterTitle ?? ""}`)
        .join(" ")}`
        .toLowerCase()
        .includes(q);
    });
    list.sort((a, b) => {
      if (order === "az") return a.lemma.localeCompare(b.lemma);
      if (order === "next") return a.dueAt - b.dueAt || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [scoped, filter, order, query, glossFiles]);

  const counts: Record<Filter, number> = {
    all: stats.total,
    due: stats.due,
    learning: stats.learning,
    mastered: stats.mastered,
  };

  return (
    <div className="mx-auto grid w-full max-w-[52rem] grid-cols-[minmax(0,1fr)] gap-5 px-4 pt-4 pb-8 sm:gap-6 sm:px-6 sm:pt-8 sm:pb-16" data-notebook>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 text-2xl leading-tight font-bold tracking-[-0.02em] sm:text-[28px]">{t("nb.title")}</h1>
          <p className="m-0 text-[13px] text-muted sm:text-sm" data-notebook-intro>
            {tab === "quotes" ? (
              t("qb.intro")
            ) : activeBook ? (
              <>
                {t("nb.fromBook", { title: "\u0001" })
                  .split("\u0001")
                  .flatMap((piece, i) =>
                    i === 0
                      ? [piece]
                      : [
                          <span key="b" lang="en">
                            {activeBook.title}
                          </span>,
                          piece,
                        ],
                  )}
              </>
            ) : (
              t("nb.allWords")
            )}
          </p>
        </div>
        <div className="inline-flex rounded-full bg-sheet p-1" role="group" aria-label={t("nb.title")} data-notebook-kind>
          {(["words", "quotes"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={tab === kind}
              onClick={() => pickTab(kind)}
              data-kind={kind}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors",
                tab === kind ? "bg-paper text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-muted hover:text-ink",
              )}
            >
              {kind === "words" ? t("nb.kindWords") : t("nb.kindQuotes")}
              <small className="text-xs font-normal text-faint [font-variant-numeric:tabular-nums]">
                {(kind === "words" ? words.length : quoteCount).toLocaleString()}
              </small>
            </button>
          ))}
        </div>
      </header>

      {tab === "quotes" ? (
        <QuoteBook books={books} bookKey={activeKey} onOpenBook={onOpenBook} />
      ) : scoped.length === 0 ? (
        <div className="grid justify-items-start gap-3 border-t border-line pt-6" data-notebook-empty>
          <h2 className="m-0 text-lg font-bold tracking-[-0.02em]">{t("nb.emptyTitle")}</h2>
          <p className="m-0 max-w-md text-muted">{t("nb.emptyBody")}</p>
          {activeBook?.source === "epub" ? (
            <button type="button" className={btn.primary} onClick={() => onOpenBook(activeBook.id)}>
              {t("nb.backToBook")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ReviewLauncher
            stats={stats}
            words={scoped.length}
            streak={streak}
            onStart={(pool, mode) => onReview(bookId, pool, mode)}
            onData={() => onReviewData(bookId)}
          />

          <StatRow
            items={[
              { label: t("stat.all"), value: stats.total },
              { label: t("stat.due"), value: stats.due, tone: stats.due > 0 ? "warn" : "plain" },
              { label: t("stat.learning"), value: stats.learning },
              { label: t("stat.mastered"), value: stats.mastered, tone: "mark" },
            ]}
          />

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <label className="relative col-span-2 sm:col-span-1">
                <span className="sr-only">{t("nb.searchAria")}</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <input
                  className={cn(field, "pl-9")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setShown(PAGE);
                  }}
                  placeholder={t("nb.searchPlaceholder")}
                  type="search"
                />
              </label>
              <label className="sr-only" htmlFor="word-book">
                {t("nb.filterBook")}
              </label>
              <select
                id="word-book"
                className={cn(selectCls, "w-full min-w-0 sm:w-auto sm:max-w-56 sm:min-w-32")}
                value={bookId ?? ""}
                onChange={(event) => {
                  onBookChange(event.target.value || null);
                  setShown(PAGE);
                }}
              >
                <option value="">{t("nb.allBooks")}</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title} ({perBook.get(book.id) ?? 0})
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="word-order">
                {t("nb.sortBy")}
              </label>
              <select
                id="word-order"
                className={cn(selectCls, "w-full min-w-0 sm:w-auto sm:min-w-32")}
                value={order}
                onChange={(event) => setOrder(event.target.value as Order)}
              >
                <option value="new">{t("nb.order.new")}</option>
                <option value="next">{t("nb.order.next")}</option>
                <option value="az">{t("nb.order.az")}</option>
              </select>
            </div>
            <div
              role="tablist"
              aria-label={t("nb.status")}
              className="no-scrollbar relative flex gap-[18px] overflow-x-auto overflow-y-hidden border-b border-line whitespace-nowrap sm:gap-6"
              data-notebook-status
            >
              <TabInk selected={filter} />
              {FILTERS.map((item) => {
                const on = filter === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    data-status-tab={item.value}
                    className={cn(subTabs.tab, on ? subTabs.on : subTabs.off)}
                    onClick={() => {
                      setFilter(item.value);
                      setShown(PAGE);
                    }}
                  >
                    {t(item.label)}
                    <small className="ml-1 text-xs font-normal text-faint [font-variant-numeric:tabular-nums]">{counts[item.value]}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-muted">{t("nb.noMatch")}</p>
          ) : (
            <>
              <ul className="m-0 -mt-2 list-none border-t border-line p-0" data-word-list>
                {visible.slice(0, shown).map((word) => (
                  <WordRow
                    key={word.id}
                    word={word}
                    books={books}
                    onAskDelete={() => setDeleting(word)}
                  />
                ))}
              </ul>
              {visible.length > shown ? (
                <button
                  type="button"
                  className={cn(btn.quiet, "justify-self-center")}
                  onClick={() => setShown((n) => n + PAGE)}
                >
                  <ChevronDown className="size-4" aria-hidden />
                  {t("nb.showMore", { n: visible.length - shown })}
                </button>
              ) : null}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t("nb.delTitle", { word: deleting.lemma }) : t("nb.delTitleGeneric")}
        description={t("nb.delBody")}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deleting) removeWord(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
