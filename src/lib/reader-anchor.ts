import { paragraphBlocks } from "./help-lookup.ts";
import { flowPoint, flowText, flowTextBefore } from "./flow-text.ts";
import { makeAnchor, QUOTE_MAX, type TextAnchor } from "./position.ts";

export const PLACE_TOP = 96;

/**
 * `restore.current` holds the place to move to when the next page is on screen: a 0..1 read
 * fraction, or this value for "the very end of the page" (see `placeRestored`). The end of a
 * page is the end of the DOCUMENT, not of the article: the previous/next buttons and the
 * bottom padding sit below the article, so a fraction of the article stops one screenful short.
 */
export const RESTORE_BOTTOM = -1;

/**
 * The first paragraph that reaches below the restore line, as a file-independent place.
 * The same line as the restore, so reopening a book does not step back one paragraph each time.
 */
export function topAnchor(root: HTMLElement | null, chapter: number): TextAnchor | null {
  if (!root) return null;
  const blocks = paragraphBlocks(root);
  const at = blocks.findIndex((block) => block.getBoundingClientRect().bottom > PLACE_TOP + 1);
  const block = at >= 0 ? blocks[at] : undefined;
  if (!block) return null;
  const text = flowText(block);
  if (!text) return null;
  const rect = block.getBoundingClientRect();
  // Text the paragraph rule does not count (plain divs) fills the window: no paragraph marks this place.
  if (rect.top > window.innerHeight) return null;
  // Some books are one huge paragraph per chapter. There the paragraph start alone would reopen at the top.
  if (rect.top < PLACE_TOP && tallBlock(rect)) {
    const inside = flowOffsetAt(block, rect.left + 2, PLACE_TOP + 4);
    if (inside !== null && inside > 0 && inside < text.length) {
      const start = text.lastIndexOf(" ", inside - 1) + 1;
      let end = Math.min(text.length, start + QUOTE_MAX);
      if (end < text.length) {
        const space = text.lastIndexOf(" ", end);
        if (space > start) end = space;
      }
      const quote = text.slice(start, end).trim();
      if (quote.length >= 20) return { chapter, paragraph: at, quote, offset: start };
    }
  }
  return makeAnchor({ chapter, paragraph: at, text, at: 0 });
}

/** A paragraph taller than half the window: a place inside it is kept, not only its start. */
export function tallBlock(rect: DOMRect): boolean {
  return rect.height > window.innerHeight / 2;
}

/** Character of `flowText(block)` under a window point, or null when the point is not on its text. */
export function flowOffsetAt(block: Element, x: number, y: number): number | null {
  try {
    let node: Node | null = null;
    let offset = 0;
    if (typeof document.caretPositionFromPoint === "function") {
      const point = document.caretPositionFromPoint(x, y);
      node = point?.offsetNode ?? null;
      offset = point?.offset ?? 0;
    } else if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      node = range?.startContainer ?? null;
      offset = range?.startOffset ?? 0;
    }
    if (!node || !block.contains(node)) return null;
    return flowTextBefore(block, node, node.nodeType === Node.TEXT_NODE ? offset : 0).length;
  } catch {
    return null;
  }
}

/** Window top of the text line that holds character `at` of `flowText(block)`, or null. */
export function lineTopAt(block: Element, at: number): number | null {
  try {
    const point = flowPoint(block, at);
    if (!point) return null;
    const node = point.node as unknown as Text;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const range = document.createRange();
    const start = Math.min(node.length, Math.max(0, point.offset));
    const end = Math.min(node.length, start + 1);
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = range.getClientRects()[0];
    return rect && rect.height > 0 ? rect.top : null;
  } catch {
    return null;
  }
}
