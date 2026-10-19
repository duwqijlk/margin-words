import assert from "node:assert/strict";
import { test } from "node:test";
import { correctedTurn } from "../src/lib/page-guard.ts";

const base = { step: 600, line: 36, maxScroll: 10000 };

test("a move of one page or less is left alone", () => {
  assert.equal(correctedTurn({ ...base, start: 1000, end: 1600 }), null);
  assert.equal(correctedTurn({ ...base, start: 1000, end: 1300 }), null);
  assert.equal(correctedTurn({ ...base, start: 1000, end: 1000 }), null);
  // within half a line of one page: rounding, not an overshoot
  assert.equal(correctedTurn({ ...base, start: 1000, end: 1617 }), null);
});

test("a move past one page is put back to exactly one page", () => {
  // the browser's own page (the whole window) on top of nothing
  assert.equal(correctedTurn({ ...base, start: 1000, end: 1844 }), 1600);
  // ours plus the browser's
  assert.equal(correctedTurn({ ...base, start: 1000, end: 2444 }), 1600);
  // backwards
  assert.equal(correctedTurn({ ...base, start: 3000, end: 2000 }), 2400);
});

test("the corrected place stays inside the page", () => {
  assert.equal(correctedTurn({ ...base, start: 400, end: 0 }), null);
  assert.equal(correctedTurn({ ...base, start: 700, end: 0 }), 100);
  assert.equal(correctedTurn({ ...base, start: 9800, end: 10000, maxScroll: 10000 }), null);
  assert.equal(correctedTurn({ ...base, start: 9000, end: 10000, maxScroll: 9300 }), 9300);
});

// Integration contract: the guard must enforce the practical page, not the old half-page.
test("e-ink normal and focus turns retain their full calculated step", async () => {
  const { calculatePageStep } = await import("../src/lib/reader-paging.ts");
  for (const bar of [0, 56]) {
    const step = calculatePageStep({
      viewportWidth: 600,
      viewportHeight: 800,
      topBarHeight: bar,
      lineHeight: 36,
    });
    assert.ok(step >= 576);
    for (const direction of [-1, 1]) {
      const run = { ...base, step, start: 3000, end: 3000 + direction * step };
      assert.equal(correctedTurn(run), null);
      assert.equal(correctedTurn({ ...run, end: run.end + direction * 800 }), run.end);
    }
  }
});
