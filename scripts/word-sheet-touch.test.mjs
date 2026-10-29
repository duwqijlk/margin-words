/**
 * The phone word sheet is pulled down to close. A touch on the sheet must never scroll the
 * article behind it, so the sheet's own chrome declares `touch-action: none` and only the
 * parts that really scroll keep native vertical panning. Without this, the browser scrolls
 * the page under the fixed sheet as soon as the finger moves before the pull is recognised.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 767px)"));

test("a touch on the phone word sheet cannot scroll the article behind it", () => {
  assert.match(phone, /\[data-word-card\] \{\s*touch-action: none;/, "the sheet is the close surface");
});

test("the title, the word body and a suggestion box keep native scrolling", () => {
  assert.match(
    phone,
    /\[data-word-card\] \[data-word-title\],\s*\[data-word-card\] \[data-word-body\],\s*\[data-word-card\] textarea \{\s*touch-action: pan-y;/,
    "the scrollers inside the sheet still pan",
  );
});

test("a swipe that starts on a speaker or another action does not pan the content or the page", () => {
  assert.match(
    phone,
    /\[data-word-card\] button,\s*\[data-word-card\] a,\s*\[data-word-card\] summary \{\s*touch-action: none;/,
    "actions inside the sheet keep their tap and never start a scroll",
  );
});

test("a touch on the selection card or its ask button cannot scroll the article", () => {
  assert.match(css, /\[data-passage-ui\],\s*\[data-passage-card\] \{\s*touch-action: none;/);
  assert.match(css, /\[data-passage-card\] textarea \{\s*touch-action: pan-y;/);
});

// The pan guard (src/lib/sheet-pan.ts, src/components/floating-card.tsx). iOS Safari and the
// WeChat / QQ browsers do not fully honour touch-action, so CSS alone let a swipe on the sheet
// scroll the article. Every move nothing in the sheet can scroll is cancelled in code.
import { panConsumed } from "../src/lib/sheet-pan.ts";

const box = (scrollTop, scrollHeight, clientHeight = 200, scrolls = true) => ({ scrolls, scrollTop, scrollHeight, clientHeight });

test("a swipe nothing in the sheet can scroll is not handed to the page", () => {
  assert.equal(panConsumed([], -20), false, "a plain part of the sheet");
  assert.equal(panConsumed([box(0, 200)], -20), false, "a box that does not overflow");
  assert.equal(panConsumed([box(0, 600, 200, false)], -20), false, "overflow that is not a scroller");
  assert.equal(panConsumed([box(400, 600)], -20), false, "a box already at its end, finger moving up");
  assert.equal(panConsumed([box(0, 600)], 20), false, "a box already at its top, finger moving down");
});

test("a swipe a box inside the sheet can scroll keeps native scrolling", () => {
  assert.equal(panConsumed([box(0, 600)], -20), true, "content below: the finger moves up");
  assert.equal(panConsumed([box(120, 600)], 20), true, "content above: the finger moves down");
  assert.equal(panConsumed([box(0, 200), box(50, 900)], 20), true, "an outer scroller can take it");
  assert.equal(panConsumed([box(0, 200)], 0), true, "no vertical move");
});

test("the sheet wires the guard on a non-passive touchmove and contains overscroll", () => {
  const card = readFileSync(new URL("../src/components/floating-card.tsx", import.meta.url), "utf8");
  assert.match(card, /addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/);
  assert.match(card, /if \(!panConsumed\(panBoxes\(guardFrom, el\), dy\)\) event\.preventDefault\(\);/);
  assert.match(phone, /\[data-word-card\] \{\s*touch-action: none;[^}]*overscroll-behavior: contain;/);
});
