#!/usr/bin/env node
/**
 * Synthetic identity/update/removal regressions against an already finished build.
 * Never starts a server or builds the app. No live API, account, catalog or book files.
 * E2E_URL=http://127.0.0.1:8090 CHROME=/path/to/chrome node scripts/shelf-identity-e2e.mjs
 * All CC0 fixtures below exist only in disposable browser contexts.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8090/");
const at = (path) => new URL(path, BASE).href;
const TIME = 1_790_000_000_000;
const AUTHOR = "Fixture Writer";
const EPUB_SHA = "a".repeat(64);
const LIST = JSON.stringify({ version: 2, title: "Target Fixture", author: AUTHOR, glossary: {
  lantern: { pos: "noun", meaning: "A small portable light." },
} });
const LIST_SHA = createHash("sha256").update(LIST).digest("hex");
const book = (id, title, extra = {}) => ({ id, title, author: AUTHOR, source: "epub", cloth: "sage", createdAt: TIME, updatedAt: TIME, ...extra });
const listRow = (id, title, extra = {}) => ({ id, title, author: AUTHOR, words: 1,
  glossary: { url: `${id}/glossary.json`, bytes: Buffer.byteLength(LIST), sha256: LIST_SHA }, ...extra });
const classicRow = (id, title, extra = {}) => ({ ...listRow(id, title), rev: "new-revision", version: 2,
  epub: { url: `${id}/book.epub`, bytes: 1, sha256: EPUB_SHA }, ...extra });
const record = (bookId, packId, extra = {}) => ({ bookId, packId, rev: "old-revision", sha256: EPUB_SHA, installedAt: TIME, ...extra });
let checks = 0;
function pass(label) { console.log(`  ok ${label}`); checks += 1; }
const shelfCard = (page, title) => page.locator("li.book-card").filter({ has: page.getByRole("button", { name: title, exact: true }) });
const discoverCard = (page, id) => page.locator(`[data-pack="${id}"], [data-word-list="${id}"]`);

async function fixture(browser, { books, records = [], words = [], classics = [], lists = [], stored = books.map((item) => item.id), signedIn = false }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US", serviceWorkers: "block" });
  const state = { unexpected: [], errors: [], glossaryRequests: 0 };
  await context.addInitScript(() => localStorage.setItem("cibian-locale-v1", "en"));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const fixtureHost = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
    if (fixtureHost && path === "/public-books/catalog.json") return json({ format: 1, name: "Original synthetic fixtures", packs: classics });
    if (fixtureHost && path === "/word-lists/catalog.json") return json({ lists });
    if (fixtureHost && path === "/word-lists/discover-rails.json") return json({ rails: [] });
    if (fixtureHost && /^\/(?:word-lists|public-books)\/[a-z0-9_-]+\/blurb\.json$/.test(path)) return json({ paragraphs: ["Original synthetic fixture description."] });
    if (fixtureHost && path === "/contributors.json") return json({ people: [], books: {} });
    if (url.origin === BASE.origin && path === "/api/auth/me") return json({ user: signedIn ? { email: "identity@example.invalid", nickname: "Fixture Reader", role: "user", emailVerified: true } : null, glossary: { unlimited: true } });
    if (url.origin === BASE.origin && path === "/api/sync") return json({ items: [] });
    if (url.origin === BASE.origin && path === "/api/qq-groups") return json({ saved: true, groups: [] });
    if (url.origin === BASE.origin && path === "/api/analytics/word-taps") return json({ ok: true });
    if (fixtureHost && (/^\/api\/glossary\/[a-z0-9_-]+$/.test(path) || /^\/(?:word-lists|public-books)\/[a-z0-9_-]+\/glossary\.json$/.test(path))) {
      state.glossaryRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: LIST });
    }
    if (url.origin === BASE.origin && path === "/__identity-fixture__") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Original synthetic fixture setup</title>" });
    const appAsset = /^\/assets\//.test(path) || /\.(?:js|css|woff2?|ttf|ico|svg|png|webmanifest)$/.test(path);
    if (url.origin === BASE.origin && request.method() === "GET" && !/^\/(?:api|word-lists|public-books|packs)(?:\/|$)/.test(path)
      && (["/shelf", "/discover", "/admin", "/notebook"].includes(path) || appAsset)) return route.continue();
    state.unexpected.push(`${request.method()} ${url.href}`);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.goto(at("/__identity-fixture__"));
  await page.evaluate(async ({ books, records, words, stored }) => {
    localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: { books, words, log: {} } }));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books", 3);
      request.onupgradeneeded = () => { for (const name of ["books", "covers", "notes"]) request.result.createObjectStore(name); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "notes"], "readwrite");
        for (const item of books.filter((item) => stored.includes(item.id))) {
          const meta = { id: item.id, title: item.title, author: item.author, glossary: { original: { pos: "adjective", meaning: `Untouched fixture ${item.id}.` } }, pending: [], totalHard: 1 };
          tx.objectStore("books").put({ ...meta, chapters: [{ title: "Original fixture chapter", paragraphs: ["A lantern shines beside an original fixture harbor."] }] }, item.id);
          tx.objectStore("notes").put(meta, `gloss:${item.id}`);
        }
        for (const row of records) {
          tx.objectStore("notes").put(row, `pack:${row.bookId}`);
          tx.objectStore("notes").put({ source: row.packId, ...(row.catalog ? { catalog: row.catalog } : {}), paragraphs: [], sentences: [], phrases: {} }, `extras:${row.bookId}`);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("fixture transaction failed"));
      });
    } finally { db.close(); }
  }, { books, records, words, stored, time: TIME });
  return { context, page, state };
}
async function snapshot(page, ids) {
  return page.evaluate(async (ids) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("cibian-books", 3); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(["books", "notes"], "readonly");
      const read = (store, key) => new Promise((resolve, reject) => { const request = tx.objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return await Promise.all(ids.map(async (id) => ({ id, book: await read("books", id), meta: await read("notes", `gloss:${id}`), record: await read("notes", `pack:${id}`) })));
    } finally { db.close(); }
  }, ids);
}
async function clean(test) {
  try {
    assert.deepEqual(test.state.unexpected, [], "no unmocked book/API/external requests");
    assert.deepEqual(test.state.errors, [], "no browser page errors");
  } finally { await test.context.close(); }
}
async function eventually(read, predicate, label) {
  let value;
  const deadline = Date.now() + 15000;
  do { value = await read(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

async function recordless(browser) {
  const books = [book("subtitle-local", "Harbor Chronicle: Winter"), book("isbn-local", "Island Fixture", { isbn: "9780306406157" })];
  const test = await fixture(browser, { books, lists: [listRow("subtitle-catalog", "Harbor Chronicle: Summer"), listRow("isbn-catalog", "Island Fixture", { isbn: "9780140328721" })] });
  try {
    await test.page.goto(at("/discover"));
    for (const id of ["subtitle-catalog", "isbn-catalog"]) {
      const control = discoverCard(test.page, id).locator("[data-shelf-add]");
      await control.waitFor();
      assert.equal(await control.getAttribute("data-shelf-state"), "off");
    }
    pass("recordless real subtitles and conflicting valid ISBNs are not held");
  } finally { await clean(test); }
}
async function targetUpdate(browser) {
  const books = [book("target-a", "Unchanged Alpha Fixture"), book("target-b", "Target Beta Fixture")];
  const test = await fixture(browser, { books, records: [record("orphan", "shared-fixture"), record("target-a", "shared-fixture"), record("target-b", "shared-fixture")], classics: [classicRow("shared-fixture", "Shared Catalog Fixture")], signedIn: true });
  try {
    await test.page.goto(at("/discover"));
    const control = discoverCard(test.page, "shared-fixture").locator("[data-shelf-add]");
    await control.waitFor();
    assert.equal(await control.isDisabled(), true, "competing live install records disable Add");
    const beforeClick = await snapshot(test.page, ["target-a", "target-b", "orphan"]);
    await control.evaluate((element) => element.click());
    await test.page.waitForTimeout(100);
    assert.deepEqual(await snapshot(test.page, ["target-a", "target-b", "orphan"]), beforeClick);
    assert.equal(test.state.glossaryRequests, 0, "disabled ambiguous Add cannot request a list");
    await test.page.goto(at("/shelf"));
    const update = shelfCard(test.page, books[1].title).locator("[data-list-update-button]");
    await update.waitFor();
    const before = await snapshot(test.page, ["target-a", "target-b", "orphan"]);
    await update.click();
    const after = await eventually(() => snapshot(test.page, ["target-a", "target-b", "orphan"]), (rows) => rows[1].record?.rev === "new-revision", "B revision advances");
    assert.deepEqual(after[0], before[0], "A book, glossary and record are byte-for-byte untouched");
    assert.deepEqual(after[2], before[2], "orphan record is untouched");
    assert.ok(after[1].meta.glossary.lantern, "B has the replacement glossary");
    assert.equal(after[1].meta.glossary.original, undefined);
    assert.equal(test.state.glossaryRequests, 1);
    pass("duplicate pack records fail closed in Discover; explicit Shelf B update changes B only in IDB");
  } finally { await clean(test); }
}
async function emptyRevision(browser) {
  for (const installedRev of ["", "g1"]) {
    const mine = book("empty-rev", "Empty Revision Fixture");
    const test = await fixture(browser, { books: [mine], records: [record(mine.id, "empty-rev", { rev: installedRev, sha256: "b".repeat(64), catalog: "public-books" })], classics: [classicRow("empty-rev", mine.title, { rev: "g1" })] });
    try {
      await test.page.goto(at("/shelf"));
      await shelfCard(test.page, mine.title).locator('[data-list-update="bookChanged"]').waitFor();
      await test.page.goto(at("/discover"));
      const card = discoverCard(test.page, "empty-rev");
      await eventually(() => card.locator("[data-shelf-add]").getAttribute("data-shelf-state"), (state) => state === "update", "empty or repeated installed revision still offers Update");
      assert.match(await card.innerText(), /The book file changed/);
      pass(`${installedRev ? "repeated G1 glossary revision" : "empty installed revision"} retains SHA-change hold in Shelf and Discover`);
    } finally { await clean(test); }
  }
}
async function onlySavedWords(browser) {
  const mine = book("words-only", "Words Only Fixture", { source: "notes", needsEpub: true });
  const sentence = "An original fixture sentence about a lantern.";
  const source = { book: "book:wordsonlyfixture|fixturewriter", title: mine.title, author: AUTHOR, sentence, surface: "lantern", savedAt: TIME };
  const words = [{ id: "saved-lantern", lemma: "lantern", surface: "lantern", pos: "noun", meaning: "A fixture light.", whyHard: "", recommend: false, sentence, stage: 0, dueAt: 1, createdAt: TIME, reps: 0, lapses: 0, sources: [source] }];
  const test = await fixture(browser, { books: [mine], words, stored: [], lists: [listRow("words-only-catalog", mine.title)] });
  try {
    await test.page.goto(at("/shelf"));
    await shelfCard(test.page, mine.title).locator("[data-shelf-more]").click();
    await test.page.locator("[data-shelf-remove]").click();
    const confirmation = test.page.getByRole("alertdialog", { name: `Remove “${mine.title}” from your shelf?`, exact: true });
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /Your 1 word from this book stay in your notebook/);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await test.page.goto(at("/discover"));
    const control = discoverCard(test.page, "words-only-catalog").locator("[data-shelf-add]");
    await control.waitFor();
    assert.equal(await control.getAttribute("data-shelf-state"), "on");
    await control.click();
    await test.page.locator("[data-shelf-remove]").click();
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /Your 1 word from this book stay in your notebook/);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await test.page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.words.length), 1);
    pass("only saved words require confirmation in Shelf and Discover; cancellation keeps the global word");
  } finally { await clean(test); }
}

async function catalogCollision(browser) {
  const privateBook = book("private-target", "Private Catalog Fixture");
  const publicBook = book("public-target", "Public Catalog Fixture");
  const records = [record(privateBook.id, "collision", { catalog: "word-lists" }), record(publicBook.id, "collision", { catalog: "public-books" })];
  const test = await fixture(browser, { books: [privateBook, publicBook], records,
    classics: [classicRow("collision", publicBook.title)], lists: [listRow("collision", privateBook.title)], signedIn: true });
  try {
    await test.page.goto(at("/discover"));
    const privateCard = test.page.locator('[data-word-list="collision"]');
    const publicCard = test.page.locator('[data-pack="collision"]');
    await eventually(() => privateCard.locator('[data-shelf-add]').getAttribute("data-shelf-state"), (state) => state === "update", "private catalog offers Update");
    assert.equal(await privateCard.locator('[data-identity-ambiguous]').count(), 0);
    assert.equal(await publicCard.locator('[data-identity-ambiguous]').count(), 0);
    const before = await snapshot(test.page, [privateBook.id, publicBook.id]);
    await privateCard.locator('[data-shelf-add]').click();
    const after = await eventually(() => snapshot(test.page, [privateBook.id, publicBook.id]), (rows) => rows[0].record.rev === LIST_SHA.slice(0, 12), "private catalog revision advances");
    assert.deepEqual(after[1], before[1], "private Discover Update does not write the colliding public card");
    assert.ok(after[0].meta.glossary.lantern);
    assert.equal(after[0].meta.title, privateBook.title, "public pack metadata did not overwrite the private book");
    pass("explicit catalog identity selects the private list despite an identical public raw id");
  } finally { await clean(test); }
  const legacy = await fixture(browser, { books: [privateBook], records: [record(privateBook.id, "collision")],
    classics: [classicRow("collision", publicBook.title)], lists: [listRow("collision", privateBook.title)], signedIn: true });
  try {
    await legacy.page.goto(at("/discover"));
    for (const selector of ['[data-word-list="collision"]', '[data-pack="collision"]']) {
      const card = legacy.page.locator(selector);
      const control = card.locator('[data-shelf-add]');
      await control.waitFor();
      assert.equal(await control.isDisabled(), true);
      await control.evaluate((element) => element.click());
    }
    const before = await snapshot(legacy.page, [privateBook.id]);
    await legacy.page.locator('[data-word-list="collision"] [data-card-detail]').click();
    const action = legacy.page.locator('[data-detail-action]');
    await action.waitFor();
    assert.equal(await action.isDisabled(), true);
    await action.evaluate((element) => element.click());
    assert.deepEqual(await snapshot(legacy.page, [privateBook.id]), before);
    assert.equal(legacy.state.glossaryRequests, 0);
    pass("legacy colliding raw id disables card and detail Add without writes");
  } finally { await clean(legacy); }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome"), chromiumSandbox: true });
try {
  await recordless(browser);
  await targetUpdate(browser);
  await emptyRevision(browser);
  await catalogCollision(browser);
  await onlySavedWords(browser);
  console.log(`PASS: ${checks} synthetic identity/update/removal checks (desktop Chrome, sandbox enabled).`);
} finally { await browser.close(); }
