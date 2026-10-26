/**
 * Sentence notes from a word list must reach the reader. A sentence note lights the bulb of the
 * paragraph that holds its sentence, and the paragraph panel lists it; the word card only shows one
 * small line that opens that panel. The original sentence panel was written with the first import
 * and never rendered, so a published sentence note showed nowhere.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { help } = await loadAppModules();

// The shape of a live note: the book text has soft hyphens, and the note has no grammar line.
const sentence = "Work­ing with the sit­u­a­tion of the ve­hi­cle.";
const note = {
  chapter: 0,
  context: "Working with the situation of the vehicle.",
  simple: "She is dealing with the car's problem.",
};

test("a sentence note is found by its context inside the tapped sentence", () => {
  assert.equal(help.pickSentenceHelp([note], 0, sentence)?.simple, "She is dealing with the car's problem.");
  assert.equal(help.pickSentenceHelp([note], 0, "Reach out and touch someone."), null);
});

test("a note whose chapter is another edition's index still finds its sentence", () => {
  // The context decides; the chapter number only breaks ties between notes that both fit.
  assert.equal(help.pickSentenceHelp([note], 7, sentence)?.simple, "She is dealing with the car's problem.");
});

test("a paragraph lists the sentence notes inside it, in reading order", () => {
  const second = { chapter: 0, context: "Reach out and touch someone.", simple: "Call someone." };
  const paragraph = `(Video) Woman: Reach out and touch someone. ${sentence}`;
  assert.deepEqual(
    help.sentenceNotesIn([note, second], 0, paragraph).map((n) => n.simple),
    ["Call someone.", "She is dealing with the car's problem."],
  );
  assert.deepEqual(help.sentenceNotesIn([note], 0, "A paragraph without it."), []);
  // An ordinary extra page has no fixed chapter: no sentence note there.
  assert.deepEqual(help.sentenceNotesIn([note], -1, paragraph), []);
  // A note for a recovered extra matches only that extra.
  const extra = { ...note, chapter: "x2" };
  assert.equal(help.sentenceNotesIn([extra], "x2", paragraph).length, 1);
  assert.equal(help.sentenceNotesIn([extra], 0, paragraph).length, 0);
});

test("the word card shows a small hint that opens the paragraph panel, not the whole note", () => {
  const card = readFileSync(new URL("../src/components/word-card.tsx", import.meta.url), "utf8");
  assert.match(card, /import \{ SentenceHint \} from "@\/components\/help-panels";/);
  assert.match(
    card,
    /<SentenceHint[\s\S]*?bookId=\{bookId\}[\s\S]*?chapter=\{sentenceChapter\}[\s\S]*?sentence=\{state\.fullSentence \?\? state\.sentence\}[\s\S]*?onOpen=\{onSentenceHelp\}/,
  );
  const reader = readFileSync(new URL("../src/components/reader.tsx", import.meta.url), "utf8");
  assert.match(reader, /openHelp\(picked\.block, card\.fullSentence \|\| card\.sentence\)/, "the tapped sentence starts selected");
  assert.match(reader, /loadParagraphHelpView\(/);
});

test("the panel marks the explained sentences in the page and keeps them in view", () => {
  const panel = readFileSync(new URL("../src/components/help-panels.tsx", import.meta.url), "utf8");
  assert.match(panel, /<SentenceMarks[\s\S]*?paragraphEl=\{paragraphEl\}[\s\S]*?chosen=\{chosen\}/);
  assert.match(panel, /noteSentenceRange\(paragraphEl, context\)/);
  // Drawn into the body: inside the transformed sheet a fixed box is placed against the sheet.
  assert.match(panel, /createPortal\(/);
  assert.match(panel, /setAttribute\("data-help-keep", ""\)/);
  const reader = readFileSync(new URL("../src/components/reader.tsx", import.meta.url), "utf8");
  assert.match(reader, /onRevealSentence=\{revealAboveSheet\}/);
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.book-body \{\s*\/\*[\s\S]*?\*\/\s*position: relative;\s*z-index: 2;/, "the text sits above the marks");
});
