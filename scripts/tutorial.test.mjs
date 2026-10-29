// The first-run tutorial (src/lib/tutorial.ts, src/components/tutorial-dialog.tsx): when it shows
// by itself, that the empty shelf stays one line, and that the pictures have a still last frame.
// Also the feedback tip shown once, the first time the reader is open on this device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  feedbackTipSeen,
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
  const named = [...art.matchAll(/className="[^"]*?\b(art-[a-z0-9]+)/g)].map((m) => m[1]);
  assert.ok(named.length > 5, "the pictures use the art-* classes");
  for (const name of named) {
    assert.match(css, new RegExp(`\\.tut-art \\.${name}\\b`), `${name} has a rule`);
  }
  // The brand's own shapes (design system TutorialDialog): no mascot any more.
  assert.doesNotMatch(art, /Owl|owl/);
});

test("both dialogs share one frame whose height and buttons do not move from step to step", () => {
  const frame = read("src/components/step-dialog.tsx");
  // Every step's text sits in the same grid cell; only the current one is visible.
  assert.match(frame, /"step-text col-start-1 row-start-1 grid content-start gap-1",\s*index !== step && "invisible opacity-0"/);
  // One button row on every step: a square Back (kept, invisible, on the first) and one main button.
  assert.match(frame, /grid-cols-\[2\.75rem_1fr\]/);
  assert.match(frame, /step === 0 && "invisible"/);
  for (const file of ["src/components/tutorial-dialog.tsx", "src/components/feedback-tip-dialog.tsx"]) {
    const body = read(file);
    assert.match(body, /<StepDialog/, `${file} uses the shared frame`);
    assert.doesNotMatch(body, /@radix-ui\/react-dialog/, `${file} has no frame of its own`);
  }
});

test("the second tip says a missing word can be reported directly or with the reader's own meaning", () => {
  const en = read("src/lib/i18n-en.ts");
  const line = en.split("\n").find((item) => item.includes('"tip.s2Body"'));
  assert.match(line, /Tell us it's missing/);
  assert.match(line, /add the meaning you understand/);
  assert.match(read("src/components/feedback-tip-dialog.tsx"), /ArtFeedbackMissing[\s\S]{0,200}addMine=/);
});

test("the feedback tip shows until it is closed once, and counts as seen without storage", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(feedbackTipSeen(), false, "a new device");
  useFeedbackTip.getState().show();
  useFeedbackTip.getState().hide();
  assert.equal(store.get("cibian-feedback-tip-v1"), "seen");
  assert.equal(feedbackTipSeen(), true);
  globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(feedbackTipSeen(), true, "no storage: not on every book");
});

test("the feedback tip opens over any book the first time the reader is open, not only a paired one", () => {
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /screen\.kind !== "read" \|\| feedbackTipSeen\(\)/, "keyed on the reader screen, not on how the book came");
  assert.doesNotMatch(app, /queueFeedbackTip/);
  assert.doesNotMatch(read("src/lib/downloads.ts"), /FeedbackTip/);
  assert.match(app, /lazy\(\(\) => import\("@\/components\/feedback-tip-dialog"\)\)/);
  const tip = read("src/components/feedback-tip-dialog.tsx");
  assert.match(tip, /card\.feedbackTooHard/, "uses the card's own button names");
  assert.match(tip, /card\.feedbackMissing/);
});
