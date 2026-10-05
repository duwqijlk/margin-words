import { ArrowLeft, Check, PartyPopper, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  daysBetween,
  dayKey,
  INTERVALS_DAYS,
  previewCorrect,
  streakOf,
  summarize,
  type SrsStats,
} from "@/lib/srs";
import { tr, trn, useT, type Key } from "@/lib/i18n";
import { reviewDueIntent } from "@/lib/router";
import { bookSyncKey } from "@/lib/sync-merge";
import { isDue, type Book, type VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { hasSourceFrom } from "@/lib/wordbook";
import { WordSources } from "@/components/word-sources";
import {
  btn,
  chip,
  cn,
  field,
  Highlighted,
  ProgressBar,
  Segmented,
  SpeakButton,
  speakEnglish,
  StatRow,
} from "@/components/ui";

type Mode = "cards" | "cloze" | "spell";
type Pool = "due" | "learning" | "all";

const MODES: Array<{ value: Mode; label: Key; hint: Key }> = [
  { value: "cards", label: "rv.mode.cards", hint: "rv.mode.cardsHint" },
  { value: "cloze", label: "rv.mode.cloze", hint: "rv.mode.clozeHint" },
  { value: "spell", label: "rv.mode.spell", hint: "rv.mode.spellHint" },
];

function shuffle<T>(list: T[]): T[] {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = next[i] as T;
    next[i] = next[j] as T;
    next[j] = a;
  }
  return next;
}

function blankOut(sentence: string, surface: string, lemma: string): string {
  let next = sentence;
  for (const word of [surface, lemma]) {
    if (!word) continue;
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\b${safe}\\b`, "i"), "______");
  }
  return next.includes("______") ? next : `______  ${sentence}`;
}

function spellingOk(typed: string, lemma: string, surface: string): boolean {
  const norm = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z'-]/g, "");
  const got = norm(typed);
  return got.length > 1 && (got === norm(lemma) || got === norm(surface));
}

function nextDueText(words: VocabEntry[], now = Date.now()): string {
  const future = words
    .filter((word) => !isDue(word, now) && word.stage < 7)
    .map((word) => word.dueAt);
  if (future.length === 0) return "";
  const gap = daysBetween(now, Math.min(...future));
  return gap <= 1 ? tr("rv.nextTomorrow") : tr("rv.nextDays", { n: gap });
}

/* --------------------------------------------------------------- overview */

function UpcomingChart({ stats }: { stats: SrsStats }) {
  const { t } = useT();
  const max = Math.max(1, ...stats.upcoming);
  const now = Date.now();
  const labels = stats.upcoming.map((_, index) =>
    index === 0
      ? t("rv.today")
      : index === 1
        ? t("rv.tomorrow")
        : `${new Date(now + index * 86_400_000).getMonth() + 1}/${new Date(now + index * 86_400_000).getDate()}`,
  );
  return (
    <div className="grid gap-2" aria-label={t("rv.upcomingAria")}>
      <div className="flex h-24 items-end gap-2">
        {stats.upcoming.map((count, index) => (
          <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs tabular-nums text-muted">{count > 0 ? count : ""}</span>
            <div
              className={cn("w-full rounded-t-md", index === 0 ? "bg-warn" : "bg-accent/70")}
              style={{
                height: `${count === 0 ? 2 : Math.max(8, (count / max) * 72)}px`,
                opacity: count === 0 ? 0.25 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {labels.map((label, index) => (
          <span key={index} className="flex-1 text-center text-[0.7rem] text-muted">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StageBars({ stats }: { stats: SrsStats }) {
  const { t, tn } = useT();
  const rows: Array<{ label: string; count: number }> = [
    { label: t("rv.stageNew"), count: stats.byStage[0] ?? 0 },
    ...INTERVALS_DAYS.map((days, index) => ({
      label: tn("count.day", days),
      count: stats.byStage[index + 1] ?? 0,
    })),
    { label: t("rv.stageMastered"), count: stats.byStage[7] ?? 0 },
  ];
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="grid gap-1.5" aria-label={t("rv.stagesAria")}>
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3 text-sm">
          <span className="w-14 shrink-0 text-muted sm:w-20">{row.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Overview({
  title,
  scoped,
  mode,
  onMode,
  onStart,
  onBack,
}: {
  title: string;
  scoped: VocabEntry[];
  mode: Mode;
  onMode: (mode: Mode) => void;
  onStart: (pool: Pool) => void;
  onBack: () => void;
}) {
  const { t, tn } = useT();
  const log = useVocab((state) => state.log);
  const stats = useMemo(() => summarize(scoped), [scoped]);
  const today = log[dayKey(Date.now())];
  const streak = streakOf(log);
  const choiceOk = scoped.length >= 4;
  const learning = scoped.filter((word) => word.stage < 7).length;
  const needsChoice = mode === "cloze";
  const accuracy =
    today && today.reviewed > 0 ? Math.round((today.correct / today.reviewed) * 100) : null;
  const hint = nextDueText(scoped);

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <button type="button" className={cn(btn.ghost, "-ml-3 self-start")} onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        {t("nav.notebook")}
      </button>
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("rv.title")}</h1>
        <p className="text-sm text-muted" lang="en">
          {title}
        </p>
      </header>

      <section
        className={cn(
          "grid gap-4 rounded-2xl border p-5 sm:p-6",
          stats.due > 0 ? "border-accent/30 bg-accent-soft" : "border-line bg-card",
        )}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-display text-5xl leading-none font-semibold tabular-nums">
            {stats.due}
          </span>
          <span className="text-muted">{tn("rv.dueText", stats.due)}</span>
        </div>
        {stats.due === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <PartyPopper className="size-4" aria-hidden />
            {hint ? t("rv.finishedNext", { hint }) : t("rv.finished")}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("rv.ladderHelp")}</p>
        )}
        <div className="grid gap-3">
          <Segmented
            label={t("rv.type")}
            value={mode}
            onChange={onMode}
            options={MODES.map((item) => ({ value: item.value, label: t(item.label) }))}
          />
          <p className="text-sm text-muted">
            {t(MODES.find((item) => item.value === mode)?.hint ?? "rv.mode.cardsHint")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className={cn(btn.primary, "sm:col-span-2")}
            disabled={stats.due === 0 || (needsChoice && !choiceOk)}
            onClick={() => onStart("due")}
          >
            {t("rv.startToday", { n: stats.due })}
          </button>
          <button
            type="button"
            className={btn.quiet}
            disabled={learning === 0 || (needsChoice && !choiceOk)}
            onClick={() => onStart("learning")}
          >
            {t("rv.practiceLearning", { n: learning })}
          </button>
          <button
            type="button"
            className={btn.quiet}
            disabled={scoped.length === 0 || (needsChoice && !choiceOk)}
            onClick={() => onStart("all")}
          >
            {t("rv.practiceAll", { n: scoped.length })}
          </button>
        </div>
        {needsChoice && !choiceOk ? <p className="text-sm text-warn">{t("rv.needs4")}</p> : null}
      </section>

      <StatRow
        items={[
          {
            label: t("rv.reviewedToday"),
            value: today?.reviewed ?? 0,
            hint: accuracy === null ? undefined : t("rv.correct", { pct: accuracy }),
          },
          {
            label: t("rv.streak"),
            value: streak,
            tone: streak > 0 ? "good" : "plain",
            hint: streak > 0 ? trn("rv.streakDay", streak) : t("rv.streakStart"),
          },
          { label: t("stat.learning"), value: stats.learning },
          { label: t("stat.mastered"), value: stats.mastered, tone: "good" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="grid gap-3 rounded-2xl border border-line bg-card p-5">
          <h2 className="text-sm font-semibold">{t("rv.next7")}</h2>
          <UpcomingChart stats={stats} />
        </section>
        <section className="grid gap-3 rounded-2xl border border-line bg-card p-5">
          <h2 className="text-sm font-semibold">{t("rv.memory")}</h2>
          <StageBars stats={stats} />
        </section>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- session */

type Answer = { id: string; correct: boolean };

function Summary({
  answers,
  onAgain,
  onBack,
  onRestart,
}: {
  answers: Answer[];
  onAgain: (() => void) | null;
  onBack: () => void;
  onRestart: () => void;
}) {
  const { t, tn } = useT();
  const right = answers.filter((a) => a.correct).length;
  const pct = answers.length ? Math.round((right / answers.length) * 100) : 0;
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-5 px-4 py-14 text-center sm:py-20">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <PartyPopper className="size-8" aria-hidden />
      </span>
      <div className="grid gap-1">
        <h1 className="font-display text-3xl font-semibold">{t("rv.roundDone")}</h1>
        <p className="text-muted">
          {t("rv.summary", {
            words: tn("count.word", answers.length),
            right: "\u0001",
            wrong: "\u0002",
            pct,
          })
            // eslint-disable-next-line no-control-regex -- \u0001 and \u0002 are private markers made just above
            .split(/[\u0001\u0002]/)
            .flatMap((piece, i) =>
              i === 0
                ? [piece]
                : [
                    i === 1 ? (
                      <span key="r" className="font-semibold text-accent tabular-nums">
                        {right}
                      </span>
                    ) : (
                      <span key="w" className="font-semibold text-warn tabular-nums">
                        {answers.length - right}
                      </span>
                    ),
                    piece,
                  ],
            )}
        </p>
      </div>
      <div className="grid w-full gap-2">
        {onAgain ? (
          <button type="button" className={btn.primary} onClick={onAgain}>
            <RotateCcw className="size-4" aria-hidden />
            {t("rv.again")}
          </button>
        ) : null}
        <button type="button" className={onAgain ? btn.quiet : btn.primary} onClick={onBack}>
          {t("rv.backNotebook")}
        </button>
        <button type="button" className={btn.ghost} onClick={onRestart}>
          {t("rv.overview")}
        </button>
      </div>
    </div>
  );
}

function Session({
  mode,
  initial,
  pool,
  books,
  onExit,
  onOverview,
}: {
  mode: Mode;
  books: Book[];
  initial: string[];
  /** words to draw cloze distractors from */
  pool: VocabEntry[];
  onExit: () => void;
  onOverview: () => void;
}) {
  const { t, tn } = useT();
  const review = useVocab((state) => state.review);
  const allWords = useVocab((state) => state.words);
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [spell, setSpell] = useState<null | "yes" | "no">(null);
  const spellRef = useRef<HTMLInputElement | null>(null);

  const byId = useMemo(() => new Map(allWords.map((word) => [word.id, word])), [allWords]);
  const currentId = queue[index];
  const current = currentId ? byId.get(currentId) : undefined;

  // Choices are drawn once per card, so they do not reshuffle when the card re-renders.
  const options = useMemo(() => {
    if (mode !== "cloze" || !current) return [];
    const others = shuffle(pool.filter((word) => word.lemma !== current.lemma)).slice(0, 3);
    return shuffle([
      { id: current.id, label: current.lemma, correct: true },
      ...others.map((word) => ({ id: word.id, label: word.lemma, correct: false })),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentId]);

  const answered =
    mode === "cards" ? revealed : mode === "cloze" ? picked !== null : spell !== null;

  const record = useCallback(
    (correct: boolean) => {
      if (!current) return;
      review(current.id, correct, isDue(current));
      setAnswers((list) => [...list, { id: current.id, correct }]);
    },
    [current, review],
  );

  const next = useCallback(() => {
    const following = queue[index + 1];
    const word = following ? byId.get(following) : undefined;
    if (mode === "cards" && word) speakEnglish(word.lemma);
    setIndex((value) => value + 1);
    setRevealed(false);
    setPicked(null);
    setTyped("");
    setSpell(null);
  }, [mode, queue, index, byId]);

  const finished = index >= queue.length || !current;

  // Keyboard: space/enter reveal, ← or 1 = don't know, → or 2 = know.
  useEffect(() => {
    if (mode !== "cards" || finished) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && (event.key === "ArrowLeft" || event.key === "1")) {
        record(false);
        next();
      } else if (revealed && (event.key === "ArrowRight" || event.key === "2")) {
        record(true);
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, finished, revealed, record, next]);

  useEffect(() => {
    if (mode === "spell" && !finished) spellRef.current?.focus();
  }, [mode, index, finished]);

  if (finished) {
    const missed = [...new Set(answers.filter((a) => !a.correct).map((a) => a.id))].filter((id) =>
      byId.has(id),
    );
    return (
      <Summary
        answers={answers}
        onAgain={
          missed.length > 0
            ? () => {
                const again = shuffle(missed);
                if (mode === "cards") {
                  const first = again[0] ? byId.get(again[0]) : undefined;
                  if (first) speakEnglish(first.lemma);
                }
                setQueue(again);
                setIndex(0);
                setAnswers([]);
                setRevealed(false);
                setPicked(null);
                setTyped("");
                setSpell(null);
              }
            : null
        }
        onBack={onExit}
        onRestart={onOverview}
      />
    );
  }

  const forecast = previewCorrect(current);
  const due = isDue(current);

  const actions = mode === "cards" || answered;
  return (
    <div
      className={cn(
        "mx-auto grid max-w-2xl gap-4 px-4 pt-4 pb-4 sm:px-6 sm:pt-8 sm:pb-8",
        actions && "max-sm:pb-36",
      )}
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <button type="button" className={cn(btn.ghost, "-ml-3 min-h-10")} onClick={onExit}>
            <X className="size-4" aria-hidden />
            {t("rv.end")}
          </button>
          <p className="text-sm tabular-nums text-muted">
            {index + 1} / {queue.length}
          </p>
        </div>
        <ProgressBar value={index / queue.length} label={t("rv.roundProgress")} />
      </div>

      <article className="grid content-start gap-5 rounded-3xl border border-line bg-card p-6 shadow-sm sm:p-9">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(chip, due ? "bg-warn-soft text-warn" : "bg-line text-muted")}>
            {due ? t("rv.dueChip") : t("rv.extra")}
          </span>
          {mode === "cards" || answered ? (
            <SpeakButton text={current.lemma} className="-mr-3" />
          ) : null}
        </div>

        {mode === "cards" ? (
          <>
            <div className="grid gap-1.5 text-center">
              <h1 className="font-display text-5xl font-semibold break-words sm:text-6xl" lang="en">
                {current.lemma}
              </h1>
              {current.surface.toLowerCase() !== current.lemma.toLowerCase() ? (
                <p className="text-sm text-muted">
                  {t("common.inBook", { word: "\u0001" })
                    .split("\u0001")
                    .flatMap((piece, i) =>
                      i === 0
                        ? [piece]
                        : [
                            <span key="m" lang="en">
                              {current.surface}
                            </span>,
                            piece,
                          ],
                    )}
                </p>
              ) : null}
            </div>
            {current.sources.length > 0 ? (
              <WordSources word={current} books={books} showMeaning={revealed} />
            ) : current.sentence ? (
              <p className="border-l-2 border-accent/40 pl-3 text-left font-display text-[1.05rem] leading-relaxed text-ink">
                <Highlighted sentence={current.sentence} surface={current.surface} />
              </p>
            ) : null}
            {revealed && current.sources.length === 0 ? (
              <div className="anim-pop grid gap-3 border-t border-line pt-5">
                {current.pos ? (
                  <div>
                    <span className={cn(chip, "bg-accent-soft text-accent")}>
                      <span lang="en">{current.pos}</span>
                    </span>
                  </div>
                ) : null}
                {current.meaning ? (
                  <p className="text-xl leading-relaxed" lang="en" data-source-meaning>
                    {current.meaning}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {mode === "cloze" ? (
          <div className="grid gap-4">
            <p className="text-sm font-semibold text-muted">{t("rv.which")}</p>
            <p className="font-display text-2xl leading-snug" lang="en">
              {picked ? (
                <Highlighted sentence={current.sentence} surface={current.surface} />
              ) : (
                blankOut(current.sentence, current.surface, current.lemma)
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => {
                const shown = picked !== null;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={shown}
                    onClick={() => {
                      setPicked(option.id);
                      record(option.correct);
                      speakEnglish(current.lemma);
                    }}
                    className={cn(
                      "min-h-12 rounded-xl border px-4 py-2 text-left text-lg transition-colors disabled:cursor-default",
                      !shown && "border-line hover:bg-accent-soft",
                      shown && option.correct && "border-accent bg-accent-soft",
                      shown &&
                        picked === option.id &&
                        !option.correct &&
                        "border-warn bg-warn-soft",
                      shown && picked !== option.id && !option.correct && "border-line opacity-50",
                    )}
                    lang="en"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {picked ? (
              <p className="text-base leading-relaxed text-muted" lang="en">
                {current.meaning}
              </p>
            ) : null}
          </div>
        ) : null}

        {mode === "spell" ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (spell) return;
              const ok = spellingOk(typed, current.lemma, current.surface);
              setSpell(ok ? "yes" : "no");
              record(ok);
              speakEnglish(current.lemma);
            }}
          >
            <p className="text-sm font-semibold text-muted">{t("rv.spellPrompt")}</p>
            <p className="text-xl leading-relaxed" lang="en">
              {current.meaning}
            </p>
            <p className="font-display text-base leading-relaxed text-muted" lang="en">
              {blankOut(current.sentence, current.surface, current.lemma)}
            </p>
            <input
              ref={spellRef}
              className={cn(field, "min-h-12 text-lg")}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={spell !== null}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              lang="en"
              aria-label={t("rv.spellAria")}
              placeholder={t("rv.typeWord")}
            />
            {spell === "yes" ? (
              <p className="flex items-center gap-2 font-semibold text-accent">
                <Check className="size-4" aria-hidden />
                {t("rv.right")}
              </p>
            ) : null}
            {spell === "no" ? (
              <p>
                {t("rv.rightSpelling", { word: "\u0001" })
                  .split("\u0001")
                  .flatMap((piece, i) =>
                    i === 0
                      ? [piece]
                      : [
                          <span key="w" className="font-display text-xl font-semibold" lang="en">
                            {current.lemma}
                          </span>,
                          piece,
                        ],
                  )}
              </p>
            ) : null}
            {spell ? null : (
              <button type="submit" className={btn.primary} disabled={typed.trim().length < 2}>
                {t("rv.check")}
              </button>
            )}
          </form>
        ) : null}
      </article>

      {actions ? (
        <div
          data-review-actions
          className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-sm:z-30 max-sm:border-t max-sm:border-line max-sm:bg-paper/95 max-sm:px-4 max-sm:py-3 max-sm:backdrop-blur"
        >
          <div className="mx-auto grid max-w-2xl gap-2">
            {mode === "cards" && !revealed ? (
              <>
                <p className="text-center text-xs text-muted">{t("rv.think")}</p>
                <button type="button" className={cn(btn.quiet, "min-h-12")} onClick={() => setRevealed(true)}>
                  {t("rv.showMeaning")}
                  <kbd className="hidden rounded border border-line px-1.5 text-xs text-muted sm:inline">
                    {t("rv.space")}
                  </kbd>
                </button>
              </>
            ) : null}
            {mode === "cards" && revealed ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={cn(
                    btn.quiet,
                    "min-h-14 flex-col gap-0 border-warn/40 text-warn hover:bg-warn-soft",
                  )}
                  onClick={() => {
                    record(false);
                    next();
                  }}
                >
                  <span>{t("rv.dontKnow")}</span>
                  <span className="text-xs font-normal opacity-75">{t("rv.dontKnowSub")}</span>
                </button>
                <button
                  type="button"
                  className={cn(btn.primary, "min-h-14 flex-col gap-0")}
                  onClick={() => {
                    record(true);
                    next();
                  }}
                >
                  <span>{t("rv.know")}</span>
                  <span className="text-xs font-normal opacity-80">
                    {!due
                      ? t("rv.noChange")
                      : forecast.mastered
                        ? t("rv.fully")
                        : tn("rv.seeAgain", forecast.days)}
                  </span>
                </button>
              </div>
            ) : null}
            {mode !== "cards" && answered ? (
              <button type="button" className={cn(btn.primary, "min-h-12")} onClick={next} autoFocus>
                {t("rv.nextCard")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- screen */

export function ReviewScreen({
  books,
  words,
  bookId,
  onBack,
}: {
  books: Book[];
  words: VocabEntry[];
  bookId: string | null;
  onBack: () => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("cards");
  const [phase, setPhase] = useState<"pending" | "overview" | "session">("pending");
  const [session, setSession] = useState<{ ids: string[]; key: number } | null>(null);
  // One boot per visit. A refresh keeps history.state, so the cards open again.
  // The chart page is only reached from "See review overview" after a round.
  const booted = useRef(false);
  const bookKey = useMemo(() => {
    const book = bookId ? books.find((item) => item.id === bookId) : undefined;
    return book ? bookSyncKey(book) : "";
  }, [books, bookId]);
  const scoped = useMemo(
    () => (bookId ? words.filter((word) => bookKey !== "" && hasSourceFrom(word, bookKey)) : words),
    [words, bookId, bookKey],
  );
  const title = bookId ? (books.find((book) => book.id === bookId)?.title ?? "") : t("nb.allBooks");

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // The notebook is the stable page. A bare /review visit (or a refresh that lost the
    // in-memory session) goes back there instead of showing the chart.
    if (!reviewDueIntent()) {
      onBack();
      return;
    }
    const due = scoped.filter((word) => isDue(word));
    if (due.length === 0) {
      onBack();
      return;
    }
    const order = shuffle(due);
    const first = order[0];
    if (first) speakEnglish(first.lemma);
    setSession({ ids: order.map((word) => word.id), key: Date.now() });
    setPhase("session");
  }, [onBack, scoped]);

  function start(kind: Pool) {
    const list =
      kind === "due"
        ? scoped.filter((word) => isDue(word))
        : kind === "learning"
          ? scoped.filter((word) => word.stage < 7)
          : scoped;
    if (list.length === 0) return;
    const order = shuffle(list);
    if (mode === "cards" && order[0]) speakEnglish(order[0].lemma);
    setSession({ ids: order.map((word) => word.id), key: Date.now() });
    setPhase("session");
  }

  if (phase === "session" && session) {
    return (
      <Session
        key={session.key}
        mode={mode}
        initial={session.ids}
        pool={scoped}
        books={books}
        onExit={onBack}
        onOverview={() => {
          setSession(null);
          setPhase("overview");
        }}
      />
    );
  }
  if (phase === "overview") {
    return (
      <Overview
        title={title}
        scoped={scoped}
        mode={mode}
        onMode={setMode}
        onStart={start}
        onBack={onBack}
      />
    );
  }
  return <div className="min-h-[60dvh]" aria-busy="true" />;
}
