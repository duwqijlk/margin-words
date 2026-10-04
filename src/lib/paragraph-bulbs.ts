/**
 * Where the permanent paragraph lightbulbs go. Pure geometry (unit tested in
 * scripts/paragraph-bulbs.test.mjs): every paragraph that owns a real paragraph note shows one
 * small bulb at the end of its last line, always, with no hover. The bulbs are drawn
 * position: fixed by ParagraphBulbs (help-panels.tsx), so the reading text never moves.
 */

export type RectLike = {
  top: number;
  bottom: number;
  /** viewport box of the paragraph's last line of text */
  lineTop: number;
  lineBottom: number;
  /** right edge of that last line, viewport px */
  lineRight: number;
};

export type BulbSpot = {
  /** paragraph number in the chapter (the shared numbering rule) */
  index: number;
  /** viewport px */
  top: number;
  left: number;
  /** true when the space after the last line is tight, so the bulb is the smaller one */
  small: boolean;
};

/** Bulb box sizes (px): after a line that has room, and the smaller one when the line runs to the edge. */
export const BULB_SIZE = 28;
export const EDGE_BULB_SIZE = 24;
/** Space between the last word and the bulb. */
const LINE_GAP = 6;

/**
 * One spot per paragraph that owns a note AND whose last line is on screen. The bulb sits just
 * after that line's last word, on every screen width. Paragraphs without a note get nothing.
 */
export function planBulbs(input: {
  /** per paragraph: does it own a paragraph note? */
  flags: readonly boolean[];
  /** per paragraph: its viewport rectangle (null when unknown) */
  rects: readonly (RectLike | null)[];
  viewportWidth: number;
  viewportHeight: number;
  /** height of the sticky reader header (0 in focus mode) */
  headerHeight: number;
}): BulbSpot[] {
  const { flags, rects, viewportWidth, viewportHeight, headerHeight } = input;
  const spots: BulbSpot[] = [];
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] !== true) continue;
    const rect = rects[index];
    if (!rect) continue;
    const { lineTop, lineBottom, lineRight } = rect;
    if (lineBottom < headerHeight + 4 || lineTop > viewportHeight - 8) continue;
    const space = viewportWidth - lineRight;
    const size = space >= BULB_SIZE + LINE_GAP + 4 ? BULB_SIZE : EDGE_BULB_SIZE;
    const lineH = Math.max(0, lineBottom - lineTop);
    let top = lineH > size * 1.6 ? lineTop + 2 : lineTop + (lineH - size) / 2;
    const minTop = headerHeight + 4;
    const maxTop = viewportHeight - size - 4;
    top = Math.min(Math.max(top, minTop), maxTop);
    // A clamp that leaves the last line means the line is not really on screen.
    if (top + size < lineTop - 2 || top > lineBottom + 2) continue;
    let left = Math.round(lineRight + LINE_GAP);
    const maxLeft = Math.round(viewportWidth - size - 4);
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    spots.push({ index, top: Math.round(top), left, small: size === EDGE_BULB_SIZE });
  }
  return spots;
}
