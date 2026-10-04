import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBookObjects } from "./build-books.mjs";
import { writePrivateBackup } from "./build-private.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasCopyrightedEpub = existsSync(join(ROOT, "packs/charlie/book.epub"));
const hasPublicEpub = existsSync(join(ROOT, "public-books/alice/book.epub"));
const needsCopyrighted = hasCopyrightedEpub ? false : "copyrighted EPUB is not in git";
const needsBooks = hasCopyrightedEpub && hasPublicEpub ? false : "book EPUB is not in git";

function walk(dir, base = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), `${base}${entry.name}/`) : [`${base}${entry.name}`],
  );
}

test("the private backup has every copyrighted EPUB, glossary, and cover", { skip: needsCopyrighted }, () => {
  const out = mkdtempSync(join(tmpdir(), "mw-private-"));
  const { keys } = writePrivateBackup(join(ROOT, "packs"), out);
  assert.deepEqual(walk(out).sort(), keys);
  assert.ok(keys.includes("charlie/book.epub"));
  assert.ok(keys.includes("charlie/glossary.json"));
  assert.ok(keys.includes("charlie/cover.jpg"));
  assert.ok(keys.includes("narnia/glossary.json"));
  assert.ok(keys.includes("narnia/cover.jpg"));
  assert.equal(keys.includes("narnia/book.epub"), false);
  assert.ok(keys.includes("wonder/book.epub"));
  assert.ok(keys.includes("wonder/cover.jpg"));
  assert.equal(keys.some((name) => name.endsWith(".zip")), false);
  const epub = readFileSync(join(out, "charlie/book.epub"));
  assert.ok(epub.equals(readFileSync(join(ROOT, "packs/charlie/book.epub"))));
  assert.equal(keys.filter((name) => name.endsWith("/book.epub")).length, 9);
});

test("public book objects never contain a copyrighted EPUB", { skip: needsBooks }, () => {
  const books = mkdtempSync(join(tmpdir(), "mw-books-"));
  writeBookObjects(books);
  const secret = readFileSync(join(ROOT, "packs/charlie/book.epub"));
  for (const name of walk(books)) {
    assert.equal(name.startsWith("packs/"), false, name);
    assert.equal(/word-lists\/[^/]+\/book\.epub$/.test(name), false, name);
    const bytes = readFileSync(join(books, name));
    assert.equal(bytes.equals(secret), false, name);
  }
  assert.ok(walk(books).includes("word-lists/charlie/cover.jpg"));
  assert.ok(walk(books).includes("word-lists/narnia/cover.jpg"));
  assert.ok(walk(books).includes("word-lists/wonder/cover.jpg"));
});

test("the app never names the private bucket", () => {
  const files = walk(join(ROOT, "src")).filter((name) => /\.(ts|tsx|js|mjs|css|html)$/.test(name));
  for (const name of files) {
    const text = readFileSync(join(ROOT, "src", name), "utf8");
    assert.equal(text.includes("margin-words-private"), false, name);
    assert.equal(text.includes("dist-private"), false, name);
  }
});
