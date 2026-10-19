import assert from "node:assert/strict";
import test from "node:test";
import { placeFloatingPanel } from "../src/lib/floating-panel.ts";

const view = { viewportWidth: 1280, viewportHeight: 800 };
const card = { width: 336, height: 420 };

function overlaps(place, anchor, height) {
  const used = Math.min(height, place.maxHeight);
  const right = place.left + place.width;
  const bottom = place.top + used;
  const aRight = anchor.left + anchor.width;
  const aBottom = anchor.top + anchor.height;
  return !(right <= anchor.left || place.left >= aRight || bottom <= anchor.top || place.top >= aBottom);
}

function inside(place, height) {
  const used = Math.min(height, place.maxHeight);
  return (
    place.left >= 12 - 0.5 &&
    place.top >= 12 - 0.5 &&
    place.left + place.width <= view.viewportWidth - 12 + 0.5 &&
    place.top + used <= view.viewportHeight - 12 + 0.5
  );
}

test("a word in the middle opens the card just below it", () => {
  const anchor = { left: 480, top: 280, width: 48, height: 28 };
  const place = placeFloatingPanel({ anchor, ...card, ...view });
  assert.equal(place.side, "bottom");
  assert.ok(place.top >= anchor.top + anchor.height);
  assert.equal(overlaps(place, anchor, card.height), false);
  assert.equal(inside(place, card.height), true);
});

test("a word near the bottom opens the card above it", () => {
  const anchor = { left: 500, top: 740, width: 40, height: 24 };
  const place = placeFloatingPanel({ anchor, ...card, ...view });
  assert.equal(place.side, "top");
  assert.ok(place.top + Math.min(card.height, place.maxHeight) <= anchor.top);
  assert.equal(overlaps(place, anchor, card.height), false);
  assert.equal(inside(place, card.height), true);
});

test("a word at the right edge shifts the card left, still clear of the word", () => {
  const anchor = { left: 1180, top: 300, width: 60, height: 24 };
  const place = placeFloatingPanel({ anchor, ...card, ...view });
  assert.equal(overlaps(place, anchor, card.height), false);
  assert.equal(inside(place, card.height), true);
  assert.ok(place.left + place.width <= view.viewportWidth - 12 + 0.5);
});

test("a word in the lower right corner uses a side that stays on screen", () => {
  const anchor = { left: 1100, top: 720, width: 70, height: 28 };
  const place = placeFloatingPanel({ anchor, ...card, ...view });
  assert.equal(overlaps(place, anchor, card.height), false);
  assert.equal(inside(place, card.height), true);
});

test("a short card sits against the word instead of stretching", () => {
  const anchor = { left: 400, top: 500, width: 36, height: 22 };
  const place = placeFloatingPanel({ anchor, width: 336, height: 180, ...view });
  assert.equal(place.side, "bottom");
  assert.ok(Math.abs(place.top - (anchor.top + anchor.height + 10)) < 1);
});

test("a tall card opens above a low word instead of shrinking into the gap", () => {
  const anchor = { left: 480, top: 560, width: 48, height: 28 };
  const place = placeFloatingPanel({ anchor, width: 336, height: 420, ...view });
  assert.equal(place.side, "top");
  assert.ok(place.maxHeight >= 420);
  assert.ok(place.top + Math.min(420, place.maxHeight) <= anchor.top);
  assert.equal(overlaps(place, anchor, 420), false);
  assert.equal(inside(place, 420), true);
});

test("a card that fits under the word stays there even when the space above is taller", () => {
  const anchor = { left: 400, top: 260, width: 40, height: 24 };
  const place = placeFloatingPanel({ anchor, width: 336, height: 280, ...view });
  assert.equal(place.side, "bottom");
  assert.ok(place.maxHeight >= 280);
});

for (const [viewportWidth, viewportHeight] of [[1024, 768], [1280, 800], [1280, 600]]) {
  test(`a wider word card stays clear of anchors at ${viewportWidth}x${viewportHeight}`, () => {
    for (const anchor of [
      { left: 400, top: 120, width: 48, height: 28 },
      { left: 12, top: 240, width: 48, height: 28 },
      { left: viewportWidth - 72, top: 300, width: 48, height: 28 },
      { left: viewportWidth - 72, top: viewportHeight - 60, width: 48, height: 28 },
      // A tall anchor requires side placement rather than a top/bottom gap.
      { left: 420, top: 12, width: 48, height: viewportHeight - 24 },
    ]) {
      const height = 620;
      const place = placeFloatingPanel({ anchor, width: 384, height, viewportWidth, viewportHeight });
      assert.ok(place.width >= 200 && place.width <= 384);
      assert.ok(place.left >= 12 && place.top >= 12);
      assert.ok(place.left + place.width <= viewportWidth - 12 + 0.5);
      assert.ok(place.top + Math.min(height, place.maxHeight) <= viewportHeight - 12 + 0.5);
      assert.equal(overlaps(place, anchor, height), false);
    }
  });
}

test("when neither side can show the whole card, the clearly taller side is used", () => {
  const anchor = { left: 480, top: 430, width: 40, height: 24 };
  const place = placeFloatingPanel({ anchor, width: 336, height: 640, ...view });
  assert.equal(place.side, "top");
  assert.ok(place.maxHeight >= 400);
  assert.equal(overlaps(place, anchor, 640), false);
  assert.equal(inside(place, 640), true);
});
