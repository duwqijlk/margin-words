import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const compile = (name) => ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mutationUrl = url(compile("book-mutation"));
const mutation = await import(mutationUrl);
const cancelUrl = url(compile("cancel-work"));
let state = { books: [] };
let records = [];
let writes = [];
let stored = new Map();
let gate;
let extras = new Map();
let recordGate;
const mocks = {
  "list-updated": "export const readUpdated = () => '';",
  "book-db": `const m = globalThis.__pairTarget; export const requestPersistentStorage = async () => false;
    export const listPackRecords = async () => { await m.recordGate(); return m.records(); };
    export const listBookSummaries = async () => [];
    export const loadBookExtras = async (id) => m.extras().get(id) ?? null;
    export const loadBookMeta = async (id) => m.stored().get(id);
    export const loadCover = async () => '';
    export const loadPackRecord = async (id) => m.records().find(r => r.bookId === id) ?? null;
    export const loadStoredBook = async (id) => m.stored().get(id) ?? null;
    export const saveStoredBook = async (book) => { m.writes().push(book.id); m.stored().set(book.id, book); await m.gate(); };
    export const saveCover = async () => {};
    export const savePackRecord = async (record) => { m.records().push(record); };
    export const deleteStoredBook = async (id) => { m.stored().delete(id); };`,
  covers: "export const fetchCoverData = async () => '';",
  "shelf-identity": "export const findOnShelf = (shelf,names) => shelf.find(book => names.some(name => name.title && book.title === name.title && book.author === name.author)) ?? null;",
  "vocab-store": "export const useVocab = { getState: () => globalThis.__pairTarget.state() };",
  epub: "export const applySpineMerge = x => x; export const parseEpub = async () => { throw Error('Unexpected parse'); };",
  "glossary-fetch": "export const fetchProtectedGlossary = async () => new Uint8Array(); export const remoteGlossaryId = () => null;",
  "glossary-format": "export const validateGlossary = () => ({ file: {} });",
  i18n: "export const tr = key => key;",
  "pack-glossary": "export const applyPackGlossary = async (id) => { globalThis.__pairTarget.stored().get(id).glossary = { complete: true }; return { words: 1 }; }; export const hashBytes = async () => '';",
  "books-base": "export const booksUrl = x => x;",
  "book-meta": "export const isbnDigits = x => x ?? ''; export const readSeries = () => ({series:'',seriesNumber:0});",
  "content-category": "export const readContentCategory = () => '';",
  lexile: "export const lexileMeasure = () => '';",
  "catalog-index": "export const noteCatalogIds = () => {};",
  "shared-fetch": "export const sharedJson = async (url) => (await fetch(url, { cache: 'no-cache' })).json();",
};
globalThis.__pairTarget = { state: () => state, records: () => records, stored: () => stored, writes: () => writes, gate: () => gate, extras: () => extras, recordGate: () => recordGate };
const resolve = (name) => name === "book-mutation" ? mutationUrl : name === "cancel-work" ? cancelUrl : url(mocks[name]);
const source = compile("packs").replace(/from "@\/lib\/([\w-]+)"/g, (_, name) => `from ${JSON.stringify(resolve(name))}`);
const { installPack, downloadPack } = await import(url(source));
const registerSource = compile("shelf-register").replace(/from "@\/lib\/([\w-]+)"/g, (_, name) => `from ${JSON.stringify(resolve(name))}`);
const { registerInstalled } = await import(url(registerSource));
const flowSource = compile("own-epub-flow")
  .replace('"@/lib/cancel-work"', JSON.stringify(cancelUrl))
  .replace('"@/lib/edition-match"', JSON.stringify(url("export const EDITION_MATCH_OK = 0.8;")));
const { createOwnEpubFlow } = await import(url(flowSource));
function fixture() {
  state = { books: [{id:"A"}, {id:"B"}], setBookDetails() {}, addBook() { throw Error("must not recreate"); } };
  records = [{bookId:"A",packId:"same",sha256:"",rev:""}, {bookId:"B",packId:"same",sha256:"",rev:""}];
  writes = []; stored = new Map(); extras = new Map(); gate = undefined; recordGate = undefined;
  return { packId:"same", targetBookId:"B", catalog:"word-lists", title:"Book", author:"Author", rev:"r", epub:new Uint8Array(), epubSha256:"", glossaryText:"", cover:"", parsed:{title:"Book",author:"Author",chapters:[],extras:[]} };
}
function remove(id) {
  mutation.invalidateTarget(id);
  state.books = state.books.filter(b => b.id !== id);
  return mutation.queueBookMutation(id, async () => { stored.delete(id); records = records.filter(r => r.bookId !== id); });
}
test("explicit B wins over the first record A with the same packId", async () => {
  const result = await installPack(fixture());
  assert.equal(result.bookId, "B"); assert.deepEqual(writes, ["B"]);
});
test("deletion during preparation invalidates a captured token even when B is recreated", async () => {
  const input = fixture(); input.mutation = mutation.captureTarget("B");
  await remove("B"); state.books.push({id:"B"});
  await assert.rejects(installPack(input), /bookGone/); assert.deepEqual(writes, []);
});
test("deletion while queued invalidates the old operation before it writes", async () => {
  const input = fixture();
  const running = installPack(input);
  await remove("B");
  await assert.rejects(running, /bookGone/); assert.deepEqual(writes, []);
});
test("delete during a write waits for it then removes all late body/pack records", async () => {
  const input = fixture(); let release;
  gate = new Promise(resolve => { release = resolve; });
  const running = installPack(input);
  while (!writes.length) await new Promise(resolve => setTimeout(resolve, 0));
  const removed = remove("B"); release();
  await assert.rejects(running, /bookGone/); await removed;
  assert.equal(stored.has("B"), false); assert.equal(records.some(r => r.bookId === "B"), false);
});
test("deletion between storage success and registration cannot revive B, including same-id recreation", async () => {
  const result = await installPack(fixture()); await remove("B");
  assert.throws(() => registerInstalled(result), /bookGone/);
  state.books.push({id:"B"});
  assert.throws(() => registerInstalled(result), /bookGone/);
});

test("implicit install refuses multiple live cards with the same scoped pack id", async () => {
  const input = fixture(); delete input.targetBookId;
  await assert.rejects(installPack(input), /bookAddFailed/);
  assert.deepEqual(writes, []);
});
test("implicit install scopes a shared bare pack id by stored catalog", async () => {
  const input = fixture(); delete input.targetBookId;
  extras.set("A", {catalog:"public-books"}); extras.set("B", {catalog:"word-lists"});
  const result = await installPack(input);
  assert.equal(result.bookId, "B"); assert.deepEqual(writes, ["B"]);
});
test("explicit target cannot overwrite a card from another catalog with the same bare id", async () => {
  const input = fixture(); extras.set("B", {catalog:"public-books"});
  await assert.rejects(installPack(input), /bookAddFailed/);
  assert.deepEqual(writes, []);
});
test("dead pack records do not create ambiguity for the single live card", async () => {
  const input = fixture(); delete input.targetBookId; state.books = [{id:"B"}];
  const result = await installPack(input);
  assert.equal(result.bookId, "B"); assert.deepEqual(writes, ["B"]);
});

test("implicit reuse also serializes delete and returns an epoch-guarded result", async () => {
  const input = fixture(); delete input.targetBookId; state.books = [{id:"B"}]; let release;
  gate = new Promise(resolve => { release = resolve; });
  const running = installPack(input);
  while (!writes.length) await new Promise(resolve => setTimeout(resolve, 0));
  const removed = remove("B"); release();
  await assert.rejects(running, /bookGone/); await removed;
  assert.equal(stored.has("B"), false); assert.equal(records.some(r => r.bookId === "B"), false);
});
test("implicit reuse returns mutation so deletion after success cannot register", async () => {
  const input = fixture(); delete input.targetBookId; state.books = [{id:"B"}];
  const result = await installPack(input); assert.equal(result.mutation.bookId, "B");
  await remove("B"); assert.throws(() => registerInstalled(result), /bookGone/);
});
test("unmount abort after existing body write does not leave new body with empty glossary and old pack", async () => {
  const input = fixture(); const controller = new AbortController(); input.signal = controller.signal;
  input.glossaryText = "list"; let release;
  gate = new Promise(resolve => { release = resolve; });
  const running = installPack(input);
  while (!writes.length) await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort(); release();
  const result = await running;
  assert.equal(result.bookId, "B"); assert.deepEqual(stored.get("B").glossary, {complete:true});
  assert.equal(records.at(-1).rev, "r"); assert.equal(records.at(-1).bookId, "B");
});
test("abort before the first body write still leaves existing storage untouched", async () => {
  const input = fixture(); const controller = new AbortController(); input.signal = controller.signal; controller.abort();
  await assert.rejects(installPack(input), {name:"AbortError"}); assert.deepEqual(writes, []);
});

test("actual flow unmount during committed existing install completes data and suppresses callbacks", async () => {
  const input = fixture(); input.glossaryText = "list"; let release; let registered = 0; let notified = 0;
  gate = new Promise(resolve => { release = resolve; });
  const flow = createOwnEpubFlow({
    change() {}, hasTarget: () => true, targetMissing: () => Error("gone"),
    save: (_, work) => installPack({...input,signal:work.signal}),
    register() { registered++; }, saved() { notified++; },
  });
  const running = flow.start(async () => ({match:{kind:"anchor",rate:1}}), "checking");
  while (!writes.length) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(stored.has("B"), true, "the new body already committed before unmount");
  assert.deepEqual(stored.get("B").glossary, {}, "glossary has not yet been reapplied");
  flow.cancel(true); release(); await running;
  assert.deepEqual(stored.get("B").glossary, {complete:true});
  assert.equal(records.at(-1).rev, "r"); assert.equal(registered, 0); assert.equal(notified, 0);
});

for (const entry of ["install", "download"]) for (const recreate of [false,true]) {
  test(`${entry}: first record lookup deletion${recreate ? " and same-id recreation" : ""} cannot turn existing B into new UUID`, async () => {
    const input = fixture(); delete input.targetBookId;
    state.books = [{id:"B", title:input.title, author:input.author}];
    let release; recordGate = new Promise(resolve => { release = resolve; });
    const running = entry === "install" ? installPack(input) : downloadPack("public-books/catalog.json", {
      id:input.packId,title:input.title,author:input.author,isbn:"",epub:{sha256:"",url:"book.epub",bytes:0},glossary:{url:""},cover:null,
    }, () => {});
    await Promise.resolve(); await remove("B");
    if (recreate) state.books.push({id:"B",title:input.title,author:input.author});
    release(); await assert.rejects(running, /bookGone/); assert.deepEqual(writes, []);
  });
}

test("an unrelated deleted shelf card does not abort an implicit B install", async () => {
  const input = fixture(); delete input.targetBookId;
  state.books = [{id:"A",title:"Unrelated",author:"Other"},{id:"B",title:input.title,author:input.author}];
  records = records.filter(record => record.bookId === "B");
  let release; recordGate = new Promise(resolve => { release = resolve; });
  const running = installPack(input); await Promise.resolve(); await remove("A"); release();
  const result = await running; assert.equal(result.bookId, "B"); assert.deepEqual(writes, ["B"]);
});

for (const entry of ["install", "download"]) test(`${entry}: renamed B without ISBN deleted during first lookup never becomes new C`, async () => {
  const input = fixture(); delete input.targetBookId;
  state.books = [{id:"B",title:"My renamed copy",author:"Different author",isbn:""}];
  let release; recordGate = new Promise(resolve => { release = resolve; });
  const running = entry === "install" ? installPack(input) : downloadPack("public-books/catalog.json", {
    id:input.packId,title:input.title,author:input.author,isbn:"",epub:{sha256:"",url:"book.epub",bytes:0},glossary:{url:""},cover:null,
  }, () => {});
  await Promise.resolve(); await remove("B"); release();
  await assert.rejects(running, /bookGone/); assert.deepEqual(writes, []);
});

test("download carries the initial absence proof through delayed network preparation", async () => {
  const input = fixture(); records = []; state.books = [{id:"B",title:"Unknown renamed book",author:"Other",isbn:""}];
  const oldFetch = globalThis.fetch; const oldDocument = globalThis.document; let release; let entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const network = new Promise(resolve => { release = resolve; });
  globalThis.document = {baseURI:"https://example.test/"};
  globalThis.fetch = async () => { entered(); await network; return new Response(new Uint8Array([1,2,3])); };
  try {
    const running = downloadPack("https://example.test/catalog.json", {id:input.packId,title:input.title,author:input.author,isbn:"",rev:"r",epub:{sha256:"",url:"book.epub",bytes:3},glossary:{url:""},cover:null}, () => {});
    await arrived; await remove("B"); release();
    await assert.rejects(running, /bookGone/); assert.deepEqual(writes, []);
  } finally { globalThis.fetch = oldFetch; globalThis.document = oldDocument; }
});
