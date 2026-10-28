// Where a book opens the first time (src/lib/first-chapter.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstReadingChapter, isFrontMatter } from "../src/lib/first-chapter.ts";

const prose = (n, words = 12) => Array.from({ length: n }, (_, i) => `Line ${i + 1} ${"of the story goes on ".repeat(words / 4)}`.trim());
const dialogue = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? `"Where are you going?" asked Tom.` : `"Home," she said.`));

test("a hand-made book with no front matter opens at its first chapter, however short", () => {
  const book = [
    { title: "Chapter 1", paragraphs: dialogue(14) },
    { title: "Chapter 2", paragraphs: prose(6) },
    { title: "Chapter 3", paragraphs: prose(30) },
    { title: "Chapter 4", paragraphs: prose(40, 20) },
  ];
  assert.equal(firstReadingChapter(book), 0);
});

test("cover, title, copyright, dedication and contents are skipped", () => {
  const book = [
    { title: "Cover", paragraphs: [] },
    { title: "", paragraphs: ["THE LANTERN SELLER", "A Story", "by Ana Writer"] },
    { title: "", paragraphs: ["Copyright © 2020 Ana Writer. All rights reserved.", "ISBN 978-0-00-000000-0", "Published by Example Press, 1 Road, City. ".repeat(4)] },
    { title: "Dedication", paragraphs: ["For my mother, who read to me every night and every morning, whatever the weather, and never once complained about it at all."] },
    { title: "Contents", paragraphs: ["Chapter 1: The Harbor", "Chapter 2: The Keeper", "Chapter 3: The Storm", "Chapter 4: The Light", "Chapter 5: Home"] },
    { title: "Chapter 1: The Harbor", paragraphs: dialogue(16) },
    { title: "Chapter 2: The Keeper", paragraphs: prose(20) },
  ];
  assert.equal(firstReadingChapter(book), 5);
});

test("a contents page is known by the later chapter titles it lists", () => {
  const later = [{ title: "The Harbor" }, { title: "The Keeper" }, { title: "The Storm" }, { title: "The Light" }].map((c) => ({ ...c, paragraphs: prose(5) }));
  const contents = { title: "", paragraphs: ["The Harbor", "The Keeper", "The Storm", "The Light", "Acknowledgments"] };
  assert.equal(isFrontMatter(contents, later), true);
  const poem = { title: "", paragraphs: ["The sea was wide and grey that day,", "the boats lay quiet in the bay,", "the keeper climbed the winding stair,", "and lit the lamp that waited there,", "and all the night it burned for them."] };
  assert.equal(isFrontMatter({ ...poem, paragraphs: [...poem.paragraphs, ...poem.paragraphs] }, later), false, "short lines of story text are not a contents page");
});

test("a book whose first eight chapters all look like front matter keeps the old rule", () => {
  const tiny = Array.from({ length: 9 }, () => ({ title: "", paragraphs: ["Short."] }));
  const book = [...tiny, { title: "One", paragraphs: prose(30, 20) }];
  assert.equal(firstReadingChapter(book), 9);
  assert.equal(firstReadingChapter([]), 0);
});

test("a short page that opens with the book's title is its title page", () => {
  const book = [
    { title: "TREASURE ISLAND. PART ONE", paragraphs: ["TREASURE ISLAND", "To S.L.O., an American gentleman, this narrative is dedicated by his affectionate friend, the author, with the kindest wishes and in return for numerous delightful hours. If sailor tales to sailor tunes, storm and adventure, heat and cold, if schooners, islands, and maroons can please the wiser youngsters of today, so be it.", "PART ONE—The Old Buccaneer"] },
    { title: "I The Old Sea-dog", paragraphs: prose(30, 20) },
  ];
  assert.equal(firstReadingChapter(book, "Treasure Island"), 1);
  assert.equal(firstReadingChapter(book), 0, "without the title the page is kept");
});
