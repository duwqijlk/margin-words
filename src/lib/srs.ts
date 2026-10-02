import { MASTERED_STAGE, type VocabEntry } from "./vocab-model.ts";
import { tr } from "./i18n.ts";

/**
 * Spaced repetition on an Ebbinghaus-style ladder: after each successful review the
 * next one comes 1, 2, 4, 7, 15 and 30 days later. A successful review after the
 * 30-day gap makes the word "mastered". A miss sends the card back to the start.
 *
 * stage 0      new, or forgotten (due now)
 * stage 1..6   number of successful reviews so far; next gap = INTERVALS_DAYS[stage - 1]
 * stage 7      mastered (never due again unless the learner re-opens it)
 */
export const INTERVALS_DAYS = [1, 2, 4, 7, 15, 30] as const;

const DAY = 86_400_000;

export function startOfDay(time: number): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local calendar date key, e.g. "2026-10-01". */
export function dayKey(time: number): string {
  const d = new Date(time);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Days between two local calendar days (b - a), DST-safe. */
export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

/** The card after one answer. Cards fall due at the start of a local day. */
export function applyReview(entry: VocabEntry, correct: boolean, now = Date.now()): VocabEntry {
  const base = { ...entry, reps: (entry.reps ?? 0) + 1, lastReviewedAt: now };
  if (!correct) {
    return { ...base, stage: 0, dueAt: now, lapses: (entry.lapses ?? 0) + 1 };
  }
  const stage = Math.min(MASTERED_STAGE, entry.stage + 1);
  if (stage >= MASTERED_STAGE) return { ...base, stage, dueAt: Number.MAX_SAFE_INTEGER };
  const gap = INTERVALS_DAYS[stage - 1] ?? 1;
  return { ...base, stage, dueAt: startOfDay(now) + gap * DAY };
}

/** What a correct answer would schedule, for button hints: days until next review, or "mastered". */
export function previewCorrect(entry: VocabEntry): { mastered: boolean; days: number } {
  const stage = entry.stage + 1;
  if (stage >= MASTERED_STAGE) return { mastered: true, days: 0 };
  return { mastered: false, days: INTERVALS_DAYS[stage - 1] ?? 1 };
}

/** Human label for "next review", in plain English. */
export function dueLabel(entry: VocabEntry, now = Date.now()): string {
  if (entry.stage >= MASTERED_STAGE) return tr("due.mastered");
  const gap = daysBetween(now, entry.dueAt);
  if (entry.dueAt <= now || gap <= 0) return tr("due.today");
  if (gap === 1) return tr("due.tomorrow");
  return tr("due.days", { n: gap });
}

export type SrsStats = {
  total: number;
  due: number;
  learning: number;
  mastered: number;
  /** words per stage 0..7 */
  byStage: number[];
  /** words falling due on each of the next 7 days (index 0 = today, including overdue) */
  upcoming: number[];
};

export function summarize(words: VocabEntry[], now = Date.now()): SrsStats {
  const byStage = Array.from({ length: MASTERED_STAGE + 1 }, () => 0);
  const upcoming = Array.from({ length: 7 }, () => 0);
  let due = 0;
  let mastered = 0;
  for (const word of words) {
    const stage = Math.min(MASTERED_STAGE, Math.max(0, word.stage));
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (stage >= MASTERED_STAGE) {
      mastered += 1;
      continue;
    }
    if (word.dueAt <= now) due += 1;
    const offset = Math.max(0, daysBetween(now, word.dueAt));
    if (offset < 7) upcoming[offset] = (upcoming[offset] ?? 0) + 1;
  }
  return {
    total: words.length,
    due,
    learning: words.length - mastered,
    mastered,
    byStage,
    upcoming,
  };
}

/** Consecutive days (ending today, or yesterday if you have not reviewed yet today) with at least one answer. */
export function streakOf(log: Record<string, { reviewed: number }>, now = Date.now()): number {
  let count = 0;
  let cursor = now;
  if (!log[dayKey(cursor)]?.reviewed) cursor -= 86_400_000;
  while (log[dayKey(cursor)]?.reviewed) {
    count += 1;
    cursor -= 86_400_000;
  }
  return count;
}
