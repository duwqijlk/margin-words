/**
 * The permanent paragraph lightbulbs (src/lib/paragraph-bulbs.ts): one bulb per
 * paragraph that owns a note, just after that paragraph's last word, on a wide
 * screen and on a phone, and never for a paragraph without a note.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { bulbs } = await loadAppModules();
const { planBulbs, BULB_SIZE, EDGE_BULB_SIZE } = bulbs;

const wide = {
  viewportWidth: 1280,
  viewportHeight: 800,
  headerHeight: 56,
};

const line = (top, right, height = 36) => ({
  top,
  bottom: top + height,
  lineTop: top,
  lineBottom: top + height,
  lineRight: right,
});

test("only a paragraph that owns a note gets a bulb", () => {
  const spots = planBulbs({
    ...wide,
    flags: [false, true, false, true],
    rects: [line(100, 640), line(170, 700), line(270, 500), line(340, 820)],
  });
  assert.deepEqual(spots.map((s) => s.index), [1, 3]);
  assert.equal(spots[0].top, 170 + (36 - BULB_SIZE) / 2, "the bulb sits on the last line");
  assert.equal(spots[0].left, 706);
  assert.equal(spots[1].left, 826, "each bulb follows its own last word");
});

test("the bulb sits after the last word, not in a fixed right column", () => {
  const [spot] = planBulbs({
    ...wide,
    flags: [true],
    rects: [line(200, 640)],
  });
  assert.equal(spot.left, 646);
  assert.equal(spot.small, false);
  assert.ok(spot.left < 1100, "it does not pin to the reading column's right edge");
});

test("on a narrow screen the bulb still follows the last word", () => {
  const [spot] = planBulbs({
    flags: [true],
    rects: [line(200, 220)],
    viewportWidth: 390,
    viewportHeight: 844,
    headerHeight: 56,
  });
  assert.equal(spot.small, false);
  assert.equal(spot.left, 226);
  assert.ok(spot.left < 390 - EDGE_BULB_SIZE - 6);
});

test("a last line that runs to the screen edge uses the smaller bulb and stays on screen", () => {
  const [spot] = planBulbs({
    flags: [true],
    rects: [line(200, 370)],
    viewportWidth: 390,
    viewportHeight: 844,
    headerHeight: 56,
  });
  assert.equal(spot.small, true);
  assert.equal(spot.left, 390 - EDGE_BULB_SIZE - 4);
});

test("a last line that is off screen has no bulb", () => {
  const spots = planBulbs({
    ...wide,
    flags: [true, true, true],
    rects: [
      line(-80, 640), // last line scrolled past
      { top: 80, bottom: 900, lineTop: 860, lineBottom: 896, lineRight: 500 }, // end still below
      line(900, 640), // below the fold
    ],
  });
  assert.deepEqual(spots, []);
});

test("a long paragraph shows its bulb when the last line is on screen", () => {
  const [spot] = planBulbs({
    ...wide,
    flags: [true],
    rects: [{ top: -400, bottom: 640, lineTop: 600, lineBottom: 636, lineRight: 480 }],
  });
  assert.equal(spot.top, 600 + (36 - BULB_SIZE) / 2);
  assert.equal(spot.left, 486);
});

test("a paragraph with no rectangle yet is skipped without error", () => {
  const spots = planBulbs({ ...wide, flags: [true], rects: [null] });
  assert.deepEqual(spots, []);
});
