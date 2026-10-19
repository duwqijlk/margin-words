/**
 * The permanent paragraph lightbulbs (src/lib/paragraph-bulbs.ts): one bulb per
 * paragraph that owns a note, just after that paragraph's last word, on a wide
 * screen and on a phone, and never for a paragraph without a note.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { bulbs } = await loadAppModules();
const { planBulbs, lastLineBox, BULB_SIZE, EDGE_BULB_SIZE, MARGIN_BULB_SIZE } = bulbs;

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
  lineLeft: 20,
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

const phone = { viewportWidth: 390, viewportHeight: 844, headerHeight: 56 };

test("390px viewport / 370px last word keeps a discoverable bulb without covering the last 8px", () => {
  const [spot] = planBulbs({ ...phone, flags: [true], rects: [line(200, 370)] });
  assert.equal(spot.small, true);
  assert.equal(spot.size, MARGIN_BULB_SIZE);
  assert.equal(spot.left, 372);
  assert.equal(spot.left + spot.size, 390);
  assert.ok(spot.top >= 200 && spot.top + spot.size <= 236, "never moves below the last line");
});

test("24px bulb is retained when its whole box and gap fit", () => {
  const [spot] = planBulbs({ ...phone, flags: [true], rects: [line(200, 354)] });
  assert.equal(spot.size, EDGE_BULB_SIZE);
  assert.equal(spot.left, 360);
  assert.ok(spot.left + spot.size <= 386);
});

test("left margin fallback keeps notes discoverable when the right margin is full", () => {
  const [spot] = planBulbs({ ...phone, flags: [true], rects: [line(200, 385)] });
  assert.equal(spot.left, 0);
  assert.equal(spot.size, MARGIN_BULB_SIZE);
  assert.ok(spot.left + spot.size <= 20 - 2);
});

test("no safe margin suppresses the bulb instead of moving it onto this or the next line", () => {
  const spots = planBulbs({
    ...phone,
    flags: [true],
    rects: [{ ...line(200, 385), lineLeft: 5 }],
  });
  assert.deepEqual(spots, []);
});

test("short and viewport-clipped lines use only their visible vertical band", () => {
  for (const rect of [line(200, 370, 18), line(50, 370, 30), line(820, 370, 36)]) {
    const [spot] = planBulbs({ ...phone, flags: [true], rects: [rect] });
    assert.equal(spot.size, MARGIN_BULB_SIZE);
    assert.ok(spot.top >= Math.max(rect.lineTop, phone.headerHeight + 4));
    assert.ok(spot.top + spot.size <= Math.min(rect.lineBottom, phone.viewportHeight - 4));
  }
  assert.deepEqual(planBulbs({ ...phone, flags: [true], rects: [line(833, 370)] }), []);
});

test("fractional coordinates never round a bulb over text or beyond the viewport", () => {
  for (const right of [352.01, 354.99, 369.99, 370.01, 389.9]) {
    const [spot] = planBulbs({ ...phone, flags: [true], rects: [line(200.2, right)] });
    assert.ok(spot.left + spot.size <= 390);
    assert.ok(spot.left >= right + 2 || spot.left + spot.size <= 18);
    assert.ok(spot.top >= 200.2 && spot.top + spot.size <= 236.2);
  }
});

test("a last line that is off screen has no bulb", () => {
  const spots = planBulbs({
    ...wide,
    flags: [true, true, true],
    rects: [
      line(-80, 640), // last line scrolled past
      { top: 80, bottom: 900, lineTop: 860, lineBottom: 896, lineLeft: 20, lineRight: 500 }, // end still below
      line(900, 640), // below the fold
    ],
  });
  assert.deepEqual(spots, []);
});

test("a long paragraph shows its bulb when the last line is on screen", () => {
  const [spot] = planBulbs({
    ...wide,
    flags: [true],
    rects: [{ top: -400, bottom: 640, lineTop: 600, lineBottom: 636, lineLeft: 20, lineRight: 480 }],
  });
  assert.equal(spot.top, 600 + (36 - BULB_SIZE) / 2);
  assert.equal(spot.left, 486);
});

test("a paragraph with no rectangle yet is skipped without error", () => {
  const spots = planBulbs({ ...wide, flags: [true], rects: [null] });
  assert.deepEqual(spots, []);
});

const viewport = { width: 390, height: 844, headerHeight: 56 };
const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
function measuredElement(bounds, fragments) {
  const calls = { bounds: 0, ranges: 0, rects: 0 };
  const element = {
    getBoundingClientRect() { calls.bounds += 1; return bounds; },
    ownerDocument: {
      createRange() {
        calls.ranges += 1;
        return {
          selectNodeContents(el) { assert.equal(el, element); },
          getClientRects() { calls.rects += 1; return fragments; },
        };
      },
    },
  };
  return { element, calls };
}

test("offscreen paragraphs are culled before creating or measuring any Range", () => {
  const bounds = [
    box(20, -100, 370, 55), // behind the sticky header
    box(20, 844, 370, 950), // below the viewport
    box(-370, 100, 0, 200), // horizontally outside the viewport
    box(390, 100, 740, 200),
    box(20, 100, 20, 200), // hidden/empty box
  ];
  for (const bound of bounds) {
    const { element, calls } = measuredElement(bound, []);
    assert.equal(lastLineBox(element, viewport), null);
    assert.deepEqual(calls, { bounds: 1, ranges: 0, rects: 0 });
  }
});

test("a visible long paragraph starting above the viewport is still measured", () => {
  const { element, calls } = measuredElement(box(20, -400, 370, 640), [
    box(20, -390, 370, -354), box(20, 600, 220, 636), box(220, 600, 350, 636),
  ]);
  const measured = lastLineBox(element, viewport);
  assert.deepEqual(calls, { bounds: 1, ranges: 1, rects: 1 });
  assert.deepEqual(measured, {
    top: -400, bottom: 640, lineTop: 600, lineBottom: 636, lineLeft: 20, lineRight: 350,
  });
  assert.equal(planBulbs({ ...phone, flags: [true], rects: [measured] }).length, 1);
});

test("last-line margins include every inline fragment, not only the final word", () => {
  const { element } = measuredElement(box(0, 100, 390, 236), [
    box(0, 100, 390, 136),
    box(5, 200, 385, 236), // earlier fragment reaches both edges
    box(200, 200, 250, 236), // final nested span is narrower
    box(250, 236, 250, 236), // trailing empty box must be ignored
  ]);
  const measured = lastLineBox(element, viewport);
  assert.equal(measured.lineLeft, 5);
  assert.equal(measured.lineRight, 385);
  assert.deepEqual(planBulbs({ ...phone, flags: [true], rects: [measured] }), []);
});

test("a visible paragraph with no text boxes is skipped", () => {
  const { element } = measuredElement(box(20, 100, 370, 200), []);
  assert.equal(lastLineBox(element, viewport), null);
});
