/**
 * A long source sentence must keep the saved word, and a shelf card with no file
 * must offer a download or an EPUB instead of a dead end.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { text, fileOffer } = await loadAppModules();
const { sentenceAround, focusSentence, recoverClippedSentence, sentenceHasWord } = text;
const { planFileOffer } = fileOffer;

const filler = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("a long sentence keeps the word instead of cutting it off the end", () => {
  const before = filler(70);
  const after = filler(10);
  const paragraph = `${before} curiouser ${after}.`;
  assert.ok(before.length > 280, "the word sits past the old 280-character cut");
  const sentence = sentenceAround(paragraph, "curiouser");
  assert.match(sentence, /curiouser/);
  assert.ok(sentence.length < paragraph.length);
  assert.ok(sentence.startsWith("…"));
});

test("a short sentence is left whole", () => {
  assert.equal(sentenceAround("She saw a curiouser sight.", "curiouser"), "She saw a curiouser sight.");
});

test("the notebook view keeps the word when the stored line is long", () => {
  const sentence = `${filler(40)} telescope ${filler(40)}`;
  const shown = focusSentence(sentence, "telescope", 80);
  assert.match(shown, /telescope/);
  assert.ok(shown.length < sentence.length);
});

// Alice, chapter 1: "fond" sits past the old 280-character cut of this sentence.
const FOND =
  "” She generally gave herself very good advice, (though she very seldom followed it), and sometimes she scolded herself so severely as to bring tears into her eyes; and once she remembered trying to box her own ears for having cheated herself in a game of croquet she was playing against herself, for this curious child was very fond of pretending to be two people.";

test("a sentence saved by the old start-cut is rebuilt around the word", () => {
  const stored = `${FOND.slice(0, 280).trimEnd()}…`;
  assert.equal(sentenceHasWord(stored, "fond"), false);
  assert.match(stored, /playing a…$/);
  const next = recoverClippedSentence(stored, "fond", [FOND]);
  assert.ok(next);
  assert.equal(sentenceHasWord(next, "fond"), true);
  assert.match(focusSentence(next, "fond"), /fond of pretending/);
  assert.equal(recoverClippedSentence(next, "fond", [FOND]), null);
});

test("a different paragraph that only shares the word is left alone", () => {
  const stored = `${FOND.slice(0, 280).trimEnd()}…`;
  const decoy = "She was very fond of tea and cake in the afternoon.";
  assert.equal(recoverClippedSentence(stored, "fond", [decoy]), null);
  const next = recoverClippedSentence(stored, "fond", [decoy, FOND]);
  assert.match(next, /pretending to be two people/);
});

test("a word inside a longer word does not count as the saved word", () => {
  assert.equal(sentenceHasWord("She spoke fondly of the game.", "fond"), false);
  assert.equal(sentenceHasWord("was very fond of pretending", "fond"), true);
});

test("a missing file offers a download for a classic and an EPUB for a word list", () => {
  const book = { title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", isbn: "9780141439761" };
  const classics = [{ id: "alice", title: "Alice's Adventures in Wonderland", author: "Carroll, Lewis", isbn: "" }];
  const lists = [{ id: "matilda", title: "Matilda", author: "Roald Dahl", isbn: "9780141322667" }];
  assert.deepEqual(
    planFileOffer({ fileHere: true, needsEpub: false, book, classics, lists }),
    { kind: "ready" },
  );
  assert.deepEqual(
    planFileOffer({ fileHere: false, needsEpub: false, book, classics, lists }),
    { kind: "download", packId: "alice" },
  );
  assert.deepEqual(
    planFileOffer({
      fileHere: false,
      needsEpub: false,
      book: { title: "Matilda", author: "Roald Dahl", isbn: "" },
      classics,
      lists,
    }),
    { kind: "epub", packId: "matilda" },
  );
  assert.deepEqual(
    planFileOffer({
      fileHere: false,
      needsEpub: true,
      book: { title: "My Notes", author: "Me" },
      classics: [],
      lists: [],
      knownPackId: "pack-1",
    }),
    { kind: "epub", packId: "pack-1" },
  );
  assert.equal(
    planFileOffer({
      fileHere: false,
      needsEpub: false,
      book: { title: "Unknown", author: "Nobody" },
      classics: [],
      lists: [],
    }).kind,
    "discover",
  );
  assert.deepEqual(
    planFileOffer({
      fileHere: false,
      needsEpub: false,
      book: { title: "Renamed", author: "Lewis Carroll" },
      classics,
      lists,
      knownPackId: "alice",
    }),
    { kind: "download", packId: "alice" },
  );
  assert.equal(
    planFileOffer({
      fileHere: false,
      needsEpub: false,
      book: { title: "Alice's Adventures in Wonderland", author: "Lewis Carroll" },
      classics: [],
      lists: [],
      knownPackId: "alice",
    }).kind,
    "discover",
  );
});
