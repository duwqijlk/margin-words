// New catalog ids come from the title (src/lib/book-id.ts, docs/BOOK_UPLOAD.md "Identity and naming").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { idFromTitle, isNewIdShape, LEGACY_ID, newIdProblem } from "../src/lib/book-id.ts";

test("a new id is the slug of the full title", () => {
  assert.equal(idFromTitle("Magic Tree House 5: Night of the Ninjas"), "magic-tree-house-5-night-of-the-ninjas");
  assert.equal(idFromTitle("Charlie and the Chocolate Factory"), "charlie-and-the-chocolate-factory");
  assert.equal(idFromTitle("Harry Potter and the Philosopher's Stone"), "harry-potter-and-the-philosophers-stone");
  assert.equal(idFromTitle("Les Misérables"), "les-miserables");
  assert.equal(idFromTitle("Pride & Prejudice"), "pride-and-prejudice");
  assert.equal(idFromTitle("  "), "");
  assert.equal(idFromTitle("Custom"), "custom-book", "the reserved id is never produced");
});

test("the series and number go first when the title does not already name the series", () => {
  assert.equal(idFromTitle("Night of the Ninjas", "Magic Tree House", 5), "magic-tree-house-5-night-of-the-ninjas");
  assert.equal(idFromTitle("Magic Tree House 5: Night of the Ninjas", "Magic Tree House", 5), "magic-tree-house-5-night-of-the-ninjas");
  assert.equal(idFromTitle("Night of the Ninjas", "Magic Tree House"), "magic-tree-house-night-of-the-ninjas");
});

test("a long title is cut at a word boundary within 64 characters", () => {
  const id = idFromTitle("The Curious Incident of the Dog in the Night-Time and Other Very Long Stories Told Again");
  assert.ok(id.length <= 64, id);
  assert.ok(isNewIdShape(id), id);
  assert.ok(!id.endsWith("-"), id);
});

test("new ids are slugs; old ids keep any spelling the parser accepts", () => {
  for (const id of ["magic-tree-house-5", "alice", "1984"]) assert.ok(isNewIdShape(id), id);
  for (const id of ["mth_05", "MTH05", "a--b", "-a", "a-", "custom", "a".repeat(65)]) assert.ok(!isNewIdShape(id), id);
  assert.ok(LEGACY_ID.test("mth_05"), "a legacy id still parses");
});

test("an abbreviation is flagged; title and series words are not", () => {
  assert.equal(newIdProblem("magic-tree-house-5-night-of-the-ninjas", "Night of the Ninjas", "Magic Tree House", 5), "");
  assert.equal(newIdProblem("night-of-the-ninjas", "Night of the Ninjas"), "");
  assert.equal(newIdProblem("mth05", "Night of the Ninjas", "Magic Tree House", 5), "title");
  assert.equal(newIdProblem("mth_05", "Night of the Ninjas"), "shape");
});

test("the admin pages and the server use these rules for new ids only", () => {
  const lists = readFileSync(new URL("../src/components/wordlist-admin.tsx", import.meta.url), "utf8");
  assert.match(lists, /idFromTitle\(preview\.title, preview\.series, preview\.seriesNumber\)/);
  assert.match(lists, /const id = pick === "new" \? file\.newId :/);
  assert.match(lists, /if \(pick === "new"\) return newIdIssue\(file\) === "";/);
  const books = readFileSync(new URL("../src/components/books-admin.tsx", import.meta.url), "utf8");
  assert.match(books, /idFromTitle\(glossary\.title, glossary\.series, glossary\.seriesNumber\)/);
  assert.match(books, /id: metadataFor\.id,/);
  const server = readFileSync(new URL("../functions/api/admin/word-lists.ts", import.meta.url), "utf8");
  assert.match(server, /if \(!existing\) \{[\s\S]*?if \(!isNewIdShape\(id\)\) throw new HttpError\(400, "bad-new-id"\);/);
});
