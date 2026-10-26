/**
 * Which sentence of a paragraph a sentence note explains (src/lib/note-sentence.ts). The panel marks
 * that sentence in the page, so the reader can see which one a note is about.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { findNoteSentence, noteSentenceRange } from "../src/lib/note-sentence.ts";

const para =
  "Halfway home, the light fell on a loose stone. Had she not been carrying the lantern, she would have stepped on it. She smiled.";
const span = (text, context) => {
  const hit = findNoteSentence(text, context);
  return hit ? text.slice(hit.start, hit.end) : null;
};

test("the whole sentence that holds the context, with its full stop", () => {
  assert.equal(
    span(para, "Had she not been carrying the lantern, she would have stepped on it"),
    "Had she not been carrying the lantern, she would have stepped on it.",
  );
  assert.equal(span(para, "the light fell on a loose stone"), "Halfway home, the light fell on a loose stone.");
  assert.equal(span(para, "She smiled."), "She smiled.");
});

test("a short context still marks its whole sentence", () => {
  assert.equal(span(para, "carrying the lantern"), "Had she not been carrying the lantern, she would have stepped on it.");
});

test("case, curly quotes and punctuation do not matter; a missing context marks nothing", () => {
  const curly = "“Do they really work?” she asked. He nodded.";
  assert.equal(span(curly, '"do they really work'), "“Do they really work?”");
  assert.equal(span(para, "a sentence that is not there"), null);
  assert.equal(span(para, ""), null);
});

test("a question or an exclamation ends a sentence too", () => {
  const text = "Where is it? There it is! Take it.";
  assert.equal(span(text, "There it is"), "There it is!");
});

test("a title, an initial or a number does not end a sentence", () => {
  assert.equal(span("Then Mr. Brown opened the door. It was late.", "Brown opened the door"), "Then Mr. Brown opened the door.");
  assert.equal(span("It cost 3.50 dollars in all. Done.", "cost 3"), "It cost 3.50 dollars in all.");
  assert.equal(span("A book by J. K. Rowling sat there. Next.", "Rowling sat there"), "A book by J. K. Rowling sat there.");
});

test("the range covers the sentence across soft hyphens and word buttons in the page", () => {
  const dom = new JSDOM(
    '<p>Halfway home. Had she not been <span data-word="carrying">car­ry­ing</span> the lantern, she would have stepped on it. She smiled.</p>',
  );
  const p = dom.window.document.querySelector("p");
  const range = noteSentenceRange(p, "Had she not been carrying the lantern");
  assert.ok(range, "a range is found through the soft hyphens");
  assert.equal(
    range.toString().replace(/­/g, ""),
    "Had she not been carrying the lantern, she would have stepped on it.",
  );
  assert.equal(noteSentenceRange(p, "not in this paragraph"), null);
});
