import test from "node:test";
import assert from "node:assert/strict";
import { groupDigits, libraryTotals } from "../src/lib/library-totals.ts";

test("library totals add classics and word lists", () => {
  const totals = libraryTotals(
    [
      { words: 10, paragraphs: 2, sentences: 1, phrases: 3, series: "Alice" },
      { words: 1.9, paragraphs: 0, series: " Alice " },
      { words: 1 },
    ],
    [
      { words: 5, sentences: 2, phrases: 1, series: "Narnia" },
      { words: -3, paragraphs: 4 },
    ],
  );
  assert.deepEqual(totals, {
    books: 5,
    classics: 3,
    lists: 2,
    words: 17,
    paragraphs: 6,
    sentences: 3,
    phrases: 4,
    series: [
      { name: "Alice", books: 2 },
      { name: "Narnia", books: 1 },
    ],
    standalone: 2,
  });
  assert.equal(groupDigits(12345), "12,345");
  assert.equal(groupDigits(0), "0");
});
