/**
 * The reader's top bar on a phone: it slides away while the reader scrolls down into the book and
 * comes back on a scroll up. Pure, so the rules are tested alone.
 *
 * Small moves are ignored, so the bar does not flicker on a finger's jitter or a picture loading.
 * Near the top of the page the bar always shows. The reader's own page turns do not go through
 * this rule: a turn's step is worked out with the bar as it stands, so the reader leaves the bar
 * unchanged on a turn and no line is covered or skipped (see `turnTarget` in reader.tsx).
 */

/** Scroll distance in px, in one direction, before the bar changes. */
export const AUTO_HIDE_TRAVEL = 24;
/** Within this many px of the top the bar always shows. */
export const AUTO_HIDE_TOP = 80;
/** Up to this width the bar hides on scroll: the phone layout (Tailwind `md` starts at 768px). */
export const AUTO_HIDE_QUERY = "(max-width: 767px)";

export type BarState = {
  hidden: boolean;
  /** Where the current run of scrolling in one direction began. */
  from: number;
  /** The last position seen. */
  last: number;
};

export function barStart(y: number): BarState {
  return { hidden: false, from: y, last: y };
}

/** The next state after the page scrolled to `y`. */
export function nextBarState(state: BarState, y: number): BarState {
  if (y <= AUTO_HIDE_TOP) return { hidden: false, from: y, last: y };
  const goingDown = y > state.last;
  const wasDown = state.last > state.from;
  // A change of direction starts a new run from the last position.
  const from = y === state.last || goingDown === wasDown || state.last === state.from ? state.from : state.last;
  const travel = y - from;
  let hidden = state.hidden;
  if (travel >= AUTO_HIDE_TRAVEL) hidden = true;
  else if (travel <= -AUTO_HIDE_TRAVEL) hidden = false;
  return { hidden, from, last: y };
}
