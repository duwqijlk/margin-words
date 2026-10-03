/**
 * Where the permanent paragraph lightbulbs go. Pure geometry (unit tested in
 * scripts/paragraph-bulbs.test.mjs): every paragraph that owns a real paragraph note shows one
 * small bulb next to it, always, with no hover. The bulbs are drawn position: fixed by
 * ParagraphBulbs (help-panels.tsx), so the reading text never moves.
 */

export type RectLike = { top: number; bottom: number };

export type BulbSpot = {
  /** paragraph number in the chapter (the shared numbering rule) */
  index: number;
  /** viewport px */
  top: number;
  left: number;
  /** true on a screen with no margin room: a smaller bulb at the paragraph's edge */
  small: boolean;
};

/** A bulb needs at least this much free space right of the reading column to sit in the margin. */
export const MARGIN_ROOM = 46;
/** Bulb box sizes (px): in the margin, and the smaller edge bulb on phones. */
export const BULB_SIZE = 28;
export const EDGE_BULB_SIZE = 24;

/**
 * One spot per paragraph that owns a note AND is on screen. The bulb sits at the top of its
 * paragraph; a long paragraph that is partly scrolled away keeps its bulb just inside the
 * viewport, next to the visible text. Paragraphs without a note get nothing.
 */
export function planBulbs(input: {
  /** per paragraph: does it own a paragraph note? */
  flags: readonly boolean[];
  /** per paragraph: its viewport rectangle (null when unknown) */
  rects: readonly (RectLike | null)[];
  /** right edge of the reading column, viewport px */
  articleRight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** height of the sticky reader header (0 in focus mode) */
  headerHeight: number;
}): BulbSpot[] {
  const { flags, rects, articleRight, viewportWidth, viewportHeight, headerHeight } = input;
  const room = viewportWidth - articleRight >= MARGIN_ROOM;
  const size = room ? BULB_SIZE : EDGE_BULB_SIZE;
  const left = room
    ? Math.round(articleRight + 10)
    : Math.round(viewportWidth - EDGE_BULB_SIZE - 6);
  const spots: BulbSpot[] = [];
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] !== true) continue;
    const rect = rects[index];
    if (!rect) continue;
    // Off screen (allow a small spill so a bulb does not pop at the very edge).
    if (rect.bottom < headerHeight + 8 || rect.top > viewportHeight - 8) continue;
    // Anchored to the paragraph top, nudged into view beside a long paragraph.
    const top = Math.min(
      Math.max(rect.top, headerHeight + 6),
      viewportHeight - size - 6,
      rect.bottom - size,
    );
    if (top < Math.max(rect.top - 2, headerHeight)) continue; // nothing of it is really visible
    spots.push({ index, top: Math.round(top), left, small: !room });
  }
  return spots;
}
