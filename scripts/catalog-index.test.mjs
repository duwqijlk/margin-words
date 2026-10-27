/**
 * Which catalog holds a book id (src/lib/catalog-index.ts). Books installed before the catalog was
 * recorded are named this way, so their reports reach the right book without reinstalling.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogOfId, noteCatalogIds, setCatalogLoadersForTest } from "../src/lib/catalog-index.ts";

function fakeCatalogs({ failWordLists = false } = {}) {
  const calls = { wordLists: 0, publicBooks: 0 };
  setCatalogLoadersForTest({
    wordLists: async () => {
      calls.wordLists += 1;
      if (failWordLists) throw new Error("offline");
      noteCatalogIds("word-lists", ["wonder", "mth01-04"]);
    },
    publicBooks: async () => {
      calls.publicBooks += 1;
      noteCatalogIds("public-books", ["alice", "oz"]);
    },
  });
  return calls;
}

test("an id is found in the catalog that holds it; both catalogs are read once", async () => {
  const calls = fakeCatalogs();
  assert.equal(await catalogOfId("wonder"), "word-lists");
  assert.equal(await catalogOfId("alice"), "public-books");
  assert.equal(await catalogOfId("not-there"), null);
  assert.deepEqual(calls, { wordLists: 1, publicBooks: 1 });
});

test("ids the app's own catalog loads already noted answer without a request", async () => {
  const calls = fakeCatalogs();
  noteCatalogIds("word-lists", ["new-book"]);
  noteCatalogIds("public-books", ["alice"]);
  assert.equal(await catalogOfId("new-book"), "word-lists");
  assert.deepEqual(calls, { wordLists: 0, publicBooks: 0 });
});

test("a catalog that cannot be read: the other still answers, an unknown id is null", async () => {
  fakeCatalogs({ failWordLists: true });
  assert.equal(await catalogOfId("alice"), "public-books");
  assert.equal(await catalogOfId("wonder"), null, "not known to be a word-list book while that catalog is unreadable");
});
