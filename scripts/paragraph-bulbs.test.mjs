/**
 * The permanent paragraph lightbulbs (src/lib/paragraph-bulbs.ts): one bulb per
 * paragraph that owns a note, in the margin when there is room and at the text
 * edge on a narrow screen, and never for a paragraph without a note.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { bulbs } = await loadAppModules();
const { planBulbs, BULB_SIZE, EDGE_BULB_SIZE, MARGIN_ROOM } = bulbs;

const wide = {
  articleRight: 1100,
  viewportWidth: 1280,
  viewportHeight: 800,
  headerHeight: 56,
};

test("only a paragraph that owns a note gets a bulb", () => {
  const spots = planBulbs({
    ...wide,
    flags: [false, true, false, true],
    rects: [
      { top: 100, bottom: 160 },
      { top: 170, bottom: 260 },
      { top: 270, bottom: 330 },
      { top: 340, bottom: 420 },
    ],
  });
  assert.deepEqual(spots.map((s) => s.index), [1, 3]);
  assert.equal(spots[0].top, 170, "the bulb sits at the top of its paragraph");
});

test("with margin room the bulb sits right of the reading column", () => {
  assert.ok(wide.viewportWidth - wide.articleRight >= MARGIN_ROOM);
  const [spot] = planBulbs({
    ...wide,
    flags: [true],
    rects: [{ top: 200, bottom: 300 }],
  });
  assert.equal(spot.left, 1110);
  assert.equal(spot.small, false);
});

test("on a narrow screen the smaller bulb sits at the text edge", () => {
  const [spot] = planBulbs({
    flags: [true],
    rects: [{ top: 200, bottom: 300 }],
    articleRight: 374,
    viewportWidth: 390,
    viewportHeight: 844,
    headerHeight: 56,
  });
  assert.equal(spot.small, true);
  assert.equal(spot.left, 390 - EDGE_BULB_SIZE - 6);
});

test("paragraphs off screen have no bulb; a long one keeps its bulb in view", () => {
  const spots = planBulbs({
    ...wide,
    flags: [true, true, true],
    rects: [
      { top: -500, bottom: -200 }, // scrolled past
      { top: -100, bottom: 700 },  // long paragraph still on screen
      { top: 900, bottom: 1000 },  // below the fold
    ],
  });
  assert.deepEqual(spots.map((s) => s.index), [1]);
  assert.equal(spots[0].top, wide.headerHeight + 6, "nudged below the sticky header");
});

test("a paragraph with no rectangle yet is skipped without error", () => {
  const spots = planBulbs({ ...wide, flags: [true], rects: [null] });
  assert.deepEqual(spots, []);
});

test("a bulb never reaches below its paragraph", () => {
  // a long paragraph almost scrolled past: the bulb stays beside its last visible lines
  const [spot] = planBulbs({
    ...wide,
    flags: [true],
    rects: [{ top: -400, bottom: 85 }],
  });
  assert.equal(spot.top, 85 - BULB_SIZE);
});
