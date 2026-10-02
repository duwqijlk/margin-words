import test from "node:test";
import assert from "node:assert/strict";
import { isbnDigits, readSeries } from "../src/lib/book-meta.ts";
import { columnRem, COLUMN_MAX, COLUMN_MIN } from "../src/lib/reader-prefs.ts";
import { loadAppModules } from "./lib/app-modules.mjs";

test("isbnDigits keeps a valid ISBN-13 and converts ISBN-10", () => {
  assert.equal(isbnDigits("978-0-141-96061-6"), "9780141960616");
  assert.equal(isbnDigits("URN:ISBN:9780141960616"), "9780141960616");
  assert.equal(isbnDigits("0-670-82439-9"), "9780670824397");
  assert.equal(isbnDigits("9780141960617"), "");
  assert.equal(isbnDigits("not an isbn"), "");
});

test("a series needs both a name and a number", () => {
  assert.deepEqual(readSeries("Alice", 2), { series: "Alice", seriesNumber: 2 });
  assert.deepEqual(readSeries({ name: "Wings of Fire", number: 1 }), { series: "Wings of Fire", seriesNumber: 1 });
  assert.deepEqual(readSeries("Alice", 0), { series: "", seriesNumber: 0 });
});

test("edition match counts anchor contexts, then other snippets", async () => {
  const { editionMatch, matchPercent } = (await loadAppModules()).edition;
  const anchors = editionMatch(
    { glossary: { cat: { senses: [{ anchors: [{ context: "the cat sat" }, { context: "a missing line" }] }] } } },
    ["The cat sat on the mat."],
  );
  assert.equal(anchors.kind, "anchor");
  assert.equal(anchors.found, 1);
  assert.equal(anchors.total, 2);
  assert.equal(matchPercent(anchors), 50);
  const snippets = editionMatch(
    { paragraphs: [{ context: "the cat sat" }] },
    ["The cat sat on the mat."],
  );
  assert.equal(snippets.kind, "snippet");
  assert.equal(snippets.found, 1);
  const none = editionMatch({ glossary: {} }, ["Hello."]);
  assert.equal(none.kind, "none");
  assert.equal(matchPercent(none), 100);
});

test("a saved width key still picks a column, and the slider stays in range", () => {
  assert.equal(columnRem({ width: "narrow" }), 33);
  assert.equal(columnRem({ width: "wide", column: 90 }), 90);
  assert.equal(columnRem({ column: 1 }), COLUMN_MIN);
  assert.equal(columnRem({ column: 200 }), COLUMN_MAX);
});
