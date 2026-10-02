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
