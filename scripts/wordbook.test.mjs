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
  rehomeForeignSources,
  savedFromCard,
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

const place = (surface, sentence, meaning, pos, chapterTitle) => ({
  book: keyA,
  title: alice.title,
  author: alice.author,
  sentence,
  surface,
  meaning,
  pos,
  chapterTitle,
  savedAt: 1,
});

test("a place from another word moves off the card and onto that word", () => {
  const queer = {
    ...old("a1", "queer", {
      surface: "queer",
      pos: "adjective",
      meaning: "Strange or unusual.",
      sentence: "How queer everything is to-day!",
    }),
    sources: [
      place(
        "fortunately",
        "…with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.",
        "By good luck.",
        "adverb",
        "CHAPTER I. Down the Rabbit-Hole",
      ),
      place("queer", "How queer everything is to-day!", "Strange or unusual.", "adjective", "CHAPTER II. The Pool of Tears"),
    ],
  };
  const [fixed, moved] = rehomeForeignSources([queer]);
  assert.equal(fixed.lemma, "queer");
  assert.equal(fixed.sources.length, 1);
  assert.equal(fixed.sources[0].surface, "queer");
  assert.equal(fixed.meaning, "Strange or unusual.");
  assert.match(fixed.sentence, /How queer/);
  assert.equal(moved.lemma, "fortunately");
  assert.equal(moved.sources.length, 1);
  assert.equal(moved.meaning, "By good luck.");
  assert.match(moved.sentence, /fortunately/);
  const again = rehomeForeignSources([fixed, moved]);
  assert.equal(again.length, 2);
  assert.equal(again[0].sources.length, 1);
  assert.equal(again[1].sources.length, 1);
});

test("an irregular form with the same meaning stays on the card", () => {
  const go = {
    ...old("a1", "go", { surface: "go", pos: "base verb", meaning: "To move.", sentence: "I go home." }),
    sources: [
      place("go", "I go home.", "To move.", "base verb", "Chapter 1"),
      place("went", "She went home.", "To move.", "past-tense verb", "Chapter 2"),
    ],
  };
  const [fixed] = rehomeForeignSources([go]);
  assert.deepEqual(
    fixed.sources.map((source) => source.surface),
    ["go", "went"],
  );
});

test("a phrase card stores the phrase, not the easy word that was tapped", () => {
  const phrase = savedFromCard(
    { surface: "in", key: "in", pos: "", meaning: "This word is very common." },
    {
      key: "tune in",
      matched: "tuning in",
      pos: "idiom",
      meaning: "To watch or listen from another place.",
    },
  );
  assert.deepEqual(phrase, {
    lemma: "tune in",
    surface: "tuning in",
    pos: "idiom",
    meaning: "To watch or listen from another place.",
  });
  const word = savedFromCard(
    { surface: "in", key: "in", pos: "", meaning: "This word is very common." },
    null,
  );
  assert.equal(word.lemma, "in");
  assert.equal(word.surface, "in");
});

test("a saved phrase stays a phrase when the sentence only contains the written form", () => {
  const sentence = "And we've got students tuning in from all across America.";
  const card = {
    ...old("a1", "tune in", {
      surface: "tuning in",
      pos: "idiom",
      meaning: "To watch or listen from another place.",
      sentence,
    }),
    sources: [
      place(
        "tuning in",
        sentence,
        "To watch or listen from another place.",
        "idiom",
        "Chapter 1",
      ),
    ],
  };
  const [kept] = rehomeForeignSources([card]);
  assert.equal(kept.lemma, "tune in");
  assert.equal(kept.surface, "tuning in");
  assert.equal(kept.sources.length, 1);
  assert.equal(kept.sources[0].surface, "tuning in");
});

test("a source finds its shelf book by title and author, not by card id", () => {
  const [card] = migrateWords([old("a1", "faint")], [alice]);
  assert.equal(bookForSource(card.sources[0], [peter, { ...alice, id: "other-device-id" }]).id, "other-device-id");
  assert.equal(bookForSource(card.sources[0], [peter]), undefined);
});
