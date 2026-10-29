/**
 * The review way the reader picked last (design system ReviewLauncher: "remembers the last one").
 * Only a convenience on this device, so it lives in localStorage and is not synced.
 */
import type { Key } from "@/lib/i18n";

export type ReviewMode = "cards" | "cloze" | "spell";
export type ReviewPool = "due" | "learning" | "all";

export const REVIEW_MODES: readonly ReviewMode[] = ["cards", "cloze", "spell"];
const KEY = "cibian-review-mode-v1";

export function isReviewMode(value: unknown): value is ReviewMode {
  return value === "cards" || value === "cloze" || value === "spell";
}

export function savedReviewMode(): ReviewMode {
  try {
    const value = localStorage.getItem(KEY);
    return isReviewMode(value) ? value : "cards";
  } catch {
    return "cards";
  }
}

export function saveReviewMode(mode: ReviewMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode or storage off: the choice lasts for this visit only.
  }
}

/** Fill the blank draws three other words as choices, so it needs at least four words. */
export const CLOZE_MIN_WORDS = 4;

/** The way a round really uses: the saved one, unless it cannot run on these words. */
export function usableMode(mode: ReviewMode, words: number): ReviewMode {
  return mode === "cloze" && words < CLOZE_MIN_WORDS ? "cards" : mode;
}

/** The name of a way to review, as an i18n key. */
export function modeLabel(mode: ReviewMode): Key {
  return mode === "cloze" ? "rv.mode.cloze" : mode === "spell" ? "rv.mode.spell" : "rv.mode.cards";
}
