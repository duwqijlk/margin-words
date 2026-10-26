/**
 * Sentence notes from a word list must reach the reader. The help panel for a sentence
 * existed from the first import but was never rendered, so a published sentence note
 * showed nowhere; the word card now asks for the note of the sentence around the tap.
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

test("the word card renders the sentence help for the tapped sentence", () => {
  const card = readFileSync(new URL("../src/components/word-card.tsx", import.meta.url), "utf8");
  assert.match(card, /import \{ ExplainSentence \} from "@\/components\/help-panels";/);
  assert.match(
    card,
    /<ExplainSentence[\s\S]*?bookId=\{bookId\}[\s\S]*?chapter=\{sentenceChapter\}[\s\S]*?sentence=\{state\.fullSentence \?\? state\.sentence\}/,
  );
});
