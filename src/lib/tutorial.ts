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
  useTutorialsSeen.getState().note("start");
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
 * The feedback tip: the first time a book is open in the reader on this device, whatever the book
 * (paired with the reader's own EPUB or public domain), a short animated tip shows how to tell us
 * a meaning is too hard, or that a hard word is not marked (src/components/feedback-tip-dialog.tsx).
 */
export const FEEDBACK_TIP_KEY = "cibian-feedback-tip-v1";

/** Seen on this device. Without storage it counts as seen, so it does not show on every book. */
export function feedbackTipSeen(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_TIP_KEY) === "seen";
  } catch {
    return true;
  }
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
    useTutorialsSeen.getState().note("tip");
    set({ open: false });
  },
}));

/**
 * The quote tip (design system QuoteFlow): how to keep a sentence, with a short looping animation
 * for the way this device selects (a mouse drags; a finger uses pick mode). Shown once, the first
 * time a book is open after the feedback tip has been seen (src/components/quote-flow.tsx).
 */
export const QUOTE_TIP_KEY = "cibian-quote-tip-v1";

export function quoteTipSeen(): boolean {
  try {
    return localStorage.getItem(QUOTE_TIP_KEY) === "seen";
  } catch {
    return true;
  }
}

export const useQuoteTip = create<TutorialState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => {
    try {
      localStorage.setItem(QUOTE_TIP_KEY, "seen");
    } catch {
      // It may show again next time.
    }
    useTutorialsSeen.getState().note("quotes");
    set({ open: false });
  },
}));

/** Every tutorial the tutorial tab lists, in its order (design system TutorialTab). */
export const TUTORIALS = ["start", "tip", "quotes"] as const;
export type TutorialId = (typeof TUTORIALS)[number];

function seenNow(id: TutorialId): boolean {
  try {
    const key = id === "start" ? TUTORIAL_KEY : id === "tip" ? FEEDBACK_TIP_KEY : QUOTE_TIP_KEY;
    return localStorage.getItem(key) === "seen";
  } catch {
    return true;
  }
}

/** Which tutorials this device has seen: the tab shows a dot, and "new" on a row, until each is seen. */
export const useTutorialsSeen = create<{ seen: Record<TutorialId, boolean>; note: (id: TutorialId) => void }>((set) => ({
  seen: { start: seenNow("start"), tip: seenNow("tip"), quotes: seenNow("quotes") },
  note: (id) => set((state) => (state.seen[id] ? state : { seen: { ...state.seen, [id]: true } })),
}));

/** Open one tutorial (the tab's list, Settings). */
export function openTutorial(id: TutorialId): void {
  if (id === "start") useTutorial.getState().show();
  else if (id === "tip") useFeedbackTip.getState().show();
  else useQuoteTip.getState().show();
}

/**
 * The list of tutorials: opened from the tutorial tab on wide screens (beside the tab) or from
 * Settings › Tutorials (a bottom sheet on phones, a small window elsewhere).
 */
export const useTutorialList = create<{ open: "tab" | "center" | null; show: (from: "tab" | "center") => void; hide: () => void }>(
  (set) => ({
    open: null,
    show: (from) => set({ open: from }),
    hide: () => set({ open: null }),
  }),
);

/** Any tutorial not seen yet (the dot on the tab and on the Settings button). */
export function useTutorialNews(): boolean {
  const seen = useTutorialsSeen((state) => state.seen);
  return TUTORIALS.some((id) => !seen[id]);
}
