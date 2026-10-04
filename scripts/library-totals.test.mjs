import test from "node:test";
import assert from "node:assert/strict";
import { groupDigits, libraryTotals } from "../src/lib/library-totals.ts";

test("library totals add classics and word lists", () => {
  const totals = libraryTotals(
    [
      { words: 10, paragraphs: 2 },
      { words: 1.9, paragraphs: 0 },
    ],
    [{ words: 5 }, { words: -3, paragraphs: 4 }],
  );
  assert.deepEqual(totals, { books: 4, words: 16, paragraphs: 6 });
  assert.equal(groupDigits(12345), "12,345");
  assert.equal(groupDigits(0), "0");
});
