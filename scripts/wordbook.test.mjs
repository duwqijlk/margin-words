// The global wordbook: per-book cards become one list, sources merge by lemma, the schedule is untouched.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReview } from "../src/lib/srs.ts";
import { bookSyncKey } from "../src/lib/sync-merge.ts";
import {
  addSourceTo,
  bookForSource,
  countFromBook,
  hasSourceFrom,
  mergeCards,
  mergeSources,
  migrateWords,
  withoutBook,
  MAX_SOURCES,
} from "../src/lib/wordbook.ts";

const alice = { id: "a1", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll" };
const peter = { id: "p1", title: "Peter Pan", author: "J. M. Barrie" };
const keyA = bookSyncKey(alice);
const keyP = bookSyncKey(peter);

const old = (bookId, lemma, extra = {}) => ({
  id: `${bookId}-${lemma}`,
  bookId,
  surface: lemma,
  lemma,
  pos: "adjective",
  meaning: `meaning of ${lemma}`,
  whyHard: "",
  recommend: true,
  sentence: `A sentence with ${lemma} in ${bookId}.`,
  stage: 0,
  dueAt: 1000,
  createdAt: 1000,
  reps: 0,
  lapses: 0,
  ...extra,
});

const source = (book, sentence, extra = {}) => ({
  book,
  title: book === keyA ? alice.title : peter.title,
  author: "x",
  sentence,
  surface: "faint",
  savedAt: 1,
  ...extra,
});

test("per-book cards become one list: one card per lemma, a source per book", () => {
  const list = migrateWords(
    [old("a1", "faint"), old("p1", "faint"), old("a1", "glimmer")],
    [alice, peter],
  );
  assert.equal(list.length, 2);
  const faint = list.find((word) => word.lemma === "faint");
  assert.deepEqual(faint.sources.map((s) => s.book).sort(), [keyA, keyP].sort());
  assert.equal(faint.sources.find((s) => s.book === keyA).title, alice.title);
  assert.equal(hasSourceFrom(faint, keyP), true);
  assert.equal(countFromBook(list, alice), 2);
  assert.equal(countFromBook(list, peter), 1);
});

test("the card with more review progress keeps its schedule, the other only adds its source", () => {
  const reviewed = applyReview(old("a1", "faint", { stage: 0 }), true, 5000);
  const merged = migrateWords([old("p1", "faint"), reviewed], [alice, peter]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stage, reviewed.stage);
  assert.equal(merged[0].dueAt, reviewed.dueAt);
  assert.equal(merged[0].reps, reviewed.reps);
  assert.equal(merged[0].sources.length, 2);
});

test("migration is safe to run again on its own output", () => {
  const once = migrateWords([old("a1", "faint"), old("p1", "faint")], [alice, peter]);
  const twice = migrateWords(once, [alice, peter]);
  assert.deepEqual(twice, once);
});

test("a card whose book is gone from the shelf keeps a source with an empty title", () => {
  const [word] = migrateWords([old("gone", "faint")], []);
  assert.equal(word.sources.length, 1);
  assert.equal(word.sources[0].title, "");
  assert.equal(word.sources[0].sentence, "A sentence with faint in gone.");
});

test("saving the same lemma again adds a source and never touches the schedule", () => {
  const [card] = migrateWords([old("a1", "faint", { stage: 3, reps: 4 })], [alice]);
  const next = addSourceTo(card, source(keyP, "Faint in Peter Pan."));
  assert.equal(next.stage, 3);
  assert.equal(next.reps, 4);
  assert.equal(next.sources.length, 2);
});

test("a sense stored on only one copy of a save is kept", () => {
  const plain = source(keyA, "The same sentence here.", { at: { chapter: 1, paragraph: 0, quote: "The same sentence here", offset: 0 } });
  const sensed = source(keyA, "The same sentence here.", { meaning: "A small light.", pos: "singular noun" });
  const list = mergeSources([plain], [sensed]);
  assert.equal(list.length, 1);
  assert.equal(list[0].meaning, "A small light.");
  assert.equal(list[0].pos, "singular noun");
  assert.ok(list[0].at);
});

test("the same save twice is one source, and the more detailed copy is kept", () => {
  const plain = source(keyA, "The same sentence here.");
  const placed = { ...plain, chapter: 2, chapterTitle: "Chapter 3", at: { chapter: 2, paragraph: 4, quote: "The same sentence here", offset: 0 } };
  const list = mergeSources([plain], [placed]);
  assert.equal(list.length, 1);
  assert.equal(list[0].chapter, 2);
  assert.ok(list[0].at);
});

test("a word keeps at most MAX_SOURCES places, the newest", () => {
  const many = Array.from({ length: MAX_SOURCES + 5 }, (_, i) => source(keyA, `Sentence number ${i} with a long enough start.`, { savedAt: i + 1 }));
  const list = mergeSources(many, []);
  assert.equal(list.length, MAX_SOURCES);
  assert.equal(list[list.length - 1].savedAt, MAX_SOURCES + 5);
});

test("taking a word out of one book keeps it while another book still has it", () => {
  const [card] = migrateWords([old("a1", "faint"), old("p1", "faint")], [alice, peter]);
  const rest = withoutBook(card, keyA);
  assert.ok(rest);
  assert.deepEqual(rest.sources.map((s) => s.book), [keyP]);
  assert.equal(withoutBook(rest, keyP), null);
});

test("mergeCards unites sources and keeps the earliest save date", () => {
  const a = { ...migrateWords([old("a1", "faint", { createdAt: 500 })], [alice])[0] };
  const b = { ...migrateWords([old("p1", "faint", { createdAt: 900, reps: 2, stage: 2 })], [peter])[0] };
  const merged = mergeCards(a, b);
  assert.equal(merged.createdAt, 500);
  assert.equal(merged.reps, 2);
  assert.equal(merged.sources.length, 2);
});

test("a source finds its shelf book by title and author, not by card id", () => {
  const [card] = migrateWords([old("a1", "faint")], [alice]);
  assert.equal(bookForSource(card.sources[0], [peter, { ...alice, id: "other-device-id" }]).id, "other-device-id");
  assert.equal(bookForSource(card.sources[0], [peter]), undefined);
});
