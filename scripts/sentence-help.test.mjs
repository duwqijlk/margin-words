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

test("paragraph and sentence explanations credit a reader under the text, and show one kind at a time", () => {
  const panel = readFileSync(new URL("../src/components/help-panels.tsx", import.meta.url), "utf8");
  // The source line follows the explanation it credits.
  assert.match(panel, /data-part="paragraph-help"[\s\S]*?data-part="main-idea"[\s\S]*?<HelpSource credit=\{paragraph\.credit\} \/>/);
  assert.match(panel, /data-part="sentences"[\s\S]*?<SentenceNote/);
  const source = panel.slice(panel.indexOf("function HelpSource"), panel.indexOf("function SentenceNote"));
  assert.match(source, /if \(!credit\) return null;/, "an explanation from the word list carries no label");
  assert.match(source, /data-help-source="reader"/);
  assert.match(source, /<CreditLine id=\{credit\} \/>/);
  assert.doesNotMatch(source, /useContributor|person\.|XCrun/, "source kind must not depend on loaded public profiles or a nickname");
  const sentence = panel.slice(panel.indexOf("function SentenceNote"), panel.indexOf("type MarkBox"));
  assert.match(sentence, /<button[\s\S]*?aria-pressed=\{chosen\}[\s\S]*?data-part="sentence-context"[\s\S]*?data-part="easier"[\s\S]*?<HelpSource credit=\{note\.credit\} \/>/);
  // One kind of help at a time, by where the reader came from: never a paragraph note and the
  // sentence notes inside it together (they often say the same thing twice).
  assert.doesNotMatch(panel, /role="tablist"/);
  assert.match(panel, /asked\.length > 0 \? "sentence" : paragraph \? "paragraph" : "sentences"/);
  assert.match(panel, /const showParagraph = mode === "paragraph";/);
  assert.match(panel, /data-part="help-footer"/);
});

test("the help mark is an empty span after the last word, drawn by CSS, with no scroll measuring", () => {
  const panel = readFileSync(new URL("../src/components/help-panels.tsx", import.meta.url), "utf8");
  const marks = panel.slice(panel.indexOf("export function ParagraphMarks"), panel.indexOf("export type ParagraphPanelState"));
  assert.match(marks, /createElement\("span"\)/);
  assert.doesNotMatch(marks, /textContent|createTextNode|innerText|innerHTML/, "the mark must stay empty: its text would join the paragraph's");
  assert.doesNotMatch(marks, /addEventListener\("scroll"|ResizeObserver|requestAnimationFrame|getBoundingClientRect/, "nothing is measured");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.book-body \[data-para-marker\]::before \{\s*content: "\\2726";/);
});
