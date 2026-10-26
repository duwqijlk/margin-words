import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publishWithCatalog, withCatalogLock } from "../functions/lib/catalog-lock.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(ROOT, "migrations", "0017_catalog_locks.sql"), "utf8"));
  const wrap = (sql) => {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...values) { args = values; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { stmt.run(...args); return {}; },
    };
    return api;
  };
  return { prepare: wrap, async batch(list) { return Promise.all(list.map((s) => s.run())); }, raw: db };
}

function bucket(failOn = new Set()) {
  const files = new Map();
  return {
    files,
    async get(key) {
      const value = files.get(key);
      if (!value) return null;
      return { body: new Blob([value]).stream(), arrayBuffer: async () => value.slice().buffer, size: value.byteLength };
    },
    async put(key, value) {
      if (failOn.has(key)) throw new Error(`put ${key} failed`);
      files.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value));
      return {};
    },
  };
}

const text = (value) => new TextEncoder().encode(value);
const read = (b, key) => new TextDecoder().decode(b.files.get(key));

test("two publishes at the same moment both keep their catalog row", async () => {
  const db = openDb();
  const b = bucket();
  b.files.set("word-lists/catalog.json", text(JSON.stringify({ lists: [] })));
  // Each one reads the catalog, waits (as a real request does between R2 calls), adds its row, writes.
  const publish = (id) =>
    withCatalogLock(db, "word-lists/catalog.json", async () => {
      const live = JSON.parse(read(b, "word-lists/catalog.json"));
      await new Promise((r) => setTimeout(r, 20));
      live.lists.push({ id });
      await b.put("word-lists/catalog.json", JSON.stringify(live));
    });
  await Promise.all([publish("one"), publish("two"), publish("three")]);
  const ids = JSON.parse(read(b, "word-lists/catalog.json")).lists.map((row) => row.id).sort();
  assert.deepEqual(ids, ["one", "three", "two"], "no row was overwritten");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM catalog_locks").get().n, 0, "the lock is released");
});

test("a lock left by a request that died ends by itself", async () => {
  const db = openDb();
  db.raw.prepare("INSERT INTO catalog_locks (name, owner, expires_at) VALUES ('word-lists/catalog.json', 'gone', ?)").run(Date.now() - 1);
  let ran = false;
  await withCatalogLock(db, "word-lists/catalog.json", async () => { ran = true; });
  assert.equal(ran, true);
});

test("a held lock that does not end refuses with catalog-busy, and the work does not run", async () => {
  const db = openDb();
  db.raw.prepare("INSERT INTO catalog_locks (name, owner, expires_at) VALUES ('word-lists/catalog.json', 'other', ?)").run(Date.now() + 60_000);
  let clock = Date.now();
  // A clock that jumps past the wait, so the test does not sleep 15 seconds.
  const now = () => (clock += 20_000);
  let ran = false;
  await assert.rejects(
    withCatalogLock(db, "word-lists/catalog.json", async () => { ran = true; }, now),
    (error) => error.code === "catalog-busy",
  );
  assert.equal(ran, false);
  assert.equal(db.raw.prepare("SELECT owner FROM catalog_locks").get().owner, "other", "the other writer keeps its lock");
});

test("a failed catalog write puts the old files back, so they match the catalog", async () => {
  const b = bucket(new Set(["word-lists/catalog.json"]));
  b.files.set("word-lists/x/glossary.json", text("OLD"));
  b.files.set("word-lists/catalog.json", text("CATALOG-OLD"));
  await assert.rejects(publishWithCatalog(b, [{ key: "word-lists/x/glossary.json", bytes: text("NEW") }], "word-lists/catalog.json", text("CATALOG-NEW")));
  assert.equal(read(b, "word-lists/x/glossary.json"), "OLD");
  assert.equal(read(b, "word-lists/catalog.json"), "CATALOG-OLD");
});

test("a failed file write also puts back the files written before it", async () => {
  const b = bucket(new Set(["public-books/x/glossary.json"]));
  b.files.set("public-books/x/book.epub", text("OLD-EPUB"));
  await assert.rejects(
    publishWithCatalog(
      b,
      [
        { key: "public-books/x/book.epub", bytes: text("NEW-EPUB") },
        { key: "public-books/x/glossary.json", bytes: text("NEW-LIST") },
      ],
      "public-books/catalog.json",
      text("CATALOG-NEW"),
    ),
  );
  assert.equal(read(b, "public-books/x/book.epub"), "OLD-EPUB");
  assert.equal(b.files.has("public-books/catalog.json"), false, "the catalog was never written");
});
