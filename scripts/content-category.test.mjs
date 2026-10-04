// Discover categories: a missing or unknown catalog value stays a novel.
import test from "node:test";
import assert from "node:assert/strict";
import { readContentCategory } from "../src/lib/content-category.ts";

test("a catalog without a category is a novel", () => {
  assert.equal(readContentCategory(undefined), "novel");
  assert.equal(readContentCategory(null), "novel");
  assert.equal(readContentCategory(""), "novel");
  assert.equal(readContentCategory("novel"), "novel");
  assert.equal(readContentCategory("Novel"), "novel");
  assert.equal(readContentCategory("talk"), "novel");
});

test("speech is the only other category", () => {
  assert.equal(readContentCategory("speech"), "speech");
  assert.equal(readContentCategory("ted"), "novel");
});
