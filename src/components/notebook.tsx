import { BookMarked, Check, ChevronDown, Layers, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { dueLabel, INTERVALS_DAYS, summarize } from "@/lib/srs";
import { isDue, isMastered, MASTERED_STAGE, type Book, type VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import {
  btn,
  chip,
  cn,
  ConfirmDialog,
  field,
  Highlighted,
  Segmented,
  selectCls,
  SpeakButton,
  StatRow,
} from "@/components/ui";

type Filter = "all" | "due" | "learning" | "mastered";
type Order = "new" | "az" | "next";

const FILTERS: Array<{ value: Filter; label: Key }> = [
  { value: "all", label: "nb.filter.all" },
  { value: "due", label: "nb.filter.due" },
  { value: "learning", label: "nb.filter.learning" },
  { value: "mastered", label: "nb.filter.mastered" },
];

const PAGE = 40;

/** Six dots = the 1/2/4/7/15/30-day ladder. Filled dots are reviews already passed. */
function Ladder({ stage }: { stage: number }) {
  const { t } = useT();
  const mastered = stage >= MASTERED_STAGE;
  return (
    <span
      className="inline-flex items-center gap-1"
      role="img"
      aria-label={
        mastered ? t("ladder.done") : t("ladder.passed", { n: stage, total: INTERVALS_DAYS.length })
      }
      title={t("ladder.title", { days: INTERVALS_DAYS.join(" / ") })}
    >
      {INTERVALS_DAYS.map((days, index) => (
        <span
          key={days}
          className={cn("size-1.5 rounded-full", index < stage ? "bg-accent" : "bg-line")}
          aria-hidden
        />
      ))}
    </span>
  );
}

function WordRow({
  word,
  bookTitle,
  onAskDelete,
}: {
  word: VocabEntry;
  bookTitle: string;
  onAskDelete: () => void;
}) {
  const { t, tn } = useT();
  const markMastered = useVocab((state) => state.markMastered);
  const relearn = useVocab((state) => state.relearn);
  const mastered = isMastered(word);
  const due = isDue(word);
  return (
    <li className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-2xl font-semibold break-words" lang="en">
            {word.lemma}
          </h3>
          {word.surface.toLowerCase() !== word.lemma.toLowerCase() ? (
            <span className="text-sm text-muted">
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
        <div className="flex items-center gap-2">
          <Ladder stage={word.stage} />
          <span
            className={cn(
              chip,
              mastered
                ? "bg-accent-soft text-accent"
                : due
                  ? "bg-warn-soft text-warn"
                  : "bg-line text-muted",
            )}
          >
            {dueLabel(word)}
          </span>
        </div>
      </div>

      {word.pos ? (
        <div>
          <span className={cn(chip, "bg-accent-soft text-accent")}>
            <span lang="en">{word.pos}</span>
          </span>
        </div>
      ) : null}

      <p className="text-[1.02rem] leading-relaxed" lang="en">
        {word.meaning}
      </p>

      {word.sentence ? (
        <p className="border-l-2 border-accent/40 pl-3 font-display text-[0.95rem] leading-relaxed text-muted">
          <Highlighted sentence={word.sentence} surface={word.surface} />
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <BookMarked className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" lang="en">
            {bookTitle}
          </span>
          {word.seen ? <span className="shrink-0">{tn("row.seen", word.seen)}</span> : null}
        </p>
        <div className="-mr-2 flex flex-wrap items-center">
          <SpeakButton text={word.lemma} className="min-h-10" />
          {mastered ? (
            <button
              type="button"
              className={cn(btn.ghost, "min-h-10 px-3 text-sm text-accent")}
              onClick={() => relearn(word.id)}
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("row.relearn")}
            </button>
          ) : (
            <button
              type="button"
              className={cn(btn.ghost, "min-h-10 px-3 text-sm text-accent")}
              onClick={() => markMastered(word.id)}
            >
              <Check className="size-4" aria-hidden />
              {t("row.mastered")}
            </button>
          )}
          <button
            type="button"
            className={cn(btn.ghost, "min-h-10 px-3 text-sm text-muted hover:text-warn")}
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

export function Notebook({
  books,
  words,
  bookId,
  onBookChange,
  onReview,
  onOpenBook,
}: {
  books: Book[];
  words: VocabEntry[];
  bookId: string | null;
  onBookChange: (bookId: string | null) => void;
  onReview: (bookId: string | null) => void;
  onOpenBook: (bookId: string) => void;
}) {
  const { t } = useT();
  const removeWord = useVocab((state) => state.removeWord);
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("new");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [deleting, setDeleting] = useState<VocabEntry | null>(null);

  const titles = useMemo(() => new Map(books.map((book) => [book.id, book.title])), [books]);
  const scoped = useMemo(
    () => (bookId ? words.filter((word) => word.bookId === bookId) : words),
    [words, bookId],
  );
  const stats = useMemo(() => summarize(scoped), [scoped]);
  const activeBook = bookId ? books.find((book) => book.id === bookId) : undefined;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = scoped.filter((word) => {
      if (filter === "due" && !isDue(word)) return false;
      if (filter === "learning" && isMastered(word)) return false;
      if (filter === "mastered" && !isMastered(word)) return false;
      if (!q) return true;
      return `${word.lemma} ${word.surface} ${word.meaning} ${word.sentence}`
        .toLowerCase()
        .includes(q);
    });
    list.sort((a, b) => {
      if (order === "az") return a.lemma.localeCompare(b.lemma);
      if (order === "next") return a.dueAt - b.dueAt || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [scoped, filter, order, query]);

  const counts: Record<Filter, number> = {
    all: stats.total,
    due: stats.due,
    learning: stats.learning,
    mastered: stats.mastered,
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("nb.title")}</h1>
          <p className="text-sm text-muted">
            {activeBook ? (
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
        <button
          type="button"
          className={btn.primary}
          disabled={stats.due === 0}
          onClick={() => onReview(bookId)}
          title={stats.due === 0 ? t("nb.noReview") : undefined}
        >
          <Layers className="size-4" aria-hidden />
          {stats.due > 0 ? t("nb.startReview", { n: stats.due }) : t("nb.allDone")}
        </button>
      </header>

      <StatRow
        items={[
          { label: t("stat.all"), value: stats.total },
          { label: t("stat.due"), value: stats.due, tone: stats.due > 0 ? "warn" : "plain" },
          { label: t("stat.learning"), value: stats.learning },
          { label: t("stat.mastered"), value: stats.mastered, tone: "good" },
        ]}
      />

      {scoped.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-3xl border border-line bg-card px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <BookMarked className="size-7" aria-hidden />
          </span>
          <h2 className="font-display text-xl font-semibold">{t("nb.emptyTitle")}</h2>
          <p className="max-w-sm text-muted">{t("nb.emptyBody")}</p>
          {activeBook?.source === "epub" ? (
            <button type="button" className={btn.primary} onClick={() => onOpenBook(activeBook.id)}>
              {t("nb.backToBook")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">{t("nb.searchAria")}</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
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
                className={cn(selectCls, "sm:max-w-56")}
                value={bookId ?? ""}
                onChange={(event) => {
                  onBookChange(event.target.value || null);
                  setShown(PAGE);
                }}
              >
                <option value="">{t("nb.allBooks")}</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="word-order">
                {t("nb.sortBy")}
              </label>
              <select
                id="word-order"
                className={selectCls}
                value={order}
                onChange={(event) => setOrder(event.target.value as Order)}
              >
                <option value="new">{t("nb.order.new")}</option>
                <option value="next">{t("nb.order.next")}</option>
                <option value="az">{t("nb.order.az")}</option>
              </select>
            </div>
            <Segmented
              label={t("nb.status")}
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setShown(PAGE);
              }}
              options={FILTERS.map((item) => ({
                value: item.value,
                label: (
                  <>
                    {t(item.label)}
                    <span className="ml-1 text-xs tabular-nums opacity-60">
                      {counts[item.value]}
                    </span>
                  </>
                ),
              }))}
            />
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-muted">{t("nb.noMatch")}</p>
          ) : (
            <>
              <ul className="grid gap-3">
                {visible.slice(0, shown).map((word) => (
                  <WordRow
                    key={word.id}
                    word={word}
                    bookTitle={titles.get(word.bookId) ?? t("nb.deletedBook")}
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
