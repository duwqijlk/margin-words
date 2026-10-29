/**
 * The first-run tutorial: an animated dialog that explains how this reader works (every book has
 * its own word list, so a book is found in Discover, then paired with the reader's own EPUB) and
 * recommends the Magic Tree House series to start with (src/components/tutorial-dialog.tsx).
 *
 * The empty shelf itself stays one line of text (AGENTS.md); the tutorial is a dialog over it,
 * shown once per device when the shelf is empty, and again from Settings.
 */
import { create } from "zustand";

export const TUTORIAL_KEY = "cibian-tutorial-v1";
/** The series the last scene recommends: short chapters, simple English, more than fifty books. */
export const STARTER_SERIES = "Magic Tree House";

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "seen";
  } catch {
    // No storage (private mode): showing it once per visit is better than never.
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "seen");
  } catch {
    // Nothing to do: the tutorial may show again next time.
  }
}

/**
 * Shown by itself only on the shelf, with no book on it, to a device that has not seen it, and not
 * to a signed-in reader (a new device of someone who already reads: the shelf is empty only until
 * the account sync has run).
 */
export function shouldOfferTutorial(screen: string, bookCount: number, seen: boolean, signedIn: boolean): boolean {
  return screen === "shelf" && bookCount === 0 && !seen && !signedIn;
}

type TutorialState = { open: boolean; show: () => void; hide: () => void };

export const useTutorial = create<TutorialState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => {
    markTutorialSeen();
    set({ open: false });
  },
}));

/** A series Discover should open as its "See all" list the next time it shows (from the tutorial). */
type DiscoverIntent = { series: string; openSeries: (name: string) => void; take: () => string };

export const useDiscoverIntent = create<DiscoverIntent>((set, get) => ({
  series: "",
  openSeries: (name) => set({ series: name }),
  take: () => {
    const name = get().series;
    if (name) set({ series: "" });
    return name;
  },
}));

/**
 * The feedback tip: after the reader's first word list is paired with their own EPUB, the book opens
 * and a short animated tip shows how to tell us a meaning is too hard, or that a hard word is not
 * marked (src/components/feedback-tip-dialog.tsx). Once per device.
 */
export const FEEDBACK_TIP_KEY = "cibian-feedback-tip-v1";

function readTip(): string {
  try {
    return localStorage.getItem(FEEDBACK_TIP_KEY) ?? "";
  } catch {
    return "seen";
  }
}

/** Call when a pairing has just succeeded. Does nothing once the tip has been seen. */
export function queueFeedbackTip(): void {
  if (readTip() === "seen") return;
  try {
    localStorage.setItem(FEEDBACK_TIP_KEY, "pending");
  } catch {
    // No storage: no tip.
  }
}

export function feedbackTipPending(): boolean {
  return readTip() === "pending";
}

export const useFeedbackTip = create<TutorialState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => {
    try {
      localStorage.setItem(FEEDBACK_TIP_KEY, "seen");
    } catch {
      // It may show again next time.
    }
    set({ open: false });
  },
}));
