import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostedPublicCatalog, writeBookObjects } from "./build-books.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(ROOT, "public-books/catalog.json"), "utf8"));

function walk(dir, base = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), `${base}${entry.name}/`) : [`${base}${entry.name}`],
  );
}

test("the hosted catalog points at loose files only", () => {
  const hosted = hostedPublicCatalog(source);
  assert.equal(hosted.allPacks, undefined);
  assert.equal(hosted.packs.length, source.packs.length);
  for (const pack of hosted.packs) {
    assert.equal(pack.zip, null, pack.id);
    assert.match(pack.epub.url, /\/book\.epub$/);
    assert.match(pack.glossary.url, /\/glossary\.json$/);
    assert.equal(pack.epub.url.endsWith(".zip"), false);
  }
});

test("dist-books has loose classics and word-list glossaries, and no zips or publisher covers", () => {
  const out = mkdtempSync(join(tmpdir(), "mw-books-"));
  const { keys } = writeBookObjects(out);
  const files = walk(out);
  assert.deepEqual(files.sort(), keys);
  for (const name of files) {
    assert.equal(name.endsWith(".zip"), false, name);
    assert.equal(name.includes(".."), false, name);
  }
  const wordLists = files.filter((name) => name.startsWith("word-lists/"));
  assert.ok(wordLists.includes("word-lists/catalog.json"));
  assert.ok(wordLists.includes("word-lists/narnia/glossary.json"));
  for (const name of wordLists) {
    assert.match(name, /^word-lists\/(?:catalog\.json|[a-z0-9][a-z0-9_-]*\/glossary\.json)$/);
  }
  const hosted = JSON.parse(readFileSync(join(out, "public-books/catalog.json"), "utf8"));
  assert.equal(hosted.allPacks, undefined);
  for (const pack of hosted.packs) {
    assert.equal(pack.zip, null);
    assert.ok(files.includes(`public-books/${pack.epub.url}`), pack.id);
    assert.ok(files.includes(`public-books/${pack.glossary.url}`));
    if (pack.cover) assert.ok(files.includes(`public-books/${pack.cover.url}`));
  }
  const epub = statSync(join(out, "public-books/looking-glass/book.epub")).size;
  assert.ok(epub < 5 * 1024 * 1024, epub);
  assert.equal(files.some((name) => name.startsWith("packs/")), false);
});
