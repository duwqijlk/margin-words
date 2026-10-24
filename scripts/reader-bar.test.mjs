import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_HIDE_TOP, AUTO_HIDE_TRAVEL, barStart, nextBarState } from "../src/lib/reader-bar.ts";

const run = (start, ...ys) => ys.reduce((state, y) => nextBarState(state, y), barStart(start));

test("scrolling down into the book hides the bar; scrolling up shows it", () => {
  assert.equal(run(500, 520, 560).hidden, true, "40px down hides");
  assert.equal(run(500, 520, 560, 540, 520).hidden, false, "40px back up shows");
});

test("small moves are ignored, so the bar does not flicker", () => {
  assert.equal(run(500, 510, 520).hidden, false, "20px down is not enough");
  const down = run(500, 600);
  assert.equal(down.hidden, true);
  assert.equal(nextBarState(down, 590).hidden, true, "a 10px jitter back up keeps it hidden");
  assert.equal(nextBarState(nextBarState(down, 590), 600).hidden, true);
});

test("the travel counts from where the direction changed, not from the start", () => {
  // Down 300, then up only 20: still hidden. Up a full step: shown.
  const down = run(500, 800);
  assert.equal(nextBarState(down, 780).hidden, true);
  assert.equal(run(500, 800, 780, 800 - AUTO_HIDE_TRAVEL).hidden, false);
});

test("near the top of the page the bar always shows", () => {
  assert.equal(run(500, 900, AUTO_HIDE_TOP).hidden, false);
  assert.equal(run(0, AUTO_HIDE_TOP - 1).hidden, false);
  assert.equal(run(0, AUTO_HIDE_TOP + AUTO_HIDE_TRAVEL + 1).hidden, true, "past the top it can hide");
});

test("a big jump hides going down and shows going back (a fling, not a page turn)", () => {
  const forward = run(1000, 1700);
  assert.equal(forward.hidden, true);
  assert.equal(nextBarState(forward, 1000).hidden, false);
});

test("staying in place changes nothing", () => {
  const down = run(500, 600);
  assert.deepEqual(nextBarState(down, 600), { ...down });
});
