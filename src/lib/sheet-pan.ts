/**
 * The pan guard of the phone sheets (word card, paragraph card): src/components/floating-card.tsx.
 */
/** What a pan needs to know about one box between the finger and the sheet. */
export type PanBox = { scrolls: boolean; scrollTop: number; scrollHeight: number; clientHeight: number };

/**
 * True when some box under the finger can still scroll the way the finger moves (`dy` > 0: the
 * finger moves down, the content would scroll back up). When none can, the browser hands the pan
 * to the page behind the sheet - the article moved under a fixed card on iOS Safari and in the
 * WeChat / QQ browsers, which do not fully honour `touch-action: none` - so the sheet cancels it.
 */
export function panConsumed(boxes: readonly PanBox[], dy: number): boolean {
  if (dy === 0) return true;
  return boxes.some((box) => {
    if (!box.scrolls || box.scrollHeight <= box.clientHeight + 1) return false;
    return dy > 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  });
}
