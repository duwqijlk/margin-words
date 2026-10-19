/**
 * The reader alone decides how far a page turn goes.
 *
 * Six rounds of shrinking our own page step (down to 42% of the screen held back) did not stop
 * "PageDown turns too far" on the e-ink readers, and with that much held back our own step cannot
 * overshoot. So the extra distance comes from somewhere else: the browser's own page scroll on a
 * page key (or a volume key the browser turns into a page scroll before the page ever sees it),
 * alone or on top of ours.
 *
 * This watches every scroll. A run of scroll events with no finger, wheel, pointer or other key
 * behind it, that moved MORE than one of our pages, is put back to exactly one page from where it
 * started. Everything else is left alone:
 *   - a scroll that moved one page or less (a short last strip, our own turn),
 *   - anything the reader touched, dragged or wheeled in the last moments (a fling keeps going
 *     after the finger lifts),
 *   - a scroll during which the document height changed (the engine keeping text in place while
 *     a picture loads above it),
 *   - the reader's own placing (restore, chapter change), which marks itself with `quiet()`.
 */

/** A finger, wheel or pointer this recent makes a scroll the reader's own. A fling outlasts the touch. */
export const INPUT_HOLD_MS = 2500;
/** No scroll event for this long and the run of scrolls is over. */
export const SETTLE_MS = 160;

export type ScrollRun = {
  /** scrollY before the run */
  start: number;
  /** scrollY when it settled */
  end: number;
  /** one page of ours, px */
  step: number;
  /** one text line, px */
  line: number;
  /** the furthest scrollY the page allows */
  maxScroll: number;
};

/** Where an input-less run of scrolls should end instead, or null to leave it where it is. */
export function correctedTurn(run: ScrollRun): number | null {
  const moved = run.end - run.start;
  if (moved === 0) return null;
  const slack = Math.max(2, run.line / 2);
  if (Math.abs(moved) <= run.step + slack) return null;
  const target = Math.min(Math.max(0, run.start + Math.sign(moved) * run.step), Math.max(0, run.maxScroll));
  return Math.abs(target - run.end) > 2 ? target : null;
}

export type PageMove = { start: number; end: number; to: number | null; at: number };

/**
 * Installs the watch on `window`. `step` and `line` are read when a run settles. `enabled` decides
 * whether a run the reader did not start may be corrected (the reader turns it off where a jump
 * without input is normal, such as find-in-page on a desktop). A run that began with our own turn
 * (`turn`) is always held to one page.
 */
export function watchPageMoves(options: {
  step: () => number;
  line: () => number;
  enabled: () => boolean;
  onMove?: (move: PageMove) => void;
}): { turn: (top: number) => void; quiet: (ms?: number) => void; stop: () => void } {
  let inputAt = 0;
  let quietUntil = 0;
  let touching = false;
  let runStart: number | null = null;
  let runHeight = 0;
  let runSpoiled = false;
  let own = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rest = window.scrollY;
  let fixing = false;

  const now = () => Date.now();
  const height = () => document.documentElement.scrollHeight;
  const userInput = () => {
    inputAt = now();
  };
  const touchStart = () => {
    touching = true;
    userInput();
  };
  const touchEnd = () => {
    touching = false;
    userInput();
  };

  const settle = () => {
    timer = null;
    const start = runStart ?? rest;
    const end = window.scrollY;
    const spoiled = runSpoiled || height() !== runHeight;
    const ours = own;
    runStart = null;
    runSpoiled = false;
    own = false;
    rest = end;
    if (fixing) {
      fixing = false;
      return;
    }
    if (spoiled || (!ours && !options.enabled())) {
      options.onMove?.({ start, end, to: null, at: now() });
      return;
    }
    const to = correctedTurn({
      start,
      end,
      step: options.step(),
      line: options.line(),
      maxScroll: Math.max(0, height() - window.innerHeight),
    });
    options.onMove?.({ start, end, to, at: now() });
    if (to === null) return;
    fixing = true;
    rest = to;
    window.scrollTo(0, to);
  };

  const onScroll = () => {
    if (runStart === null) {
      runStart = rest;
      runHeight = height();
    }
    const t = now();
    // Our own turn is held to one page even right after a tap; only a finger on the glass or our
    // own placing takes it over.
    if (touching || t < quietUntil || (!own && t - inputAt < INPUT_HOLD_MS)) runSpoiled = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(settle, SETTLE_MS);
  };

  // A key the reader did not turn a page with (Tab, Home, End, a find-in-page shortcut) moves the
  // page on purpose. The reader's own page keys are already default-prevented when this runs.
  const onKey = (event: KeyboardEvent) => {
    if (!event.defaultPrevented) userInput();
  };

  const opts = { passive: true, capture: true } as const;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("touchstart", touchStart, opts);
  window.addEventListener("touchmove", userInput, opts);
  window.addEventListener("touchend", touchEnd, opts);
  window.addEventListener("touchcancel", touchEnd, opts);
  window.addEventListener("wheel", userInput, opts);
  window.addEventListener("mousedown", userInput, opts);
  window.addEventListener("keydown", onKey, true);

  return {
    /** Our own page turn starts here. A quick second turn starts a new run, so two turns are not one long one. */
    turn(top: number) {
      if (runStart === null || own) {
        runStart = top;
        runHeight = height();
        runSpoiled = false;
      }
      own = true;
    },
    quiet(ms = 400) {
      quietUntil = Math.max(quietUntil, now() + ms);
      if (runStart !== null) runSpoiled = true;
    },
    stop() {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", touchStart, opts);
      window.removeEventListener("touchmove", userInput, opts);
      window.removeEventListener("touchend", touchEnd, opts);
      window.removeEventListener("touchcancel", touchEnd, opts);
      window.removeEventListener("wheel", userInput, opts);
      window.removeEventListener("mousedown", userInput, opts);
      window.removeEventListener("keydown", onKey, true);
    },
  };
}
