#!/usr/bin/env node
/**
 * Focused shelf -> own-EPUB regression, against a dev or production preview.
 *   E2E_URL=http://localhost:8100 CHROME=/path/to/chrome npm run test:shelf-pairing
 * Defaults match the other e2e scripts: http://127.0.0.1:8090 and /usr/bin/google-chrome.
 * No app-module imports, live account, remote catalog, or third-party book downloads.
 * All fixture writes are inside disposable browser contexts; the sample EPUB is read-only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import JSZip from "jszip";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8090/");
const at = (path) => new URL(path, BASE).href;
const ID = "shelf-pairing-fixture";
const TITLE = "The Lantern Seller";
const EMAIL = "shelf-pairing@example.invalid";
const STORAGE = "cibian-notebook-v1";
const EPUB = readFileSync(join(ROOT, "examples/sample-book/the-lantern-seller.epub"));
const COVER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const COVER_SHA = createHash("sha256").update(COVER).digest("hex");
const LIST = JSON.stringify({
  version: 2,
  title: TITLE,
  author: "A. Sample Writer",
  glossary: {
    shabby: {
      pos: "adjective",
      meaning: "Old and worn.",
      senses: [{ meaning: "Old and worn.", anchors: [{ chapter: 0, context: "His stall was shabby" }] }],
    },
  },
});
const SHA = createHash("sha256").update(LIST).digest("hex");
const CATALOG = {
  lists: [{
    id: ID, title: TITLE, author: "A. Sample Writer", words: 1,
    glossary: { url: `${ID}/glossary.json`, bytes: Buffer.byteLength(LIST), sha256: SHA },
  }],
};
// A valid but wrong edition, derived in memory only from the repo's CC0 sample.
const wrongZip = await JSZip.loadAsync(EPUB);
const chapter = "OEBPS/chapter1.xhtml";
const originalChapter = await wrongZip.file(chapter).async("string");
assert.ok(originalChapter.includes("His stall was shabby"), "sample still contains the fixture anchor");
wrongZip.file(chapter, originalChapter.replace("His stall was shabby", "His stall was spotless"));
const WRONG_EPUB = await wrongZip.generateAsync({ type: "nodebuffer" });

let checks = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok ${label}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});

async function newCase(mobile, legacy = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: mobile, hasTouch: mobile, locale: "en-US", serviceWorkers: "block",
  });
  const state = { signedIn: !legacy, unexpected: [], errors: [], glossaryFetches: 0 };
  await context.addInitScript(({ email, storage, legacy }) => {
    localStorage.setItem("cibian-locale-v1", "en");
    // Only seed once; reload must exercise the actual persisted shelf, not overwrite it.
    if (localStorage.getItem("shelf-pairing-seeded")) return;
    localStorage.setItem("shelf-pairing-seeded", "1");
    if (legacy) {
      localStorage.setItem(storage, JSON.stringify({ version: 0, state: {
        books: [{ id: "legacy-notes", title: "Legacy notes only", author: "Fixture Writer",
          source: "notes", cloth: "cloth", createdAt: 1, updatedAt: 1 }],
        words: [], log: {},
      } }));
    } else {
      localStorage.setItem("cibian-account-email-v1", email);
      localStorage.setItem("cibian-account-nickname-v1", "Fixture Reader");
      localStorage.setItem("cibian-account-role-v1", "user");
    }
  }, { email: EMAIL, storage: STORAGE, legacy });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    // Match both same-origin dev files and the books host baked into production builds.
    if (path === "/word-lists/catalog.json") return json({
      ...CATALOG,
      lists: CATALOG.lists.map((list) => ({ ...list, cover: { url: `${ID}/cover.png`, bytes: COVER.length, sha256: COVER_SHA } })),
    });
    if (path === `/word-lists/${ID}/cover.png`) return route.fulfill({ status: 200, contentType: "image/png", body: COVER });
    if (path === "/public-books/catalog.json") return json({ packs: [] });
    if (path === "/word-lists/discover-rails.json") return json({ rails: [] });
    if (path === `/word-lists/${ID}/glossary.json` || path === `/api/glossary/${ID}`) {
      state.glossaryFetches += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: LIST });
    }
    if (path === "/api/auth/me") return json({ user: state.signedIn
      ? { email: EMAIL, nickname: "Fixture Reader", role: "user" } : null });
    if (path === "/api/sync") return json({ items: [] });
    if (path === "/api/qq-groups") return json({ saved: true, groups: [] });
    if (path === "/api/analytics/word-taps") return json({ ok: true });
    // Never let an unknown service or book download escape to a real server.
    if (path.startsWith("/api/") || path.startsWith("/word-lists/") || path.startsWith("/public-books/") || url.origin !== BASE.origin) {
      state.unexpected.push(`${route.request().method()} ${url.href}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  return { context, page, state, mobile };
}

const cards = (page) => page.locator("li.book-card");
const pairing = (page) => page.getByRole("dialog", { name: "Your e-book", exact: true });
const shelfState = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").state, STORAGE);

/** Inspect persistence without importing dev-only app modules or altering the records. */
async function stored(page, id) {
  return page.evaluate(async ({ id, packId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "notes"], "readonly");
      const bodies = tx.objectStore("books").getAllKeys();
      const notes = tx.objectStore("notes");
      const pack = notes.get(`pack:${id}`);
      const list = notes.get(`wordlist:${packId}`);
      const gloss = notes.get(`gloss:${id}`);
      tx.oncomplete = () => {
        db.close();
        resolve({ bodies: bodies.result, pack: pack.result, list: list.result, gloss: gloss.result });
      };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }, { id, packId: ID });
}

async function shelf(page) {
  await page.goto(at("/shelf"));
  await cards(page).first().waitFor();
}

async function coverState(page, id) {
  return page.evaluate(async (bookId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["covers", "notes"], "readonly");
      const cover = tx.objectStore("covers").get(bookId);
      const info = tx.objectStore("notes").get(`coverinfo:${bookId}`);
      tx.oncomplete = () => {
        db.close();
        resolve({ cover: cover.result ?? "", info: info.result });
      };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }, id);
}

async function generatedCover(page) {
  check(await page.locator("li.book-card [data-generated-cover]").count() === 1,
    "an unpaired card uses its generated title cover");
  check(await page.locator("li.book-card img").count() === 0,
    "an unpaired card does not render cached EPUB artwork");
}

async function seedCover(page, id, value, info) {
  await page.evaluate(({ id, value, info }) => new Promise((resolve, reject) => {
    const request = indexedDB.open("cibian-books");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["covers", "notes"], "readwrite");
      tx.objectStore("covers").put(value, id);
      if (info) tx.objectStore("notes").put(info, `coverinfo:${id}`);
      else tx.objectStore("notes").delete(`coverinfo:${id}`);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { id, value, info });
}

async function sameCard(page, id, needsEpub) {
  const saved = await shelfState(page);
  check(saved.books.length === 1 && saved.books[0].id === id, "one original shelf identity remains");
  check((saved.books[0].needsEpub === true) === needsEpub, `needsEpub is ${needsEpub}`);
  if (new URL(page.url()).pathname === "/shelf") {
    check(await cards(page).count() === 1, "exactly one visible shelf card");
    check(!(await cards(page).innerText()).includes("Sample notebook"), "EPUB placeholder is not labeled Sample notebook");
  }
}

async function untouched(page, id, baseline) {
  const saved = await stored(page, id);
  check(saved.bodies.length === 0, "no body installed before confirmation");
  assert.deepEqual(saved.pack, baseline.pack, "pairing keeps the original pack record");
  check(saved.list === baseline.list && saved.list === LIST, "downloaded word list is retained byte for byte");
  assert.deepEqual(saved.gloss, baseline.gloss, "pairing preview does not install a glossary");
  await sameCard(page, id, true);
}

async function clickBook(test, target, title = TITLE) {
  const card = cards(test.page).filter({ has: test.page.getByRole("button", { name: title, exact: true }) });
  const button = target === "cover"
    ? card.getByRole("button", { name: `Open “${title}”`, exact: true })
    : card.getByRole("button", { name: title, exact: true });
  if (test.mobile) await button.tap(); else await button.click();
}

async function resumePairing(test, target) {
  await clickBook(test, target);
  await pairing(test.page).waitFor();
  await test.page.waitForFunction(() => {
    const input = document.querySelector("[data-own-epub]");
    return input && !input.disabled;
  });
  check(new URL(test.page.url()).pathname === "/shelf", `${target} resumes pairing, not /words or /read`);
}

async function dismiss(page) {
  await pairing(page).getByRole("button", { name: "Close", exact: true }).click();
  await pairing(page).waitFor({ state: "hidden" });
}

async function wordbook(test, id) {
  const { page } = test;
  const menu = cards(page).locator("[data-shelf-more]");
  if (test.mobile) { await menu.tap(); await menu.tap(); } else await menu.click();
  await page.getByRole("menuitem", { name: "Words from this book", exact: true }).click();
  await page.waitForURL((url) => url.pathname === `/words/${id}`);
  check(await pairing(page).count() === 0, "explicit Words from this book still opens the wordbook");
  check((await shelfState(page)).books[0].id === id, "wordbook keeps the same book");
  await shelf(page);
}

async function readBook(page, id) {
  await page.waitForURL((url) => url.pathname === `/read/${id}`);
  await page.locator("article.book-body").waitFor();
  await page.waitForFunction(() => document.querySelector("article.book-body")?.textContent?.replaceAll(String.fromCharCode(173), "").includes("Marrow Bridge"));
  const text = (await page.locator("article.book-body").textContent()).replaceAll(String.fromCharCode(173), "");
  check(text.includes("Marrow Bridge"), "real stored EPUB body is readable");
  check(await page.getByRole("dialog").count() === 0, "reading does not ask for pairing or authentication");
}

async function setSignedIn(test, value) {
  test.state.signedIn = value;
  // The mock server is the authority; clear its cached optimistic session for signed-out starts.
  await test.page.evaluate(({ value, email }) => {
    for (const key of ["email", "nickname", "role"]) localStorage.removeItem(`cibian-account-${key}-v1`);
    if (value) {
      localStorage.setItem("cibian-account-email-v1", email);
      localStorage.setItem("cibian-account-nickname-v1", "Fixture Reader");
      localStorage.setItem("cibian-account-role-v1", "user");
    }
  }, { value, email: EMAIL });
  await shelf(test.page);
}

async function mainFlow(mobile) {
  console.log(`\n== ${mobile ? "phone" : "desktop"}: Discover -> shelf -> pairing`);
  const test = await newCase(mobile);
  const { page, context, state } = test;
  try {
    await page.goto(at("/discover"));
    const add = page.locator(`[data-word-list="${ID}"] [data-shelf-add]`);
    await add.waitFor();
    await add.click();
    await pairing(page).waitFor();
    const books = (await shelfState(page)).books;
    check(books.length === 1 && books[0].source === "notes" && books[0].needsEpub === true,
      "real Discover add creates a notes-source EPUB placeholder");
    const id = books[0].id;
    const baseline = await stored(page, id);
    check(baseline.pack.packId === ID && baseline.pack.bookId === id, "placeholder is linked to this catalog word list");
    check(state.glossaryFetches > 0, "Discover fetched the mocked glossary");
    await dismiss(page);
    await shelf(page);
    await generatedCover(page);
    await seedCover(page, id, "data:image/gif;base64,wrong-cached-cover", { source: "epub", ref: "" });
    await page.reload();
    await cards(page).first().waitFor();
    await generatedCover(page);
    const placeholderCover = await coverState(page, id);
    check(placeholderCover.cover === "data:image/gif;base64,wrong-cached-cover" && placeholderCover.info?.source === "epub",
      "a stale cover record may remain cached but is not authoritative while unpaired");
    await untouched(page, id, baseline);
    await wordbook(test, id);

    for (const target of ["cover", "title"]) {
      await resumePairing(test, target);
      await dismiss(page);
      await generatedCover(page);
      await untouched(page, id, baseline);
    }
    await page.reload();
    await cards(page).first().waitFor();
    for (const target of ["cover", "title"]) {
      await resumePairing(test, target);
      await dismiss(page);
      await generatedCover(page);
      await untouched(page, id, baseline);
    }

    await resumePairing(test, "cover");
    await page.locator("[data-own-epub]").setInputFiles({
      name: "broken.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not an EPUB archive"),
    });
    await pairing(page).getByRole("alert").waitFor();
    check(await pairing(page).locator("[data-match-rate]").count() === 0, "invalid EPUB reports an error, not a pairing preview");
    await untouched(page, id, baseline);
    await dismiss(page);

    await resumePairing(test, "title");
    await page.locator("[data-own-epub]").setInputFiles({
      name: "wrong-edition.epub", mimeType: "application/epub+zip", buffer: WRONG_EPUB,
    });
    await pairing(page).locator("[data-match-rate]").waitFor();
    check((await pairing(page).locator("[data-match-rate]").innerText()).includes("Only 0%"), "wrong edition visibly warns about the failed match");
    // Low matches are deliberately confirmable in this app, not hard-blocked. Cancel the warning.
    await untouched(page, id, baseline);
    await dismiss(page);
    await untouched(page, id, baseline);

    await setSignedIn(test, false);
    for (const target of ["cover", "title"]) {
      await clickBook(test, target);
      const auth = page.getByRole("dialog");
      await auth.locator('input[type="password"]').waitFor();
      check(new URL(page.url()).pathname === "/shelf" && await pairing(page).count() === 0,
        `signed-out ${target} requests authentication, not wordbook or pairing`);
      await auth.getByRole("button", { name: "Close", exact: true }).click();
      await auth.waitFor({ state: "hidden" });
      await untouched(page, id, baseline);
    }

    await setSignedIn(test, true);
    await resumePairing(test, "cover");
    await page.locator("[data-own-epub]").setInputFiles({
      name: "the-lantern-seller.epub", mimeType: "application/epub+zip", buffer: EPUB,
    });
    await pairing(page).locator("[data-match-rate]").waitFor();
    check((await pairing(page).locator("[data-match-rate]").innerText()).includes("100%"), "sample EPUB matches the synthetic word list");
    await untouched(page, id, baseline);
    await pairing(page).getByRole("button", { name: "Add to my shelf", exact: true }).click();
    await readBook(page, id);
    check(await page.locator("article.book-body").count() === 1, "pairing opens the reader before cover validation");
    const pairedCover = await coverState(page, id);
    check(pairedCover.cover.length > 0 && pairedCover.info?.source === "catalog", "paired book stores its selected cover provenance");
    await sameCard(page, id, false);
    const installed = await stored(page, id);
    check(installed.bodies.length === 1 && installed.bodies[0] === id, "confirmation installs body under the original ID only");
    check(installed.pack.packId === ID && installed.pack.bookId === id && installed.gloss?.glossary?.shabby,
      "pairing keeps list identity and installs its glossary");
    await shelf(page);
    await sameCard(page, id, false);
    await wordbook(test, id);
    await clickBook(test, "title");
    await readBook(page, id);

    // Model old/synced metadata in this isolated context, while preserving the real installed body.
    await page.evaluate(({ key }) => {
      const persisted = JSON.parse(localStorage.getItem(key));
      persisted.state.books[0].source = "notes";
      persisted.state.books[0].needsEpub = true;
      localStorage.setItem(key, JSON.stringify(persisted));
    }, { key: STORAGE });
    await shelf(page);
    await sameCard(page, id, true);
    check((await shelfState(page)).books[0].source === "notes", "stale source flag survives reload for the regression check");
    await clickBook(test, "cover");
    await readBook(page, id);
    await setSignedIn(test, false);
    await clickBook(test, "title");
    await readBook(page, id);
    check((await stored(page, id)).bodies.length === 1, "signed-out reading retains the installed body");
    check(state.unexpected.length === 0, `no real services or unexpected downloads: ${state.unexpected.join(", ")}`);
    check(state.errors.length === 0, `no uncaught browser errors: ${state.errors.join(", ")}`);
  } finally {
    await context.close();
  }
}

async function legacyFlow() {
  console.log("\n== legacy notes without an EPUB requirement");
  const test = await newCase(false, true);
  try {
    await shelf(test.page);
    check((await cards(test.page).innerText()).includes("Sample notebook"), "genuine legacy notes keeps its Sample notebook footer");
    for (const target of ["cover", "title"]) {
      await clickBook(test, target, "Legacy notes only");
      await test.page.waitForURL((url) => url.pathname === "/words/legacy-notes");
      check(await test.page.getByRole("dialog").count() === 0, `legacy notes ${target} still opens words without authentication`);
      await shelf(test.page);
    }
    check((await stored(test.page, "legacy-notes")).bodies.length === 0, "legacy notes truly has no body");
    check(test.state.unexpected.length === 0 && test.state.errors.length === 0, "legacy case has no unexpected network calls or browser errors");
  } finally {
    await test.context.close();
  }
}

try {
  await mainFlow(false);
  await mainFlow(true);
  await legacyFlow();
  console.log(`\n${checks} shelf-pairing checks passed (${BASE.origin}).`);
} catch (error) {
  console.error(`\nFAIL after ${checks} checks:`, error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
