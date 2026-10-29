import { ArrowLeft, Check, Flame, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayKey, daysBetween, previewCorrect, streakOf, summarize } from "@/lib/srs";
import { tr, useT } from "@/lib/i18n";
import { reviewIntent } from "@/lib/router";
import { bookSyncKey } from "@/lib/sync-merge";
import { isDue, type Book, type VocabEntry } from "@/lib/vocab-model";
import { useVocab } from "@/lib/vocab-store";
import { holdSyncPushes } from "@/lib/sync-engine";
import { hasSourceFrom } from "@/lib/wordbook";
import {
  CLOZE_MIN_WORDS,
  modeLabel,
  REVIEW_MODES,
  savedReviewMode,
  saveReviewMode,
  usableMode,
  type ReviewMode,
  type ReviewPool,
} from "@/lib/review-mode";
import { bump, confetti, countUp, shake, slideOut, stampPause } from "@/lib/motion";
import { usePresentedWord } from "@/components/presented-word";
import { WordSources } from "@/components/word-sources";
import { WordIpa } from "@/components/word-ipa";
import { ModeCards, StageBars, StreakDays, WeekChart } from "@/components/review-parts";
import { btn, cn, field, Highlighted, ProgressBar, speakEnglish, StatRow } from "@/components/ui";

type Mode = ReviewMode;
type Pool = ReviewPool;

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

/** A sentence with its blank drawn as a short line on the `edge` colour. */
function BlankSentence({ text }: { text: string }) {
  const parts = text.split("______");
  return (
    <span lang="en">
      {parts.flatMap((piece, i) =>
        i === 0
          ? [piece]
          : [
              <i key={i} className="inline-block h-[0.9em] w-[3em] border-b-2 border-edge align-[-0.1em]" aria-label="____" />,
              piece,
            ],
      )}
    </span>
  );
}

function nextDueText(words: VocabEntry[], now = Date.now()): string {
  const future = words
    .filter((word) => !isDue(word, now) && word.stage < 7)
    .map((word) => word.dueAt);
  if (future.length === 0) return "";
  const gap = daysBetween(now, Math.min(...future));
  return gap <= 1 ? tr("rv.nextTomorrow") : tr("rv.nextDays", { n: gap });
}


/* --------------------------------------------------------------- review data */

/**
 * The review data page (design system ReviewHome), opened from the launcher's "Review data": on a
 * wide screen starting a round on the left and the numbers on the right, which stays in view while
 * the page scrolls; on a phone the numbers come under the start. No wall of cards: a rule between
 * the columns, space and hairlines between the parts.
 */
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
  const learning = scoped.filter((word) => word.stage < 7).length;
  const accuracy = today && today.reviewed > 0 ? Math.round((today.correct / today.reviewed) * 100) : null;
  const hint = nextDueText(scoped);
  const used = usableMode(mode, scoped.length);

  return (
    <div
      className="mx-auto grid w-full max-w-[68rem] grid-cols-[minmax(0,1fr)] items-start gap-8 px-4 pt-4 pb-10 sm:px-6 sm:pt-6 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10 lg:gap-y-0"
      data-review-home
    >
      <div className="grid gap-5">
        <button type="button" className={cn(btn.ghost, "-ml-3 min-h-10 justify-self-start px-3")} onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("nav.notebook")}
        </button>
        <header className="grid gap-1">
          <h1 className="m-0 text-2xl leading-tight font-bold tracking-[-0.02em] sm:text-[28px]">{t("rv.title")}</h1>
          <p className="m-0 text-sm text-muted" lang="en">
            {title}
          </p>
        </header>
        <div className="grid gap-2">
          <p className="m-0 flex items-baseline gap-3">
            <b className="font-display text-5xl leading-none font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums]" data-review-due>
              {stats.due}
            </b>
            <span className="text-[15px] text-muted">{tn("rv.dueText", stats.due)}</span>
          </p>
          <p className="m-0 text-sm text-muted">
            {stats.due === 0 ? (hint ? t("rv.finishedNext", { hint }) : t("rv.finished")) : null}
          </p>
        </div>
        <ModeCards value={used} words={scoped.length} onChange={onMode} />
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className={cn(btn.primary, "min-h-[52px] sm:col-span-2")}
            disabled={stats.due === 0}
            onClick={() => onStart("due")}
          >
            {t("rv.startToday", { n: stats.due })}
          </button>
          <button type="button" className={btn.quiet} disabled={learning === 0} onClick={() => onStart("learning")}>
            {t("rv.practiceLearning", { n: learning })}
          </button>
          <button type="button" className={btn.quiet} disabled={scoped.length === 0} onClick={() => onStart("all")}>
            {t("rv.practiceAll", { n: scoped.length })}
          </button>
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-faint">{t("rv.ladderHelp")}</p>
      </div>

      <aside className="grid gap-6 border-t border-line pt-6 lg:sticky lg:top-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        <StatRow
          pair
          items={[
            {
              label: t("rv.reviewedToday"),
              value: today?.reviewed ?? 0,
              hint: accuracy === null ? undefined : t("rv.correct", { pct: accuracy }),
            },
            {
              label: t("rv.streak"),
              value: streak,
              hint: streak > 0 ? tn("rv.streakDay", streak) : t("rv.streakStart"),
            },
            { label: t("stat.learning"), value: stats.learning },
            { label: t("stat.mastered"), value: stats.mastered, tone: "mark" },
          ]}
        />
        <section className="grid gap-3 pb-[22px]">
          <h2 className="m-0 text-[15px] font-bold">{t("rv.next7")}</h2>
          <WeekChart upcoming={stats.upcoming} />
        </section>
        <section className="grid gap-3">
          <h2 className="m-0 text-[15px] font-bold">{t("rv.memory")}</h2>
          <StageBars stats={stats} />
        </section>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------- round complete */

type Answer = { id: string; correct: boolean };

/**
 * The end of a round (design system ReviewSummary, RoundComplete): the one big celebration of the
 * site. One fall of confetti, "known" and "not yet" counting up from 0, then a highlighter under
 * "known"; the streak with today's square lit. No mascot, no overlay, nothing moves on by itself.
 */
function Summary({
  answers,
  mode,
  poolSize,
  onAgain,
  onBack,
  onOtherWay,
}: {
  answers: Answer[];
  mode: Mode;
  poolSize: number;
  onAgain: (() => void) | null;
  onBack: () => void;
  onOtherWay: (mode: Mode) => void;
}) {
  const { t, tn } = useT();
  const log = useVocab((state) => state.log);
  const right = answers.filter((a) => a.correct).length;
  const wrong = answers.length - right;
  const host = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLSpanElement | null>(null);
  const wrongRef = useRef<HTMLSpanElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const [marked, setMarked] = useState(false);
  const streak = streakOf(log);
  // Did this round start today's streak? Then the number steps up as the round ends.
  const startedToday = (log[dayKey(Date.now())]?.reviewed ?? 0) === answers.length && streak > 0;
  const [streakShown, setStreakShown] = useState(startedToday ? streak - 1 : streak);
  const days = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 7 }, (_, i) => Boolean(log[dayKey(now - (6 - i) * 86_400_000)]?.reviewed));
  }, [log]);

  useEffect(() => {
    confetti(host.current);
    const stopRight = countUp(rightRef.current, right, () => setMarked(right > 0));
    const stopWrong = countUp(wrongRef.current, wrong);
    const step = window.setTimeout(() => {
      setStreakShown(streak);
      bump(todayRef.current, 1.2);
    }, 600);
    return () => {
      stopRight();
      stopWrong();
      window.clearTimeout(step);
    };
    // Once, when the round ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const others = REVIEW_MODES.filter((item) => item !== mode && (item !== "cloze" || poolSize >= CLOZE_MIN_WORDS));

  return (
    <div ref={host} className="mx-auto grid w-full max-w-[30rem] gap-4 px-4 pt-10 pb-14 text-center sm:pt-16" data-review-summary>
      <h1 className="m-0 text-[28px] leading-tight font-bold tracking-[-0.02em]">{t("rv.roundDone")}</h1>
      <p className="m-0 text-muted">{t("rv.sumLine", { words: tn("count.word", answers.length) })}</p>
      <dl className="m-0 grid grid-cols-2 gap-1.5 text-left">
        <div className="stat-tile rounded-2xl bg-sheet px-5 pt-4 pb-[18px]">
          <dt className="text-[13px] text-faint">{t("rv.sumRight")}</dt>
          <dd className="m-0 mt-2 font-display text-4xl leading-none font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums]">
            <span className="num-grow" data-on={marked || undefined}>
              <span ref={rightRef} data-summary-right>
                {right}
              </span>
              <i aria-hidden />
            </span>
          </dd>
        </div>
        <div className="stat-tile rounded-2xl bg-sheet px-5 pt-4 pb-[18px]">
          <dt className="text-[13px] text-faint">{t("rv.sumWrong")}</dt>
          <dd className="m-0 mt-2 font-display text-4xl leading-none font-bold tracking-[-0.02em] text-warn [font-variant-numeric:lining-nums_tabular-nums]">
            <span ref={wrongRef} data-summary-wrong>
              {wrong}
            </span>
          </dd>
        </div>
      </dl>
      <div className="inline-flex items-center justify-center gap-2.5 text-[15px] text-muted" data-summary-streak>
        <Flame className="size-4 text-warn" aria-hidden />
        <span>{t("rv.streak")}</span>
        <b className="font-display text-xl font-bold text-ink [font-variant-numeric:lining-nums_tabular-nums]">{streakShown}</b>
        <div ref={todayRef} className="inline-flex">
          <StreakDays days={days} pop={startedToday} />
        </div>
      </div>
      <div className="grid gap-2 pt-2">
        {onAgain ? (
          <button type="button" className={cn(btn.primary, "min-h-12")} onClick={onAgain}>
            <RotateCcw className="size-4" aria-hidden />
            {t("rv.again")}
          </button>
        ) : null}
        <button type="button" className={cn(onAgain ? btn.quiet : btn.primary, "min-h-12")} onClick={onBack}>
          {t("rv.backNotebook")}
        </button>
      </div>
      {others.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted" data-summary-other>
          <span>{t("rv.otherWays")}</span>
          {others.map((item) => (
            <button key={item} type="button" className={cn(btn.bare, "min-h-10 px-2 text-sm text-accent")} onClick={() => onOtherWay(item)}>
              {t(modeLabel(item))}
            </button>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- session */

/** The headword block shared by both faces of a flash card: word, the form met in the book, UK / US. */
function CardHead({ word, heading }: { word: VocabEntry; heading: boolean }) {
  const { t } = useT();
  const Tag = heading ? "h1" : "p";
  return (
    <div className="grid justify-items-center gap-2">
      <Tag className="m-0 font-display text-[44px] leading-[1.05] font-semibold tracking-[-0.02em] wrap-any sm:text-[56px]" lang="en">
        {word.lemma}
      </Tag>
      {word.surface.toLowerCase() !== word.lemma.toLowerCase() ? (
        <p className="m-0 text-[13px] text-faint">
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
        </p>
      ) : null}
      <div className="review-ipa">
        <WordIpa word={word.lemma} surface={word.surface} phrase={/\s/.test(word.lemma)} />
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
  onOtherWay,
}: {
  mode: Mode;
  books: Book[];
  initial: string[];
  /** words to draw cloze distractors from */
  pool: VocabEntry[];
  onExit: () => void;
  onOtherWay: (mode: Mode, ids: string[]) => void;
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
  const [stamp, setStamp] = useState(false);
  const [combo, setCombo] = useState(0);
  const spellRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const comboRef = useRef<HTMLElement | null>(null);
  const busy = useRef(false);

  // One upload per few answers instead of one per answer (sync-pace.ts); leaving uploads the rest.
  useEffect(() => holdSyncPushes(), []);

  const byId = useMemo(() => new Map(allWords.map((word) => [word.id, word])), [allWords]);
  const currentId = queue[index];
  const current = currentId ? byId.get(currentId) : undefined;
  const shown = usePresentedWord(current, books) ?? current;

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

  const answered = mode === "cards" ? revealed : mode === "cloze" ? picked !== null : spell !== null;
  const lastCorrect = answers[answers.length - 1]?.correct ?? false;

  useEffect(() => {
    if (combo >= 2) bump(comboRef.current, 1.25);
  }, [combo]);

  const record = useCallback(
    (correct: boolean) => {
      if (!current) return;
      review(current.id, correct, isDue(current));
      setAnswers((list) => [...list, { id: current.id, correct }]);
      setCombo((value) => (correct ? value + 1 : 0));
      if (correct) setStamp(true);
      else void shake(cardRef.current);
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
    setStamp(false);
  }, [mode, queue, index, byId]);

  /** Known: a check stamp, then the card leaves to the right. Not yet: a shake, then to the left. */
  const grade = useCallback(
    async (correct: boolean) => {
      if (busy.current) return;
      busy.current = true;
      record(correct);
      if (correct) await stampPause();
      else await shake(cardRef.current);
      await slideOut(cardRef.current, correct ? "right" : "left");
      next();
      busy.current = false;
    },
    [record, next],
  );

  /** Fill the blank and spelling: the answer has been marked; Next sends the card away. */
  const leave = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    await slideOut(cardRef.current, lastCorrect ? "right" : "left");
    next();
    busy.current = false;
  }, [lastCorrect, next]);

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
        void grade(false);
      } else if (revealed && (event.key === "ArrowRight" || event.key === "2")) {
        void grade(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, finished, revealed, grade]);

  useEffect(() => {
    if (mode === "spell" && !finished) spellRef.current?.focus();
  }, [mode, index, finished]);

  if (finished) {
    const missed = [...new Set(answers.filter((a) => !a.correct).map((a) => a.id))].filter((id) => byId.has(id));
    return (
      <Summary
        key={`${queue.join()}-${answers.length}`}
        answers={answers}
        mode={mode}
        poolSize={pool.length}
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
                setCombo(0);
                setRevealed(false);
                setPicked(null);
                setTyped("");
                setSpell(null);
                setStamp(false);
              }
            : null
        }
        onBack={onExit}
        onOtherWay={(other) => onOtherWay(other, [...new Set(queue)].filter((id) => byId.has(id)))}
      />
    );
  }

  if (!shown) return null;

  const forecast = previewCorrect(current);
  const due = isDue(current);

  const top = (
    <div className="flex min-h-6 items-center justify-between gap-2 text-left">
      <span className={cn("text-xs", due ? "font-bold text-warn" : "text-faint")}>{due ? t("rv.dueChip") : t("rv.extra")}</span>
      {combo >= 2 ? (
        <span className="inline-flex h-6 items-center gap-1.5 text-sm leading-none font-bold text-accent" data-review-combo>
          <Flame className="size-4 shrink-0" aria-hidden />
          {t("rv.combo")}
          <b ref={comboRef} className="inline-block text-[15px] leading-none [font-variant-numeric:lining-nums_tabular-nums]">
            {combo}
          </b>
        </span>
      ) : null}
    </div>
  );

  const fallbackSentence = shown.sentence ? (
    <p className="source-sentence m-0 font-display text-[17px] leading-relaxed wrap-any sm:text-[19px]">
      <Highlighted sentence={shown.sentence} surface={shown.surface} />
    </p>
  ) : null;

  const actions = mode === "cards" || answered;
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[40rem] grid-cols-[minmax(0,1fr)] gap-3.5 px-4 pt-2 pb-4 sm:gap-5 sm:px-6 sm:pt-8 sm:pb-8",
        actions && "max-sm:pb-40",
      )}
      data-review-session
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <button type="button" className={cn(btn.bare, "-ml-3 min-h-10 px-3 text-muted")} onClick={onExit}>
            <X className="size-4" aria-hidden />
            {t("rv.end")}
          </button>
          <p className="m-0 text-sm text-muted [font-variant-numeric:tabular-nums]" data-review-count>
            {index + 1} / {queue.length}
          </p>
        </div>
        <ProgressBar className="review-progress" value={index / queue.length} label={t("rv.roundProgress")} />
      </div>

      <div key={`${currentId}-${index}`} ref={cardRef} className="review-enter relative">
        {mode === "cards" ? (
          <div className={cn("review-flip", revealed && "is-flipped")}>
            <article className="review-flip-inner grid" data-review-card>
              <div
                className="review-face grid content-start gap-4 rounded-2xl bg-sheet px-4 pt-5 pb-6 text-center sm:min-h-[22rem] sm:gap-5 sm:px-8 sm:pt-7 sm:pb-8"
                aria-hidden={revealed || undefined}
                inert={revealed || undefined}
              >
                {top}
                <CardHead word={current} heading />
                {shown.sources.length > 0 ? (
                  <WordSources word={shown} books={books} look="card" showMeaning={false} />
                ) : (
                  fallbackSentence
                )}
              </div>
              <div
                className={cn(
                  "review-face review-back grid content-start gap-4 rounded-2xl bg-sheet px-4 pt-5 pb-6 text-center sm:min-h-[22rem] sm:gap-5 sm:px-8 sm:pt-7 sm:pb-8",
                  !revealed && "invisible",
                )}
                aria-hidden={!revealed || undefined}
                inert={!revealed || undefined}
                data-review-back
              >
                {top}
                <CardHead word={current} heading={false} />
                {shown.sources.length > 0 ? (
                  <WordSources word={shown} books={books} look="card" showMeaning />
                ) : (
                  <>
                    {fallbackSentence}
                    <div className="grid gap-1.5 border-t border-line pt-4">
                      {shown.pos ? (
                        <span className="text-[13px] text-faint" lang="en">
                          {shown.pos}
                        </span>
                      ) : null}
                      {shown.meaning ? (
                        <p className="m-0 text-xl leading-snug wrap-any" lang="en" data-source-meaning>
                          {shown.meaning}
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </article>
          </div>
        ) : null}

        {mode === "cloze" ? (
          <article className="grid content-start gap-4 rounded-2xl bg-sheet px-4 pt-5 pb-6 sm:gap-5 sm:px-8 sm:pt-7 sm:pb-8" data-review-card>
            {top}
            <p className="m-0 text-[15px] font-bold text-muted">{t("rv.which")}</p>
            <p className="m-0 font-display text-2xl leading-normal wrap-any" lang="en">
              {picked ? (
                <Highlighted sentence={shown.sentence} surface={shown.surface} />
              ) : (
                <BlankSentence text={blankOut(shown.sentence, shown.surface, shown.lemma)} />
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {options.map((option) => {
                const done = picked !== null;
                const right = done && option.correct;
                const wrong = done && picked === option.id && !option.correct;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={done}
                    onClick={() => {
                      setPicked(option.id);
                      record(option.correct);
                      speakEnglish(current.lemma);
                    }}
                    data-choice={right ? "right" : wrong ? "wrong" : undefined}
                    className={cn(
                      "inline-flex min-h-[52px] min-w-0 items-center justify-center gap-1.5 rounded border px-3 font-display text-lg wrap-any transition-[background-color,border-color,transform] duration-100 active:scale-[0.96] disabled:cursor-default",
                      !done && "border-edge bg-paper text-ink hover:bg-accent-soft",
                      right && "border-accent bg-accent-soft font-semibold text-accent",
                      wrong && "border-warn bg-warn-soft text-warn",
                      done && !right && !wrong && "border-edge bg-paper text-ink opacity-50",
                    )}
                    lang="en"
                  >
                    {right ? <Check className="size-[18px] shrink-0" strokeWidth={2} aria-hidden /> : null}
                    {wrong ? <X className="size-[18px] shrink-0" strokeWidth={2} aria-hidden /> : null}
                    {option.label}
                  </button>
                );
              })}
            </div>
            {picked ? (
              <p className="m-0 text-base leading-relaxed text-muted" lang="en" data-source-meaning>
                {shown.meaning}
              </p>
            ) : null}
          </article>
        ) : null}

        {mode === "spell" ? (
          <article className="grid content-start gap-4 rounded-2xl bg-sheet px-4 pt-5 pb-6 sm:gap-5 sm:px-8 sm:pt-7 sm:pb-8" data-review-card>
            {top}
            <p className="m-0 text-[15px] font-bold text-muted">{t("rv.spellPrompt")}</p>
            <p className="m-0 text-xl leading-snug wrap-any" lang="en" data-source-meaning>
              {shown.meaning}
            </p>
            {shown.sentence ? (
              <p className="m-0 font-display text-base leading-relaxed text-muted wrap-any">
                <BlankSentence text={blankOut(shown.sentence, shown.surface, shown.lemma)} />
              </p>
            ) : null}
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (spell) return;
                const ok = spellingOk(typed, current.lemma, current.surface);
                setSpell(ok ? "yes" : "no");
                record(ok);
                speakEnglish(current.lemma);
              }}
            >
              <input
                ref={spellRef}
                className={cn(field, "min-h-[52px] font-display text-xl")}
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
              <button type="submit" className={cn(btn.primary, "min-h-[52px]")} disabled={spell !== null || typed.trim().length < 2}>
                {t("rv.check")}
              </button>
            </form>
            {spell === "yes" ? (
              <p className="m-0 flex items-center gap-1.5 font-bold text-accent">
                <Check className="size-[18px]" strokeWidth={2} aria-hidden />
                {t("rv.right")}
              </p>
            ) : null}
            {spell === "no" ? (
              <p className="m-0">
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
          </article>
        ) : null}

        {stamp ? (
          <div className="review-stamp pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <i className="grid size-[72px] place-items-center rounded-full bg-accent text-accent-ink">
              <Check className="size-9" strokeWidth={2.5} />
            </i>
          </div>
        ) : null}
      </div>

      {actions ? (
        <div
          data-review-actions
          className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(3.75rem+env(safe-area-inset-bottom))] max-sm:z-30 max-sm:border-t max-sm:border-line max-sm:bg-paper max-sm:px-4 max-sm:py-3"
        >
          <div className="mx-auto grid max-w-[40rem] gap-2">
            {mode === "cards" && !revealed ? (
              <>
                <p className="m-0 text-center text-[13px] text-faint">{t("rv.think")}</p>
                <button type="button" className={cn(btn.quiet, "min-h-[52px] w-full")} onClick={() => setRevealed(true)}>
                  {t("rv.showMeaning")}
                  <kbd className="ml-1.5 hidden rounded-sm border border-line px-1.5 font-sans text-xs font-normal text-faint sm:inline">
                    {t("rv.space")}
                  </kbd>
                </button>
              </>
            ) : null}
            {mode === "cards" && revealed ? (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className={cn(btn.quiet, "min-h-14 flex-col gap-0")} onClick={() => void grade(false)} data-grade="no">
                  <span>{t("rv.dontKnow")}</span>
                  <small className="text-xs font-normal opacity-80">{t("rv.dontKnowSub")}</small>
                </button>
                <button type="button" className={cn(btn.primary, "min-h-14 flex-col gap-0")} onClick={() => void grade(true)} data-grade="yes">
                  <span>{t("rv.know")}</span>
                  <small className="text-xs font-normal opacity-80">
                    {!due ? t("rv.noChange") : forecast.mastered ? t("rv.fully") : tn("rv.seeAgain", forecast.days)}
                  </small>
                </button>
              </div>
            ) : null}
            {mode !== "cards" && answered ? (
              <button type="button" className={cn(btn.primary, "min-h-[52px]")} onClick={() => void leave()} autoFocus>
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
  const [mode, setMode] = useState<Mode>(() => {
    const intent = reviewIntent();
    return intent && intent.pool !== "overview" ? intent.mode : savedReviewMode();
  });
  const [phase, setPhase] = useState<"pending" | "overview" | "session">("pending");
  const [session, setSession] = useState<{ ids: string[]; key: number } | null>(null);
  // One boot per visit. A refresh keeps history.state, so the same round (or the data page) opens again.
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

  const pick = useCallback(
    (kind: Pool) =>
      kind === "due"
        ? scoped.filter((word) => isDue(word))
        : kind === "learning"
          ? scoped.filter((word) => word.stage < 7)
          : scoped,
    [scoped],
  );

  const begin = useCallback(
    (list: VocabEntry[], way: Mode) => {
      const order = shuffle(list);
      if (way === "cards" && order[0]) speakEnglish(order[0].lemma);
      setSession({ ids: order.map((word) => word.id), key: Date.now() });
      setPhase("session");
    },
    [],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // The notebook is the stable page: a bare /review visit (or a refresh with nothing to do) goes back there.
    const intent = reviewIntent();
    if (!intent) {
      onBack();
      return;
    }
    if (intent.pool === "overview") {
      setPhase("overview");
      return;
    }
    const list = pick(intent.pool);
    if (list.length === 0) {
      onBack();
      return;
    }
    const way = usableMode(intent.mode, scoped.length);
    setMode(way);
    begin(list, way);
  }, [onBack, pick, begin, scoped.length]);

  if (phase === "session" && session) {
    const way = usableMode(mode, scoped.length);
    return (
      <Session
        key={session.key}
        mode={way}
        initial={session.ids}
        pool={scoped}
        books={books}
        onExit={onBack}
        onOtherWay={(other, ids) => {
          setMode(other);
          saveReviewMode(other);
          const byId = new Map(words.map((word) => [word.id, word]));
          begin(ids.map((id) => byId.get(id)).filter((word): word is VocabEntry => Boolean(word)), other);
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
        onMode={(next) => {
          setMode(next);
          saveReviewMode(next);
        }}
        onStart={(kind) => {
          const list = pick(kind);
          if (list.length > 0) begin(list, usableMode(mode, scoped.length));
        }}
        onBack={onBack}
      />
    );
  }
  return <div className="min-h-[60dvh]" aria-busy="true" />;
}
