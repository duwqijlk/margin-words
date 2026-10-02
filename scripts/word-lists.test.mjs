import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordLists } from "./lib/word-lists.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("word lists ship glossary files only", () => {
  const { catalog, files } = buildWordLists(join(ROOT, "packs"));
  assert.ok(catalog.lists.length >= 16);
  for (const file of files) {
    assert.equal(file.name.endsWith(".epub"), false, file.name);
    assert.equal(file.name.endsWith(".zip"), false, file.name);
    assert.match(file.name, /^word-lists\/(?:catalog\.json|[a-z0-9][a-z0-9_-]*\/glossary\.json)$/);
  }
  const charlie = catalog.lists.find((row) => row.id === "charlie");
  assert.equal(charlie.isbn, "9780141960616");
  assert.equal(charlie.glossary.url, "charlie/glossary.json");
  assert.equal(charlie.cover, undefined);
  assert.equal(charlie.epub, undefined);
  const narnia = catalog.lists.find((row) => row.id === "narnia1-magicians-nephew");
  assert.equal(narnia.series, "The Chronicles of Narnia");
  assert.equal(narnia.seriesNumber, 1);
  assert.equal(narnia.isbn, undefined);
  const twits = catalog.lists.find((row) => row.id === "twits");
  assert.equal(twits.isbn, undefined);
});
