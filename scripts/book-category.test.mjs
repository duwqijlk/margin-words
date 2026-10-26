// The admin upload's ?category= and ?series=: what a row keeps, sets and removes.
import assert from "node:assert/strict";
import test from "node:test";
import { applyCategory, applySeries } from "../functions/lib/book-category.ts";

const params = (query) => new URLSearchParams(query);

test("category: speech sets it, novel removes it, anything else leaves it", () => {
  const row = {};
  applyCategory(row, "speech");
  assert.equal(row.category, "speech");
  applyCategory(row, "novel");
  assert.equal("category" in row, false);
  applyCategory(row, "talk");
  assert.equal("category" in row, false);
  row.category = "speech";
  applyCategory(row, null);
  assert.equal(row.category, "speech");
});

test("series: no ?series= leaves the row alone", () => {
  const row = { series: "Narnia", seriesNumber: 2 };
  applySeries(row, params(""));
  assert.deepEqual(row, { series: "Narnia", seriesNumber: 2 });
});

test("series: a name with an s keeps its s", () => {
  const row = {};
  applySeries(row, params("series=Wings+of+Fire&seriesNumber=3"));
  assert.deepEqual(row, { series: "Wings of Fire", seriesNumber: 3 });
});

test("series: spaces collapse and the name is trimmed", () => {
  const row = {};
  applySeries(row, params("series=+Magic+++Tree+House+&seriesNumber=1"));
  assert.deepEqual(row, { series: "Magic Tree House", seriesNumber: 1 });
});

test("series: an empty name removes the name and the number", () => {
  const row = { series: "Narnia", seriesNumber: 2 };
  applySeries(row, params("series="));
  assert.deepEqual(row, {});
});

test("series: the number is 1-99, and only with a name", () => {
  for (const bad of ["0", "-2", "2.5", "abc", "100"]) {
    const row = {};
    applySeries(row, params(`series=Alice&seriesNumber=${bad}`));
    assert.deepEqual(row, { series: "Alice" }, `seriesNumber=${bad} should be dropped`);
  }
  const row = {};
  applySeries(row, params("series=Alice&seriesNumber=99"));
  assert.deepEqual(row, { series: "Alice", seriesNumber: 99 });
});
