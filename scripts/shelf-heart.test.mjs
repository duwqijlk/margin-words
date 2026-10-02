import assert from "node:assert/strict";
import { test } from "node:test";
import { bookHasUserWork } from "../src/lib/shelf-heart.ts";

const fresh = { chapter: 0, scroll: 0, updatedAt: 0 };

test("a fresh classic can leave without a confirm", () => {
  assert.equal(
    bookHasUserWork({ source: "epub", classic: true, savedWords: 0, progress: null }),
    false,
  );
});

test("reading progress or saved words need a confirm", () => {
  assert.equal(
    bookHasUserWork({
      source: "epub",
      classic: true,
      savedWords: 0,
      progress: { chapter: 2, scroll: 0, updatedAt: 10 },
    }),
    true,
  );
  assert.equal(
    bookHasUserWork({
      source: "epub",
      classic: true,
      savedWords: 0,
      progress: { chapter: 0, scroll: 0.4, updatedAt: 10 },
    }),
    true,
  );
  assert.equal(
    bookHasUserWork({ source: "epub", classic: true, savedWords: 3, progress: fresh }),
    true,
  );
});

test("opening a classic at the first line is not enough to confirm", () => {
  assert.equal(
    bookHasUserWork({
      source: "epub",
      classic: true,
      savedWords: 0,
      progress: { chapter: 0, scroll: 0, updatedAt: 10 },
    }),
    false,
  );
});

test("a word list still waiting for an e-book can leave without a confirm", () => {
  assert.equal(
    bookHasUserWork({ source: "notes", needsEpub: true, classic: false, savedWords: 0, progress: null }),
    false,
  );
});

test("the reader's own e-book always asks first", () => {
  assert.equal(
    bookHasUserWork({ source: "epub", needsEpub: false, classic: false, savedWords: 0, progress: null }),
    true,
  );
  assert.equal(
    bookHasUserWork({ source: "epub", classic: false, savedWords: 0, progress: null }),
    true,
  );
});
