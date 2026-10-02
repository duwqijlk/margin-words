/**
 * Where a desktop word or paragraph card sits. It is an overlay: the reading column does not move.
 * The card stays in the viewport, prefers a spot just under the anchor, and never covers that anchor.
 */

export type AnchorRect = { left: number; top: number; width: number; height: number };

export type PanelPlace = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: "top" | "bottom" | "left" | "right";
};

const GAP = 10;
const PAD = 12;

function covers(panel: { left: number; top: number; width: number; height: number }, anchor: AnchorRect): boolean {
  const right = panel.left + panel.width;
  const bottom = panel.top + panel.height;
  const aRight = anchor.left + anchor.width;
  const aBottom = anchor.top + anchor.height;
  const clear =
    right <= anchor.left + 0.5 ||
    panel.left >= aRight - 0.5 ||
    bottom <= anchor.top + 0.5 ||
    panel.top >= aBottom - 0.5;
  return !clear;
}

/**
 * Pick a top/left for a card of `width` × `height` next to `anchor`.
 * `height` is the card's content height; the card scrolls inside `maxHeight` when it is taller.
 */
export function placeFloatingPanel(input: {
  anchor: AnchorRect;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}): PanelPlace {
  const { anchor, height, viewportWidth: vw, viewportHeight: vh } = input;
  const width = Math.max(160, Math.min(input.width, vw - PAD * 2));
  const aRight = anchor.left + anchor.width;
  const aBottom = anchor.top + anchor.height;
  const spaceBelow = vh - aBottom - GAP - PAD;
  const spaceAbove = anchor.top - GAP - PAD;
  const spaceRight = vw - aRight - GAP - PAD;
  const spaceLeft = anchor.left - GAP - PAD;
  const cap = Math.min(Math.round(vh * 0.72), 640);
  const content = Math.max(1, height);

  const order: Array<PanelPlace["side"]> =
    spaceBelow >= 160 || spaceBelow >= spaceAbove
      ? ["bottom", "top", "right", "left"]
      : ["top", "bottom", "left", "right"];
  if (spaceLeft > spaceRight) {
    const rightAt = order.indexOf("right");
    const leftAt = order.indexOf("left");
    if (rightAt >= 0 && leftAt >= 0 && leftAt > rightAt) {
      order[rightAt] = "left";
      order[leftAt] = "right";
    }
  }

  for (const side of order) {
    const placed = trySide(side);
    if (placed) return placed;
  }
  return trySide(spaceAbove > spaceBelow ? "top" : "bottom") ?? clamped();

  function trySide(side: PanelPlace["side"]): PanelPlace | null {
    if (side === "bottom" || side === "top") {
      const room = side === "bottom" ? spaceBelow : spaceAbove;
      if (room < 72) return null;
      const maxHeight = Math.min(cap, room);
      const used = Math.min(content, maxHeight);
      let top = side === "bottom" ? aBottom + GAP : anchor.top - GAP - used;
      let left = anchor.left;
      if (left + width > vw - PAD) left = vw - PAD - width;
      if (left < PAD) left = PAD;
      if (top < PAD) return null;
      if (top + used > vh - PAD + 0.5) return null;
      const box = { left, top, width, height: used };
      if (covers(box, anchor)) return null;
      return { top, left, width, maxHeight, side };
    }
    const room = side === "right" ? spaceRight : spaceLeft;
    const sideWidth = Math.min(width, room);
    if (sideWidth < 200) return null;
    const maxHeight = Math.min(cap, vh - PAD * 2);
    const used = Math.min(content, maxHeight);
    let left = side === "right" ? aRight + GAP : anchor.left - GAP - sideWidth;
    let top = anchor.top;
    if (top + used > vh - PAD) top = vh - PAD - used;
    if (top < PAD) top = PAD;
    if (left < PAD || left + sideWidth > vw - PAD + 0.5) return null;
    if (top + used > vh - PAD + 0.5) return null;
    const box = { left, top, width: sideWidth, height: used };
    if (covers(box, anchor)) return null;
    return { top, left, width: sideWidth, maxHeight, side };
  }

  function clamped(): PanelPlace {
    const maxHeight = Math.max(72, Math.min(cap, Math.max(spaceBelow, spaceAbove, 72)));
    const used = Math.min(content, maxHeight);
    const side: PanelPlace["side"] = spaceAbove > spaceBelow ? "top" : "bottom";
    let top = side === "top" ? Math.max(PAD, anchor.top - GAP - used) : Math.min(vh - PAD - used, aBottom + GAP);
    let left = anchor.left;
    if (left + width > vw - PAD) left = vw - PAD - width;
    if (left < PAD) left = PAD;
    if (top < PAD) top = PAD;
    return { top, left, width, maxHeight, side };
  }
}

/** The box the card should avoid. A word uses its own box. A paragraph uses a short visible strip. */
export function anchorBox(el: HTMLElement): AnchorRect {
  const full = el.getBoundingClientRect();
  if (el.tagName === "BUTTON") {
    return { left: full.left, top: full.top, width: full.width, height: full.height };
  }
  const top = Math.min(Math.max(full.top, 8), Math.max(full.bottom - 24, 8));
  const height = Math.min(36, Math.max(16, full.bottom - top));
  return { left: full.left, top, width: full.width, height };
}

export function anchorOffscreen(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
}
