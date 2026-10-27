import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/discover-shelf.ts", import.meta.url), "utf8");
const titleSource = readFileSync(new URL("../src/lib/book-title.ts", import.meta.url), "utf8");
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
const identitySource = readFileSync(new URL("../src/lib/catalog-shelf-identity.ts", import.meta.url), "utf8");
const identityUrl = dataUrl(compile(identitySource)
  .replace('"@/lib/book-meta"', JSON.stringify(dataUrl(compile(readFileSync(new URL("../src/lib/book-meta.ts", import.meta.url), "utf8")))))
  .replace('"@/lib/book-title"', JSON.stringify(dataUrl(compile(titleSource))))
  .replace('"@/lib/shelf-identity"', JSON.stringify(dataUrl(compile(readFileSync(new URL("../src/lib/shelf-identity.ts", import.meta.url), "utf8"))
    .replace('"@/lib/book-meta"', JSON.stringify(dataUrl(compile(readFileSync(new URL("../src/lib/book-meta.ts", import.meta.url), "utf8")))))))));
const { sameCatalogBook, planSafeShelfMerges, uniqueBookRecord } = await import(identityUrl);
const { discoverShelfBook } = await import(dataUrl(compile(source)
  .replace('"@/lib/catalog-shelf-identity"', JSON.stringify(identityUrl))));

const row = { id: "sample", title: "The Lantern Seller", author: "A. Sample Writer" };
const book = (extra = {}) => ({ ...row, id: "synced-card", source: "epub", ...extra });

test("a synced shelf book remains held with no local install record", () => {
  for (const extra of [{}, { source: "notes", needsEpub: true }]) {
    const mine = book(extra);
    const found = discoverShelfBook([mine], [], row);
    assert.equal(found.book, mine);
    assert.equal(found.record, undefined, "membership must not fabricate an install record");
  }
});

test("direct installs retain their actual record and shelf identity", () => {
  const mine = book({ title: "Old display title" });
  const record = { bookId: mine.id, packId: row.id, rev: "original" };
  assert.deepEqual(discoverShelfBook([mine], [record], row), { book: mine, record });
});

test("legacy installs match by identity without rewriting their pack id", () => {
  const mine = book();
  const record = { bookId: mine.id, packId: "legacy-pack", rev: "original" };
  const found = discoverShelfBook([mine], [record], row);
  assert.equal(found.book, mine);
  assert.equal(found.record, record);
  assert.equal(found.record.packId, "legacy-pack");
});

test("unrelated books and legacy notebooks are not treated as catalog installs", () => {
  for (const mine of [book({ author: "Other Author" }), book({ source: "notes", needsEpub: false })]) {
    assert.equal(discoverShelfBook([mine], [], row).book, undefined);
  }
});

test("multiple matching shelf ids fail closed rather than preferring a stored card", () => {
  const waiting = book({ id: "waiting", needsEpub: true, source: "notes" });
  const ready = book({ id: "ready" });
  const record = { bookId: ready.id, packId: "legacy" };
  assert.equal(discoverShelfBook([waiting, ready], [record], row).book, undefined);
});

test("a removed install record alone is not shelf membership", () => {
  const record = { bookId: "deleted", packId: row.id, rev: "old" };
  assert.deepEqual(discoverShelfBook([], [record], row), { book: undefined, record: undefined });
});

test("recordless recovery preserves real subtitles, valid ISBN conflicts and empty titles", () => {
  const wanted = { ...row, title: "The Lantern Seller: Winter", isbn: "9780306406157" };
  for (const extra of [
    { title: "The Lantern Seller: Summer" },
    { title: wanted.title, isbn: "9780140328721" },
    { title: "", isbn: wanted.isbn },
  ]) assert.equal(discoverShelfBook([book(extra)], [], wanted).book, undefined);
  assert.equal(discoverShelfBook([book({ title: "The Lantern Seller: A Novel" })], [], row).book?.id, "synced-card");
  assert.equal(sameCatalogBook({ ...row, title: "" }, { ...row, title: "" }), false);
});

test("direct records ignore orphans, deduplicate ids and reject competing live targets", () => {
  const mine = book();
  const actual = { bookId: mine.id, packId: row.id, rev: "current" };
  const orphan = { ...actual, bookId: "gone", rev: "old" };
  assert.deepEqual(discoverShelfBook([mine], [orphan, actual, actual], row), { book: mine, record: actual });
  const other = book({ id: "another" });
  assert.equal(discoverShelfBook([mine, other], [actual, { ...actual, bookId: other.id }], row).book, undefined);
  assert.equal(uniqueBookRecord([actual, { ...actual, packId: "different" }], mine.id), undefined);
  assert.equal(discoverShelfBook([mine, mine], [], row).book, mine);
});

const entry = (id, extra = {}) => ({ ...book(), id, stored: false, needsEpub: true,
  work: 1, createdAt: 1, updatedAt: 1, catalogIds: [], ...extra });
test("repair protects unstored cards with distinct subtitles, ISBNs or explicit catalog ids", () => {
  for (const pair of [
    [entry("a", { title: "Series: Volume One" }), entry("b", { title: "Series: Volume Two" })],
    [entry("a", { isbn: "9780306406157" }), entry("b", { isbn: "9780140328721" })],
    [entry("a", { catalogIds: [{ id: "one" }] }), entry("b", { catalogIds: [{ id: "two" }] })],
    [entry("a", { catalogIds: [{ id: "one" }, { id: "two" }] }), entry("b")],
    [entry("a", { catalogIds: [{ id: "one", catalog: "word-lists" }] }), entry("b", { catalogIds: [{ id: "one", catalog: "public-books" }] })],
  ]) assert.deepEqual(planSafeShelfMerges(pair), []);
  assert.equal(planSafeShelfMerges([entry("a"), entry("b", { title: "The Lantern Seller: A Novel" })]).length, 1);
});

test("a metadata-poor card cannot bridge conflicting catalog identities", () => {
  assert.deepEqual(planSafeShelfMerges([
    entry("unknown"), entry("one", { catalogIds: [{ id: "one" }] }),
    entry("two", { catalogIds: [{ id: "two" }] }),
  ]), []);
});

test("explicit catalog identities separate identical raw ids; legacy collisions fail closed", () => {
  const privateBook = book({ id: "private" });
  const publicBook = book({ id: "public" });
  const records = [
    { bookId: "private", packId: row.id, catalog: "word-lists" },
    { bookId: "public", packId: row.id, catalog: "public-books" },
  ];
  const wanted = { ...row, catalog: "word-lists", catalogCollision: true };
  assert.equal(discoverShelfBook([privateBook, publicBook], records, wanted).book, privateBook);
  assert.equal(discoverShelfBook([privateBook], [{ bookId: "private", packId: row.id }], wanted).ambiguous, true);
  assert.equal(discoverShelfBook([publicBook], [records[1]], wanted).book, undefined);
  assert.equal(discoverShelfBook([book({ id: "a" }), book({ id: "b" })], [], row).ambiguous, true);
});
