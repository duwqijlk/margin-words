import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTitle, replacesSameBook } from "../src/lib/book-title.ts";

test("punctuation does not make a different title", () => {
  assert.equal(normalizeTitle("Charlie!"), normalizeTitle("Charlie"));
});

test("an edition label is the same book", () => {
  assert.equal(normalizeTitle("All the Light We Cannot See: A Novel"), normalizeTitle("All the Light We Cannot See"));
  assert.equal(normalizeTitle("Educated: A Memoir"), normalizeTitle("Educated"));
  assert.equal(normalizeTitle("Educated (A Memoir)"), normalizeTitle("Educated"));
  assert.equal(replacesSameBook("All the Light We Cannot See", "All the Light We Cannot See: A Novel"), true);
});

test("a real subtitle is still a different book", () => {
  assert.notEqual(normalizeTitle("The Hunger Games: Catching Fire"), normalizeTitle("The Hunger Games"));
  assert.equal(replacesSameBook("Charlie", "Charlie: Catching Fire"), false);
  assert.equal(replacesSameBook("Charlie", "James"), false);
});

test("a file with no title may update the existing book", () => {
  assert.equal(replacesSameBook("Charlie", ""), true);
  assert.equal(replacesSameBook("Charlie", "   "), true);
});
