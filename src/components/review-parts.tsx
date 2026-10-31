import { useRef, type KeyboardEvent } from "react";
import { useT, type Key } from "@/lib/i18n";
import { INTERVALS_DAYS, type SrsStats } from "@/lib/srs";
import { CLOZE_MIN_WORDS, REVIEW_MODES, type ReviewMode } from "@/lib/review-mode";
import { MASTERED_STAGE } from "@/lib/vocab-model";
import { cn } from "@/components/ui";

/*
 * Pieces shared by the notebook's review launcher and the review pages (design system
 * ReviewLauncher, ReviewHome, ReviewCharts, MemoryLadder).
 */

const MODE_TEXT: Record<ReviewMode, { label: Key; hint: Key }> = {
  cards: { label: "rv.mode.cards", hint: "rv.mode.cardsHint" },
  cloze: { label: "rv.mode.cloze", hint: "rv.mode.clozeHint" },
  spell: { label: "rv.mode.spell", hint: "rv.mode.spellHint" },
};

/** A small picture of each way, so the three ways can be told apart at a glance. */
function ModeArt({ mode }: { mode: ReviewMode }) {
  if (mode === "cards") {
    return (
      <span className="mode-word font-display font-semibold" lang="en" aria-hidden>
        brave
      </span>
    );
  }
  if (mode === "cloze") {
    return (
      <span className="grid justify-items-center gap-1.5" aria-hidden>
        <span className="mode-cloze font-display whitespace-nowrap text-muted" lang="en">
          a <i className="inline-block h-[0.9em] w-[2.4em] border-b-2 border-edge align-[-0.1em]" /> day
        </span>
        <span className="mode-opts grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={cn("h-2 rounded-sm border", i === 1 ? "border-accent bg-accent" : "border-edge")} />
          ))}
        </span>
      </span>
    );
  }
  return (
    <span className="mode-input inline-flex h-[30px] items-center rounded border border-edge bg-paper px-2 font-display" lang="en" aria-hidden>
      bra
      <i className="mode-caret ml-px h-4 w-px bg-ink" />
    </span>
  );
}

/**
 * The three ways to review as radio cards. Fill the blank is disabled, with its reason, when there
 * are fewer than four words. `compact` is the launcher's row (picture and name); otherwise each card
 * also says how it works.
 */
export function ModeCards({
  value,
  onChange,
  words,
  compact = false,
}: {
  value: ReviewMode;
  onChange: (mode: ReviewMode) => void;
  words: number;
  compact?: boolean;
}) {
  const { t } = useT();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = (mode: ReviewMode) => mode !== "cloze" || words >= CLOZE_MIN_WORDS;
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    for (let i = 1; i <= REVIEW_MODES.length; i += 1) {
      const next = REVIEW_MODES[(index + step * i + REVIEW_MODES.length * 3) % REVIEW_MODES.length] as ReviewMode;
      if (!enabled(next)) continue;
      onChange(next);
      refs.current[REVIEW_MODES.indexOf(next)]?.focus();
      return;
    }
  }
  return (
    <div
      role="radiogroup"
      aria-label={t("rv.type")}
      className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}
      data-review-modes
    >
      {REVIEW_MODES.map((mode, index) => {
        const on = value === mode;
        const ok = enabled(mode);
        return (
          <button
            key={mode}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!ok}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(mode)}
            onKeyDown={(event) => onKey(event, index)}
            data-review-mode={mode}
            className={cn(
              "mode-card grid min-w-0 content-start gap-1 rounded border bg-paper text-left text-ink transition-[background-color,border-color,transform] duration-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55",
              compact ? "p-1.5 pb-2 sm:p-2 sm:pb-2.5" : "grid-cols-[5rem_minmax(0,1fr)] gap-x-3 p-2.5 pb-3 sm:grid-cols-1",
              on
                ? "border-accent bg-accent-soft shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb))]"
                : compact
                  ? // In the review launcher: plain tiles on its ground, no card in a card (design system ReviewLauncher).
                    "border-transparent hover:border-edge"
                  : "border-edge hover:bg-sheet",
            )}
          >
            <span
              className={cn(
                "mode-art grid place-items-center overflow-hidden rounded-sm",
                compact ? "h-10 sm:h-12" : "h-16",
                !compact && "row-span-2 sm:row-span-1",
                on ? "bg-paper" : "bg-sheet",
              )}
            >
              <ModeArt mode={mode} />
            </span>
            <b className={cn("mt-1 text-[15px] font-bold", compact && "text-center text-sm sm:text-[15px]", on && "text-accent")}>{t(MODE_TEXT[mode].label)}</b>
            {!compact ? (
              <small className="text-[13px] leading-snug text-muted">{ok ? t(MODE_TEXT[mode].hint) : t("rv.needs4")}</small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Day names under the 7-day chart: today, tomorrow, then month/day. */
function dayLabels(count: number, t: ReturnType<typeof useT>["t"], now = Date.now()): string[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return t("rv.today");
    if (index === 1) return t("rv.tomorrow");
    const day = new Date(now + index * 86_400_000);
    return `${day.getMonth() + 1}/${day.getDate()}`;
  });
}

/**
 * Words falling due on each of the next seven days (design system ReviewCharts): brand bars,
 * today's in `warn`, the number on top and the day under it; no grid, one rule at the bottom.
 */
export function WeekChart({ upcoming, mini = false }: { upcoming: readonly number[]; mini?: boolean }) {
  const { t } = useT();
  const max = Math.max(1, ...upcoming);
  const labels = dayLabels(upcoming.length, t);
  const tall = mini ? 40 : 72;
  const summary = upcoming.map((count, index) => `${labels[index]} ${count}`).join(", ");
  return (
    <div
      role="img"
      aria-label={`${t("rv.upcomingAria")}: ${summary}`}
      className={cn("week-chart grid grid-cols-7 items-end", mini ? "gap-1.5" : "gap-2 border-b border-line")}
      data-week-chart
    >
      {upcoming.map((count, index) => (
        <div key={index} className="grid justify-items-center gap-1" aria-hidden>
          {/* Today's count is the big number above the chart; its solid bar says enough (design system ReviewLauncher). */}
          <span className={cn("num min-h-4 text-[13px] text-muted", index === 0 && "invisible")}>{count > 0 ? count : ""}</span>
          <i
            className={cn("week-bar block w-full rounded-t-sm", mini ? "max-w-[18px]" : "max-w-7", index === 0 ? "bg-accent" : "bg-accent/40", count === 0 && "opacity-25")}
            style={{ height: count === 0 ? 2 : Math.max(6, Math.round((count / max) * tall)) }}
          />
          <b className={cn("h-[18px] text-xs font-normal whitespace-nowrap text-faint", !mini && "-mb-[22px]")}>{labels[index]}</b>
        </div>
      ))}
    </div>
  );
}

/** Words at each memory step: one 4px bar per step, brand on a rule track (mastered too: green is "learned"). */
export function StageBars({ stats }: { stats: SrsStats }) {
  const { t, tn } = useT();
  const rows: Array<{ label: string; count: number; done?: boolean }> = [
    { label: t("rv.stageNew"), count: stats.byStage[0] ?? 0 },
    ...INTERVALS_DAYS.map((days, index) => ({ label: tn("count.day", days), count: stats.byStage[index + 1] ?? 0 })),
    { label: t("rv.stageMastered"), count: stats.byStage[MASTERED_STAGE] ?? 0, done: true },
  ];
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="m-0 grid list-none gap-2 p-0" aria-label={t("rv.stagesAria")} data-stage-bars>
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-[13px]">
          <span className="truncate text-faint">{row.label}</span>
          <i className="block h-1 bg-line" aria-hidden>
            <b className="block h-full bg-accent" style={{ width: `${(row.count / max) * 100}%` }} />
          </i>
          <em className="text-right not-italic [font-variant-numeric:tabular-nums]">{row.count}</em>
        </li>
      ))}
    </ul>
  );
}

/**
 * The memory ladder (design system MemoryLadder): six short bars for the 1 · 2 · 4 · 7 · 15 · 30-day
 * steps, passed ones brand; all six are brand once the word is mastered (design system ColorRoles). Always next to
 * a due text, never on its own.
 */
export function MemoryLadder({ stage }: { stage: number }) {
  const { t } = useT();
  const done = stage >= MASTERED_STAGE;
  return (
    <span
      className="inline-flex gap-0.5"
      role="img"
      aria-label={done ? t("ladder.done") : t("ladder.passed", { n: stage, total: INTERVALS_DAYS.length })}
      title={t("ladder.title", { days: INTERVALS_DAYS.join(" / ") })}
      data-memory-ladder={done ? "done" : stage}
    >
      {INTERVALS_DAYS.map((days, index) => (
        <i key={days} className={cn("block h-[3px] w-2.5", done || index < stage ? "bg-accent" : "bg-line")} aria-hidden />
      ))}
    </span>
  );
}

/** The last seven days as small squares, read days in brand (design system ReviewSummary, ColorRoles). */
export function StreakDays({ days, pop = false }: { days: readonly boolean[]; pop?: boolean }) {
  return (
    <span className="inline-flex gap-1" aria-hidden data-streak-days>
      {days.map((on, index) => {
        const today = index === days.length - 1;
        return (
          <i
            key={index}
            className={cn(
              "block size-2.5 rounded-sm",
              !on && "bg-line",
              on && !today && "bg-accent",
              on && today && "bg-accent",
              on && today && pop && "streak-pop",
            )}
          />
        );
      })}
    </span>
  );
}
