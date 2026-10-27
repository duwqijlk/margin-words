/**
 * The decisions behind word-list updates (src/lib/word-list-plan.ts):
 * a newer list waits for the reader to tap Update, a hand-edited list is never
 * replaced, and a changed book file keeps that same button.
 * Also the edition check a new list must pass before it replaces the list on a book
 * the reader supplied the EPUB for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { loadAppModules } from "./lib/app-modules.mjs";

const { wordListPlan } = await loadAppModules();
const {
  planListUpdate,
  checkListAgainstBook,
  wordListUpdateActions,
  holdOffersUpdate,
  holdReasonKey,
  savedListIsCurrent,
} = wordListPlan;

const base = {
  installedRev: "aaa",
  catalogRev: "bbb",
  listSource: undefined,
  installedSha: "",
  catalogSha: "",
};

test("a changed catalog revision waits for the reader to tap Update", () => {
  assert.deepEqual(planListUpdate(base), { kind: "manual", why: "newList" });
});

test("an unchanged or unknown revision does nothing", () => {
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "aaa" }), { kind: "none" });
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "" }), { kind: "none" });
});

test("a stored list with the current revision but a different word count still waits for Update", () => {
  assert.deepEqual(
    planListUpdate({ ...base, catalogRev: "aaa", installedWords: 1325, catalogWords: 2859 }),
    { kind: "manual", why: "newList" },
  );
  assert.deepEqual(
    planListUpdate({ ...base, catalogRev: "aaa", installedWords: 2859, catalogWords: 2859 }),
    { kind: "none" },
  );
  // the e-book is not stored yet, so there is no list on the book to compare
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "aaa", catalogWords: 2859 }), {
    kind: "none",
  });
  // a hand-edited list stays, even when its size is not the catalog size
  assert.deepEqual(
    planListUpdate({
      ...base,
      catalogRev: "aaa",
      listSource: "custom",
      installedWords: 1325,
      catalogWords: 2859,
    }),
    { kind: "none" },
  );
});

test("a list the reader added or edited by hand is never replaced", () => {
  assert.deepEqual(planListUpdate({ ...base, listSource: "custom" }), {
    kind: "manual",
    why: "ownList",
  });
});

test("manual Update keeps a hand-edited list and only moves the saved copy and revision on", () => {
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: true, listSource: "custom" }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
  // a pack list on a stored book is still applied
  assert.equal(
    wordListUpdateActions({ hasStoredBook: true, listSource: "twits" }).applyGlossary,
    true,
  );
  assert.equal(
    wordListUpdateActions({ hasStoredBook: true, listSource: undefined }).applyGlossary,
    true,
  );
  // a card still waiting for the reader's e-book only refreshes the saved copy
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: false, listSource: "custom" }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: false, listSource: undefined }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
});

test("a hand-edited list does not get an Update button, and the card says why", () => {
  assert.equal(holdOffersUpdate("ownList"), false);
  assert.equal(holdOffersUpdate("bookChanged"), true);
  assert.equal(holdOffersUpdate("mismatch"), true);
  assert.equal(holdOffersUpdate("newList"), true);
  assert.equal(holdReasonKey("ownList"), "lists.keptYours");
  assert.equal(holdReasonKey("bookChanged"), "lists.keptBook");
  assert.equal(holdReasonKey("newList"), "lists.newList");
  const en = readFileSync(new URL("../src/lib/i18n-en.ts", import.meta.url), "utf8");
  const zh = readFileSync(new URL("../src/lib/i18n-zh.ts", import.meta.url), "utf8");
  assert.match(en, /"lists\.keptYours": "Your edited list is kept"/);
  assert.match(en, /"lists\.keptBook": "The book file changed\. Tap Update for the new list\."/);
  assert.match(en, /"lists\.newList": "A new word list is ready\. Tap Update\."/);
  assert.match(zh, /"lists\.keptYours": "/);
  assert.match(zh, /"lists\.keptBook": "/);
  assert.match(zh, /"lists\.newList": "/);
});

test("a saved word list is paired only when it is the catalog file", () => {
  assert.equal(savedListIsCurrent("abc", "abc"), true);
  assert.equal(savedListIsCurrent("old", "abc"), false);
  assert.equal(savedListIsCurrent("", "abc"), false);
  assert.equal(savedListIsCurrent("abc", ""), true);
});

test("a classic whose book file changed keeps the manual Update button", () => {
  assert.deepEqual(planListUpdate({ ...base, installedSha: "oldsha", catalogSha: "newsha" }), {
    kind: "manual",
    why: "bookChanged",
  });
  // same book file: only the list changed, so Update is offered and nothing is replaced yet
  assert.deepEqual(planListUpdate({ ...base, installedSha: "sha1", catalogSha: "sha1" }), {
    kind: "manual",
    why: "newList",
  });
});

const listFor = (context) =>
  JSON.stringify({
    version: 2,
    glossary: {
      lantern: {
        pos: "noun",
        meaning: "A small light you can carry.",
        senses: [{ meaning: "A small light.", anchors: [{ chapter: 1, occurrence: 1, context }] }],
      },
    },
  });

test("a new list must still match the reader's own book", () => {
  const book = ["He lifted the paper lantern over the gate and smiled."];
  const good = checkListAgainstBook(listFor("lifted the paper lantern over"), book);
  assert.equal(good.ok, true);
  assert.equal(good.percent, 100);

  const wrong = checkListAgainstBook(listFor("an entirely different story"), book);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.problem, "mismatch");
  assert.equal(wrong.percent, 0);

  const broken = checkListAgainstBook("not json at all", book);
  assert.equal(broken.ok, false);
  assert.equal(broken.problem, "unreadable");
});

test("one bad word does not make a published list unreadable", () => {
  const book = ["He lifted the paper lantern over the gate and smiled."];
  const list = JSON.parse(listFor("lifted the paper lantern over"));
  list.glossary.broken = { meaning: 42 };
  const check = checkListAgainstBook(JSON.stringify(list), book);
  assert.equal(check.ok, true);
  assert.equal(check.percent, 100);
});

test("installed updates target the chosen live book, never the first record for its pack", () => {
  const source = readFileSync(new URL("../src/lib/word-list-update.ts", import.meta.url), "utf8");
  const update = source.slice(source.indexOf("export async function updateInstalledBook("), source.indexOf("let toastId"));
  assert.match(update, /uniqueBookRecord\(records, bookId\)/);
  assert.match(update, /books\.some\(\(book\) => book\.id === bookId\)/);
  assert.match(update, /downloadPack\(classic\.url, classic\.pack, \(\) => undefined, bookId\)/);
  assert.doesNotMatch(update, /records\.find/);
  const retry = source.slice(source.indexOf("export async function retryWordListUpdate("), source.indexOf("type CatalogMaps"));
  assert.match(retry, /targets\.size === 1/);
  assert.match(retry, /live\.has\(item\.bookId\)/);
  assert.match(source, /\[\.\.\.onShelf\]\.map\(\(id\) => uniqueBookRecord\(records, id\)\)/);
});

test("updates with duplicate pack records execute against the explicitly chosen live book", async () => {
  const source = readFileSync(new URL("../src/lib/word-list-update.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const records = [
    { bookId: "orphan", packId: "sample", rev: "old" },
    { bookId: "one", packId: "sample", rev: "old" },
    { bookId: "two", packId: "sample", rev: "old" },
  ];
  const calls = [];
  const create = () => (initialize) => {
    let state;
    const store = { getState: () => state, setState: (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
    state = initialize(store.setState);
    return store;
  };
  const uniqueBookRecord = (rows, bookId) => {
    const matches = rows.filter((row) => row.bookId === bookId);
    return new Set(matches.map((row) => row.packId)).size === 1 ? matches[0] : undefined;
  };
  const stubs = {
    zustand: { create },
    "@/lib/catalog-id": await import("../src/lib/catalog-id.ts"),
    "@/lib/book-db": { listPackRecords: async () => records, loadBookExtras: async () => null },
    "@/lib/catalog-shelf-identity": { uniqueBookRecord },
    "@/lib/vocab-store": { useVocab: { getState: () => ({ books: [{ id: "one" }, { id: "two" }] }) } },
    "@/lib/packs": {
      BUNDLED_CATALOG_URL: "https://example.test/catalog", getCatalogUrl: () => "https://example.test/catalog",
      loadCatalog: async () => ({ catalog: { packs: [{ id: "sample", rev: "new" }] } }),
      downloadPack: async (...args) => { calls.push(args); },
    },
    "@/lib/word-list-catalog": { loadWordListCatalog: async () => [] },
    "@/lib/i18n": { tr: (key) => key, errorText: (reason) => String(reason) },
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (id) => stubs[id] ?? {});
  await module.exports.updateInstalledBook("two");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], "two");
  await assert.rejects(module.exports.updateInstalledBook("orphan"));
  await assert.rejects(module.exports.retryWordListUpdate({ id: "sample" }));
  assert.equal(calls.length, 1, "ambiguous pack-only retry or an orphan cannot update the first live record");
});

test("stored catalog wins a raw-id collision; legacy collision refuses; SHA cycles still hold", async () => {
  const source = readFileSync(new URL("../src/lib/word-list-update.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { bookId: "private", packId: "shared", rev: "g1", sha256: "epub-0" };
  let extras = { source: "shared", catalog: "word-lists", paragraphs: [], sentences: [], phrases: {} };
  let classic = { id: "shared", rev: "g1", epub: { sha256: "epub-1" } };
  let lists = [{ id: "shared", glossary: { url: "list.json", sha256: "" } }];
  const writes = [];
  let applyCount = 0;
  const create = () => (init) => {
    let state;
    const store = { getState: () => state, setState: (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
    state = init(store.setState);
    return store;
  };
  const stubs = {
    zustand: { create },
    "@/lib/catalog-id": await import("../src/lib/catalog-id.ts"),
    "@/lib/catalog-shelf-identity": { uniqueBookRecord: (rows, id) => rows.find((row) => row.bookId === id) },
    "@/lib/book-db": {
      listPackRecords: async () => [record], loadBookExtras: async () => extras,
      loadStoredBook: async () => ({ chapters: [{ paragraphs: ["Original fixture prose."] }] }),
      savePackRecord: async (row) => writes.push(row), loadBookMeta: async () => ({ glossary: {} }),
    },
    "@/lib/packs": {
      BUNDLED_CATALOG_URL: "https://fixture.invalid/catalog", getCatalogUrl: () => "https://fixture.invalid/catalog",
      loadCatalog: async () => ({ catalog: { packs: [classic] } }),
      resolveAgainst: () => "https://fixture.invalid/list.json",
      downloadPack: async () => { throw new Error("wrong public catalog update"); },
    },
    "@/lib/word-list-catalog": { loadWordListCatalog: async () => lists },
    "@/lib/glossary-fetch": { remoteGlossaryId: () => null },
    "@/lib/pack-glossary": { hashBytes: async () => "", applyPackGlossary: async () => { applyCount += 1; } },
    "@/lib/pair-epub": { storeWordListText: async () => {} },
    "@/lib/word-list-plan": { ...wordListPlan, checkListAgainstBook: () => ({ ok: true, percent: 100 }) },
    "@/lib/vocab-store": { useVocab: { getState: () => ({ books: [{ id: "private" }], setBookDetails: () => {} }) } },
    "@/lib/i18n": { tr: (key) => key, errorText: (error) => error.message },
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (id) => stubs[id] ?? {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":2,"glossary":{}}').buffer });
  try {
    await module.exports.updateInstalledBook("private");
    assert.equal(applyCount, 1, "private list applied instead of the colliding public pack");
    assert.equal(writes[0].bookId, "private");
    extras = null;
    await assert.rejects(module.exports.updateInstalledBook("private"), /missingCatalogIdentity/);
    assert.equal(applyCount, 1);
    // An old G1 glossary revision is published again after E0/G1 -> E1/G1 -> E1/G2.
    // The device still has E0/G1. Identical rev alone must not conceal the changed EPUB.
    lists = [];
    extras = { source: "shared", catalog: "public-books" };
    for (const rev of ["g1", "combined-e1-g1", "g2", "g1", ""]) {
      classic = { ...classic, rev };
      await module.exports.autoUpdateWordLists();
      assert.equal(module.exports.useListUpdates.getState().holds["book:private"], "bookChanged", `hold survives catalog rev ${JSON.stringify(rev)}`);
      assert.equal(module.exports.useListUpdates.getState().waiting, 1);
    }
    assert.equal(applyCount, 1, "automatic check never writes a glossary");
  } finally { globalThis.fetch = originalFetch; }
});
