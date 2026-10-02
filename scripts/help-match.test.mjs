import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { help } = await loadAppModules();
const { containsContext, looseText, mergeExtras, pickParagraphHelp, pickPhrase, pickSentenceHelp, verbForms } = help;

const para = (chapter, paragraph, context) => ({
  chapter,
  paragraph,
  context,
  mainIdea: "x",
  simple: "y",
});

test("looseText ignores quotes, dashes, case and punctuation", () => {
  assert.equal(looseText("\u201cDon\u2019t  go,\u201d he said \u2014 quickly."), "don't go he said quickly");
  assert.equal(containsContext("He said, \u2018Hello there, my friend.\u2019", "hello there my friend"), true);
  assert.equal(containsContext("He said hello", ""), false);
});

test("context must match whole words", () => {
  assert.equal(containsContext("the cathedral was big", "the cat"), false);
});

test("paragraph help: exact index and context", () => {
  const list = [para(1, 4, "the old man walked slowly home")];
  const text = "Then the old man walked slowly home, tired.";
  assert.equal(pickParagraphHelp(list, 1, 4, text)?.paragraph, 4);
});

test("paragraph help: same index but other text is NOT shown", () => {
  const list = [para(1, 4, "the old man walked slowly home")];
  assert.equal(pickParagraphHelp(list, 1, 4, "A completely different paragraph about cats."), null);
});

test("paragraph help: falls back to context when the index has moved", () => {
  const list = [para(1, 4, "the old man walked slowly home"), para(1, 9, "she opened the red door at last")];
  const text = "Then the old man walked slowly home.";
  assert.equal(pickParagraphHelp(list, 1, 7, text)?.paragraph, 4);
  assert.equal(pickParagraphHelp(list, 5, 0, text)?.paragraph, 4); // another chapter number: context still works
});

test("paragraph help: curly quotes in the book, plain quotes in the list", () => {
  const list = [para(0, 0, "\"I don't know,\" said Tom")];
  assert.ok(pickParagraphHelp(list, 0, 0, "\u201cI don\u2019t know,\u201d said Tom, and looked away."));
});

test("sentence help: matches by context inside the sentence, same chapter first", () => {
  const list = [
    { chapter: 2, context: "if only he had known", simple: "a", grammar: "g" },
    { chapter: 3, context: "if only he had known", simple: "b", grammar: "g" },
  ];
  assert.equal(pickSentenceHelp(list, 3, "Oh, if only he had known the truth!")?.simple, "b");
  assert.equal(pickSentenceHelp(list, 9, "if only he had known")?.simple, "a");
  assert.equal(pickSentenceHelp(list, 3, "if only she had known"), null);
});

test("verbForms", () => {
  assert.ok(verbForms("give").includes("gave") && verbForms("give").includes("giving") && verbForms("give").includes("gives"));
  assert.ok(verbForms("look").includes("looked") && verbForms("look").includes("looking"));
  assert.ok(verbForms("stop").includes("stopped") && verbForms("stop").includes("stopping"));
  assert.ok(verbForms("carry").includes("carried") && verbForms("carry").includes("carries"));
  assert.ok(verbForms("make").includes("making") && verbForms("make").includes("made"));
  assert.ok(verbForms("go").includes("went") && verbForms("go").includes("goes"));
  assert.ok(verbForms("pass").includes("passes"));
});

const phrases = {
  "give up": { meaning: "Stop trying.", pos: "phrasal verb" },
  "look after": { meaning: "Take care of.", pos: "phrasal verb", forms: ["looked after", "looking after"] },
  "pick up": { meaning: "Lift.", pos: "phrasal verb" },
  "break the ice": { meaning: "Start a talk.", pos: "idiom" },
  "in front of": { meaning: "Before.", pos: "phrase" },
  "take care of": { meaning: "Look after.", pos: "phrase" },
  "make up one's mind": { meaning: "Decide.", pos: "idiom" },
};
const hit = (sentence, word) => pickPhrase(phrases, sentence, word);

test("phrase: simple inflections", () => {
  assert.equal(hit("He gave up at last.", "gave")?.key, "give up");
  assert.equal(hit("He gave up at last.", "up")?.key, "give up");
  assert.equal(hit("She is giving up now.", "giving")?.key, "give up");
  assert.equal(hit("She gives up easily.", "gives")?.key, "give up");
});

test("phrase: listed forms", () => {
  assert.equal(hit("They looked after the baby.", "after")?.key, "look after");
  assert.equal(hit("They are looking after us.", "looking")?.key, "look after");
});

test("phrase: separable with a gap of up to 3 words", () => {
  const r = hit("She picked the big box up quickly.", "picked");
  assert.equal(r?.key, "pick up");
  assert.equal(r?.matched, "picked the big box up");
  assert.equal(hit("He picked it up.", "up")?.key, "pick up");
  // a gap of 4 words is too far
  assert.equal(hit("She picked the very big red box up.", "picked"), null);
});

test("phrase: no false positives", () => {
  assert.equal(hit("He looked up at the sky.", "up"), null); // "look up" is not listed
  assert.equal(hit("She picked a flower. Then she ran up the hill.", "up"), null); // sentence break
  assert.equal(hit("She picked flowers, and he sat up.", "up"), null); // comma / clause break
  assert.equal(hit("They gave a present to the man who held it up.", "up"), null);
  assert.equal(hit("The cup gave nothing.", "gave"), null);
});

test("phrase: the tapped word must be part of the phrase, not a word in the gap", () => {
  assert.equal(hit("She picked the box up.", "box"), null);
  assert.equal(hit("She picked the box up.", "the"), null);
});

test("phrase: idioms and fixed phrases", () => {
  assert.equal(hit("He told a joke to break the ice.", "ice")?.key, "break the ice");
  assert.equal(hit("It broke the ice at once.", "broke")?.key, "break the ice");
  assert.equal(hit("She stood in front of the door.", "front")?.key, "in front of");
  assert.equal(hit("He took care of the dog.", "care")?.key, "take care of");
  assert.equal(hit("She is taking care of him.", "taking")?.key, "take care of");
  assert.equal(hit("In the front room of the house.", "front"), null);
});

test("phrase: one's", () => {
  assert.equal(hit("He made up his mind.", "mind")?.key, "make up one's mind");
  assert.equal(hit("They make up their minds", "minds"), null);
  assert.equal(hit("He made up the story.", "made"), null);
});

test("phrase: curly apostrophe words are handled", () => {
  assert.equal(hit("\u201cI won\u2019t give up,\u201d she said.", "give")?.key, "give up");
});

test("mergeExtras: replace and add", () => {
  const a = { paragraphs: [para(0, 0, "aaa bbb ccc ddd")], sentences: [], phrases: { "give up": { meaning: "old" } } };
  const b = {
    paragraphs: [{ ...para(0, 0, "new new new new"), simple: "NEW" }],
    sentences: [],
    phrases: { "give up": { meaning: "new" } },
  };
  assert.equal(mergeExtras(a, b, "replace").paragraphs[0]?.simple, "NEW");
  assert.equal(mergeExtras(a, b, "replace").phrases["give up"]?.meaning, "new");
  assert.equal(mergeExtras(a, b, "add").paragraphs[0]?.simple, "y");
  assert.equal(mergeExtras(a, b, "add").phrases["give up"]?.meaning, "old");
  assert.equal(mergeExtras(null, b, "add"), b);
});
