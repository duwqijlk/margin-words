// A phrase's own words get a dotted line. A plain use of the same short word does not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format, help } = await loadAppModules();
const { phraseWordRanges } = help;

const tune = {
  "tune in": { meaning: "To watch or listen from another place.", pos: "idiom" },
};
const split = {
  "let down": { meaning: "To fail someone who trusted you.", pos: "phrasal verb" },
};

const wordsAt = (text, phrases) =>
  phraseWordRanges(phrases, text).map((range) => text.slice(range.start, range.end));

test("tune in marks tuning and in, and a plain in stays plain", () => {
  const joined = "And we've got students tuning in from all across America.";
  assert.deepEqual(wordsAt(joined, tune), ["tuning", "in"]);
  const plain = "I am here with students in Arlington.";
  assert.deepEqual(wordsAt(plain, tune), []);
});

test("a split phrasal verb marks its own words and not the gap", () => {
  const text = "Don't let your family down.";
  assert.deepEqual(wordsAt(text, split), ["let", "down"]);
});

test("the reading page dots the phrase and keeps a hard-word line", () => {
  const html =
    "<p>I am here with students in Arlington. And we've got students tuning in from all across America, from kindergarten through 12th grade. Give yourselves a big round of applause.</p>";
  const phrases = {
    ...tune,
    "round of applause": { meaning: "People clapping their hands.", pos: "phrase" },
  };
  const ready = new Set(["kindergarten", "applause"]);
  const base = format.readingHtml(html, ready, (surface) => surface.toLowerCase(), 1, new Map());
  const marked = format.markWordRanges(
    base,
    (paragraph) => phraseWordRanges(phrases, paragraph),
    "book-phrase",
  );
  const doc = new DOMParser().parseFromString(`<div>${marked}</div>`, "text/html");
  const cls = (word, n = 0) => {
    const all = [...doc.querySelectorAll("button")].filter((button) => button.getAttribute("data-word") === word);
    return all[n]?.className ?? "MISSING";
  };
  assert.equal(cls("in", 0), "");
  assert.equal(cls("tuning"), "book-phrase");
  assert.equal(cls("in", 1), "book-phrase");
  assert.equal(cls("kindergarten"), "book-hard");
  assert.equal(cls("round"), "book-phrase");
  assert.equal(cls("of"), "book-phrase");
  assert.equal(cls("applause"), "book-hard");
});
