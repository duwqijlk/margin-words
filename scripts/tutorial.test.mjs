// The first-run tutorial (src/lib/tutorial.ts, src/components/tutorial-dialog.tsx): when it shows
// by itself, that the empty shelf stays one line, and that the pictures have a still last frame.
// Also the feedback tip shown once after the first word list is paired with the reader's EPUB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  feedbackTipPending,
  queueFeedbackTip,
  shouldOfferTutorial,
  STARTER_SERIES,
  useDiscoverIntent,
  useFeedbackTip,
  useTutorial,
} from "../src/lib/tutorial.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("it shows by itself once, on an empty shelf, to a reader who is not signed in", () => {
  assert.equal(shouldOfferTutorial("shelf", 0, false, false), true);
  assert.equal(shouldOfferTutorial("shelf", 0, true, false), false, "seen on this device");
  assert.equal(shouldOfferTutorial("shelf", 2, false, false), false, "the shelf has books");
  assert.equal(shouldOfferTutorial("discover", 0, false, false), false, "only over the shelf");
  assert.equal(shouldOfferTutorial("book", 0, false, false), false, "not over a shared book link");
  assert.equal(shouldOfferTutorial("shelf", 0, false, true), false, "a new device of a signed-in reader");
});

test("closing it marks it seen, and the series it recommends is handed to Discover once", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  useTutorial.getState().show();
  assert.equal(useTutorial.getState().open, true);
  useTutorial.getState().hide();
  assert.equal(useTutorial.getState().open, false);
  assert.equal(store.get("cibian-tutorial-v1"), "seen");
  assert.equal(STARTER_SERIES, "Magic Tree House");
  useDiscoverIntent.getState().openSeries(STARTER_SERIES);
  assert.equal(useDiscoverIntent.getState().take(), STARTER_SERIES);
  assert.equal(useDiscoverIntent.getState().take(), "", "taken once");
});

test("the empty shelf stays one line: the tutorial is a dialog, not part of the shelf", () => {
  const shelf = read("src/components/shelf.tsx");
  assert.doesNotMatch(shelf, /tutorial/i);
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /lazy\(\(\) => import\("@\/components\/tutorial-dialog"\)\)/, "loaded only when it opens");
  assert.match(read("src/components/get-books.tsx"), /data-settings-tutorial/, "Settings can show it again");
});

test("every animated picture has a still last frame with reduced motion", () => {
  const css = read("src/styles.css");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tut-art \* \{ animation: none !important; \}/);
  const art = read("src/components/tutorial-art.tsx");
  for (const name of [...art.matchAll(/className="[^"]*\b(tut-[a-z0-9]+)/g)].map((m) => m[1])) {
    if (name === "tut-art") continue;
    assert.match(css, new RegExp(`\\.tut-art \\.${name} \\{`), `${name} has a rule`);
  }
});

test("the feedback tip is queued by a pairing, shown once, and never queued again after it is seen", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(feedbackTipPending(), false, "nothing before a pairing");
  queueFeedbackTip();
  assert.equal(feedbackTipPending(), true);
  useFeedbackTip.getState().show();
  useFeedbackTip.getState().hide();
  assert.equal(store.get("cibian-feedback-tip-v1"), "seen");
  assert.equal(feedbackTipPending(), false);
  queueFeedbackTip();
  assert.equal(feedbackTipPending(), false, "a second pairing does not bring it back");
});

test("the feedback tip is queued when an EPUB is paired, opens over the book, and loads lazily", () => {
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /onSaved=\{[\s\S]{0,400}queueFeedbackTip\(\)/, "queued by the pairing dialog");
  assert.match(app, /screen\.kind !== "read" \|\| !feedbackTipPending\(\)/, "shown when the book is open");
  assert.match(app, /lazy\(\(\) => import\("@\/components\/feedback-tip-dialog"\)\)/);
  const tip = read("src/components/feedback-tip-dialog.tsx");
  assert.match(tip, /card\.feedbackTooHard/, "uses the card's own button names");
  assert.match(tip, /card\.feedbackMissing/);
});
