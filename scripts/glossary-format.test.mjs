import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format } = await loadAppModules();
const ok = (value) => format.validateGlossary(value);

test("version 1 lists stay valid", () => {
  const r = ok({ version: 1, glossary: { twit: { pos: "noun", meaning: "A silly person.", whyHard: "x", example: "a", count: 3 } } });
  assert.equal(r.ok, true);
  assert.equal(r.file.glossary.twit.senses, undefined);
});

test("errors name the word", () => {
  const r = ok({ version: 2, glossary: { bank: { pos: "noun" }, "tree house": { meaning: "x" } } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /"bank" has no "meaning"/);
  assert.match(r.errors.join("\n"), /"tree house" is not a plain English word/);
});

test("senses are not allowed in version 1; broken JSON is explained", () => {
  assert.match(ok({ version: 1, glossary: { a: { meaning: "x", senses: [{ meaning: "y" }] } } }).errors[0], /version/);
  assert.match(ok("{ nope").errors[0], /not valid JSON/);
});

const entry = {
  pos: "noun",
  meaning: "main",
  whyHard: "w",
  senses: [
    { meaning: "river side", anchors: [{ chapter: 1, occurrence: 2, context: "sat on the bank of the river" }] },
    { meaning: "money place", default: true, anchors: [{ context: "went to the bank to pay money" }] },
  ],
};
const tap = (over) => ({ chapter: 0, surface: "bank", occurrence: 1, paragraph: "x", ...over });

test("matching order: anchor, context, default, entry", () => {
  assert.equal(format.pickSense("bank", entry, tap({ chapter: 1, occurrence: 2, paragraph: "They sat on the bank of the river." })).via, "anchor");
  const byContext = format.pickSense("bank", entry, tap({ chapter: 5, paragraph: "He went to the Bank to pay money today.", before: "He went to the " }));
  assert.equal(byContext.via, "context");
  assert.equal(byContext.meaning, "money place");
  const def = format.pickSense("bank", entry, tap({ paragraph: "Nothing here." }));
  assert.equal(def.via, "default");
  const noDefault = { ...entry, senses: entry.senses.map((s) => ({ ...s, default: undefined })) };
  assert.equal(format.pickSense("bank", noDefault, tap({ paragraph: "Nothing here." })).via, "entry");
  assert.equal(format.pickSense("bank", { pos: "n", meaning: "m", whyHard: "w" }, tap({})).via, "entry");
});

test("a stale anchor (context missing) is skipped", () => {
  const r = format.pickSense("bank", entry, tap({ chapter: 1, occurrence: 2, paragraph: "A different sentence." }));
  assert.notEqual(r.via, "anchor");
});

test("a snippet around another use in the same paragraph does not win", () => {
  const paragraph = "At the bank to pay money he saw a bank by the river.";
  const second = format.pickSense("bank", entry, tap({ paragraph, before: "At the bank to pay money he saw a ", chapter: 9 }));
  assert.notEqual(second.via, "context");
});

test("extras: paragraphs, sentences, phrases and coined are read", () => {
  const r = ok({
    version: 2,
    glossary: { snozzcumber: { meaning: "A made-up vegetable.", coined: true } },
    paragraphs: [{ chapter: 0, paragraph: 1, context: "one two three four five six", mainIdea: "a", simple: "b", hardWords: ["x"] }],
    sentences: [{ chapter: 0, context: "one two three four five six", simple: "a", grammar: "b" }],
    phrases: { "give up": { meaning: "Stop trying.", pos: "phrasal verb", forms: ["gave up"] } },
  });
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.equal(r.file.glossary.snozzcumber.coined, true);
  assert.equal(r.file.paragraphs.length, 1);
  assert.equal(r.file.phrases["give up"].pos, "phrasal verb");
  assert.deepEqual([r.stats.paragraphs, r.stats.sentences, r.stats.phrases, r.stats.coined], [1, 1, 1, 1]);
});

test("extras: errors are plain English and name the item", () => {
  const r = ok({
    version: 2,
    glossary: { a: { meaning: "x" } },
    paragraphs: [{ chapter: -1, paragraph: 0, context: "a b c d e f", mainIdea: "a" }],
    phrases: { "give": { meaning: "x" }, "look up": { meaning: "y", pos: "verb" } },
  });
  assert.equal(r.ok, false);
  const text = r.errors.join("\n");
  assert.match(text, /Paragraph note 1: "chapter" must be a whole number/);
  assert.match(text, /Paragraph note 1 has no "simple"/);
  assert.match(text, /The phrase "give" must be two or more plain English words/);
  assert.match(text, /The phrase "look up": "pos" must be/);
});

test("extras: check against the real paragraphs of a book", () => {
  const file = {
    version: 2,
    glossary: {},
    paragraphs: [
      { chapter: 0, paragraph: 1, context: "It was a dark night", mainIdea: "a", simple: "b" },
      { chapter: 0, paragraph: 0, context: "It was a dark night", mainIdea: "a", simple: "b" },
      { chapter: 0, paragraph: 5, context: "It was a dark night", mainIdea: "a", simple: "b" },
    ],
    sentences: [{ chapter: 1, context: "It was a dark night", simple: "a", grammar: "b" }],
  };
  const chapters = [{ paragraphs: ["Title", "\u2018It was a dark night,\u2019 said Tom."] }];
  const r = format.checkExtrasAgainstBook(file, chapters, true);
  assert.equal(r.checked, 4);
  assert.equal(r.missing, 3);
  assert.match(r.errors.join("\n"), /is in paragraph 1 of that chapter, not in paragraph 0/);
  assert.match(r.errors.join("\n"), /only 2 paragraphs/);
  assert.match(r.errors.join("\n"), /chapter 1 does not exist/);
});
