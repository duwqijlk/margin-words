/**
 * Where the permanent paragraph lightbulbs go. Pure geometry (unit tested in
 * scripts/paragraph-bulbs.test.mjs): a paragraph that owns a real paragraph note shows one
 * small bulb beside its last line when a safe margin fits, with no hover. The bulbs are drawn
 * position: fixed by ParagraphBulbs (help-panels.tsx), so the reading text never moves.
 */

export type RectLike = {
  top: number;
  bottom: number;
  /** viewport box of the paragraph's last line of text */
  lineTop: number;
  lineBottom: number;
  /** left edge of that last line, viewport px */
  lineLeft: number;
  /** right edge of that last line, viewport px */
  lineRight: number;
};

export type BulbSpot = {
  /** paragraph number in the chapter (the shared numbering rule) */
  index: number;
  /** viewport px */
  top: number;
  left: number;
  /** rendered box size in px; margin fallbacks are deliberately smaller */
  size: number;
  /** true when the space after the last line is tight, so the bulb is smaller */
  small: boolean;
};

/** Bulb box sizes (px): after a line that has room, and the smaller one when the line runs to the edge. */
export const BULB_SIZE = 28;
export const EDGE_BULB_SIZE = 24;
/** A last-resort margin bulb. It is small enough for the 20px phone edge gutter. */
export const MARGIN_BULB_SIZE = 18;
/** Space between the last word and the normal/edge bulb. */
const LINE_GAP = 6;
/** Margin fallbacks keep a little air from the text, but may use the viewport edge. */
const MARGIN_GAP = 2;
/** Normal and edge bulbs keep a small inset from the viewport edge. */
const EDGE_INSET = 4;

/**
 * Measure only paragraphs intersecting the reading viewport. Checking the block first avoids
 * building Range rectangles for every offscreen noted paragraph on every scroll frame.
 * A paragraph starting above the screen can still have its last line visible.
 */
export function lastLineBox(
  el: Element,
  viewport: { width: number; height: number; headerHeight: number },
): RectLike | null {
  const box = el.getBoundingClientRect();
  if (
    box.width < 1 || box.height < 1 ||
    box.bottom <= viewport.headerHeight || box.top >= viewport.height ||
    box.right <= 0 || box.left >= viewport.width
  ) return null;

  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  let last: DOMRect | null = null;
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (rect.width < 1 || rect.height < 1) continue;
    last = rect;
    break;
  }
  if (!last) return null;
  let lineLeft = last.left;
  let lineRight = last.right;
  // A final line can contain several spans/word buttons. The last fragment alone does not
  // describe its empty margins: union every fragment overlapping its vertical band.
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (rect.width < 1 || rect.height < 1 || rect.bottom <= last.top || rect.top >= last.bottom) continue;
    lineLeft = Math.min(lineLeft, rect.left);
    lineRight = Math.max(lineRight, rect.right);
  }
  return {
    top: box.top,
    bottom: box.bottom,
    lineTop: last.top,
    lineBottom: last.bottom,
    lineLeft,
    lineRight,
  };
}

/**
 * One spot per noted paragraph whose last line has a safe visible margin. Prefer just after
 * its last word, then the left margin; never cover text or move below into the next line.
 * The 18px fallback trades a smaller tap target for keeping notes discoverable without reflow.
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
    const { lineTop, lineBottom, lineLeft, lineRight } = rect;
    if (lineBottom < headerHeight + 4 || lineTop > viewportHeight - 8) continue;

    // Keep the normal bulb in the text's own right margin. On a phone there may not be
    // enough room for that box, but a smaller bulb can still sit in the remaining margin
    // and touch the viewport edge. Never clamp a box back over the last word.
    const rightSpace = viewportWidth - lineRight;
    const visibleTop = Math.ceil(Math.max(lineTop, headerHeight + 4));
    const visibleBottom = Math.floor(Math.min(lineBottom, viewportHeight - 4));
    const lineRoom = visibleBottom - visibleTop;
    let size: number;
    let left: number;
    if (lineRoom >= BULB_SIZE && rightSpace >= BULB_SIZE + LINE_GAP + EDGE_INSET) {
      size = BULB_SIZE;
      left = Math.ceil(lineRight + LINE_GAP);
    } else if (lineRoom >= EDGE_BULB_SIZE && rightSpace >= EDGE_BULB_SIZE + LINE_GAP + EDGE_INSET) {
      size = EDGE_BULB_SIZE;
      left = Math.ceil(lineRight + LINE_GAP);
    } else if (lineRoom >= MARGIN_BULB_SIZE && rightSpace >= MARGIN_BULB_SIZE + MARGIN_GAP) {
      // A margin bulb may touch the viewport edge. Retain a 2px gap instead of clamping
      // a larger button back into the text. Ceil keeps that gap with fractional text boxes.
      size = MARGIN_BULB_SIZE;
      left = Math.ceil(lineRight + MARGIN_GAP);
    } else if (lineRoom >= MARGIN_BULB_SIZE && lineLeft >= MARGIN_BULB_SIZE + MARGIN_GAP) {
      // A full final line may leave no right margin. Use the left text margin before giving
      // up; this remains discoverable and cannot cover either edge of that line.
      size = MARGIN_BULB_SIZE;
      left = 0;
    } else {
      // There is no horizontal margin on either side. An overlapping fixed overlay would hide
      // book text (and could hide a word on the line below), so suppress it instead.
      continue;
    }

    // Stay INSIDE the last line's vertical band, not below it: the next paragraph or a
    // neighboring line can begin immediately underneath. A clipped line may have no safe spot.
    const minTop = Math.ceil(Math.max(lineTop, headerHeight + 4));
    const maxTop = Math.floor(Math.min(lineBottom, viewportHeight - 4) - size);
    if (minTop > maxTop || left < 0 || left + size > viewportWidth) continue;
    const top = Math.min(Math.max(Math.round((lineTop + lineBottom - size) / 2), minTop), maxTop);
    spots.push({ index, top, left, size, small: size !== BULB_SIZE });
  }
  return spots;
}
