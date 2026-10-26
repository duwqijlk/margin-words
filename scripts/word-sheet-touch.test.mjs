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
