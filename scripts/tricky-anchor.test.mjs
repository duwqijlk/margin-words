import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format } = await loadAppModules();

/** Render one chapter with a single `tap` entry whose tricky sense has the given anchors. */
function marks(html, anchors, chapter = 0) {
  const gloss = {
    pos: "interjection",
    meaning: "A light knock.",
    whyHard: "Common word.",
    senseOnly: true,
    senses: [{ meaning: "The sound of knocking.", whyHard: "Not the usual meaning!", trickyMeaning: true, anchors }],
  };
  const ready = new Set(["tap"]);
  const out = format.readingHtml(html, ready, (surface) => surface.toLowerCase(), chapter, new Map([["tap", gloss]]), new Map([["tap", gloss]]));
  const doc = new DOMParser().parseFromString(`<div>${out}</div>`, "text/html");
  return [...doc.querySelectorAll("button.book-tricky")].map((b) => Number(b.dataset.n));
}

const html = "<p>Tap tap tap. Then she heard a tap on the glass.</p>";

test("a context-only anchor marks the first use inside the snippet, not every use", () => {
  assert.deepEqual(marks(html, [{ chapter: 0, context: "Tap tap tap." }]), [1]);
  assert.deepEqual(marks(html, [{ context: "Tap tap tap." }]), [1]);
});

test("a context-only anchor does not mark the same word elsewhere in the paragraph", () => {
  assert.deepEqual(marks(html, [{ chapter: 0, context: "heard a tap on the glass" }]), [4]);
});

test("chapter + occurrence marks exactly that token, even when its context holds the word three times", () => {
  assert.deepEqual(marks(html, [{ chapter: 0, occurrence: 1, context: "Tap tap tap." }]), [1]);
  assert.deepEqual(marks(html, [{ chapter: 0, occurrence: 2, context: "Tap tap tap." }]), [2]);
  assert.deepEqual(marks(html, [{ chapter: 0, occurrence: 3, context: "Tap tap tap." }]), [3]);
  assert.deepEqual(marks(html, [{ chapter: 0, occurrence: 4 }]), [4]);
});

test("two anchors mark two tokens and no others", () => {
  const anchors = [
    { chapter: 0, occurrence: 1, context: "Tap tap tap." },
    { chapter: 0, occurrence: 4, context: "heard a tap on the glass" },
  ];
  assert.deepEqual(marks(html, anchors), [1, 4]);
});

test("an anchor of another chapter marks nothing here", () => {
  assert.deepEqual(marks(html, [{ chapter: 3, occurrence: 1 }]), []);
  assert.deepEqual(marks(html, [{ chapter: 3, context: "Tap tap tap." }]), []);
});

test("trickyAt: the first token of the snippet only", () => {
  const gloss = { senses: [{ meaning: "x", trickyMeaning: true, anchors: [{ chapter: 0, context: "Tap tap tap." }] }] };
  const paragraph = "Tap tap tap. Then she heard a tap on the glass.";
  const at = (surface, nth, index) =>
    format.trickyAt("tap", gloss, { chapter: 0, surface, occurrence: nth, paragraph, before: paragraph.slice(0, index) });
  assert.equal(at("Tap", 1, 0), true);
  assert.equal(at("tap", 2, 4), false);
  assert.equal(at("tap", 3, 8), false);
  assert.equal(at("tap", 4, paragraph.indexOf("a tap") + 2), false);
});
