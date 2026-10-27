#!/usr/bin/env node
/**
 * Focused Discover/synced shelf -> own-EPUB/private-library regression.
 * Attach to an already running dev/production preview; this script never starts a server.
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
// No comparison snippets: explicit consent is required even though the numeric rate is 100.
const noneList = JSON.parse(LIST);
delete noneList.glossary.shabby.senses;
const NONE_LIST = JSON.stringify(noneList);
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
  chromiumSandbox: true,
});

// Real sync wire rows, not localStorage shelf seeding or fabricated PackRecords.
const SYNC_ID = "synced-lantern-device-id";
const SYNC_KEY = "book:lanternseller|asamplewriter";
const SYNC_TIME = 1_790_000_000_000;
const SYNC_PROGRESS = {
  chapter: 1, chapters: 3, scroll: 0.25, updatedAt: SYNC_TIME,
  anchor: { chapter: 1, paragraph: 0, quote: "As the sun sank, a fine drizzle began to fall.", offset: 0 },
};
function syncFixture() {
  const row = (kind, itemId, data) => ({ kind, itemId, updatedAt: SYNC_TIME, deleted: false, data });
  const sentence = "An original saved sentence from another device.";
  return [
    row("shelf", SYNC_KEY, { id: SYNC_ID, title: TITLE, author: "A. Sample Writer",
      source: "epub", cloth: "sage", createdAt: SYNC_TIME - 1000, updatedAt: SYNC_TIME }),
    row("progress", SYNC_KEY, SYNC_PROGRESS),
    row("wordbook", "w-f", { words: [{ id: "synced-saved-word", surface: "fixtureword", lemma: "fixtureword",
      pos: "noun", meaning: "A saved fixture word.", whyHard: "", recommend: false, sentence,
      stage: 3, dueAt: SYNC_TIME + 86400000, createdAt: SYNC_TIME - 1000,
      reps: 7, lapses: 2, updatedAt: SYNC_TIME,
      sources: [{ k: `${SYNC_KEY}#${sentence.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 48)}`,
        book: SYNC_KEY, title: TITLE, author: "A. Sample Writer", sentence,
        surface: "fixtureword", savedAt: SYNC_TIME - 1000 }],
    }], removed: [] }),
  ];
}

/** Hold the next mocked response; a test can close the dialog before releasing it. */
function holdNext(state, kind) {
  let release;
  let arrived;
  const gate = { ready: new Promise((resolve) => { arrived = resolve; }),
    released: new Promise((resolve) => { release = resolve; }), arrive: () => arrived(), release: () => release() };
  gate.wait = async () => {
    let timer;
    try {
      await Promise.race([gate.ready, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`mock ${kind} was never requested`)), 15000);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };
  state[kind] = gate;
  state.gates.push(gate);
  return gate;
}

async function newCase(mobile, { legacy = false, synced = false, role = "user", list = LIST } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: mobile, hasTouch: mobile, locale: "en-US", serviceWorkers: "block",
  });
  const state = { signedIn: !legacy, role, unexpected: [], errors: [], glossaryFetches: 0,
    libraryFetches: 0, syncPulls: 0, libraryFailures: 0, gates: [], glossaryGate: null, libraryGate: null, coverGate: null };
  const remote = new Map((synced ? syncFixture() : []).map((item) => [`${item.kind}:${item.itemId}`, item]));
  await context.addInitScript(({ email, storage, legacy, role }) => {
    localStorage.setItem("cibian-locale-v1", "en");
    // Observe real writes and the state immediately before onSaved opens the reader.
    window.__pairingProbe = { bodyWrites: [], reads: [], failBodyWrites: 0 };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "books") {
        window.__pairingProbe.bodyWrites.push(key ?? value.id);
        if (window.__pairingProbe.failBodyWrites > 0) {
          window.__pairingProbe.failBodyWrites -= 1;
          throw new DOMException("Fixture storage failure", "QuotaExceededError");
        }
      }
      return put.apply(this, arguments);
    };
    const push = history.pushState;
    history.pushState = function (state, title, url) {
      if (url && new URL(url, location.href).pathname.startsWith("/read/")) {
        window.__pairingProbe.reads.push({
          vocab: JSON.parse(localStorage.getItem(storage) || "{}").state,
          progress: JSON.parse(localStorage.getItem("cibian-progress-v1") || "{}").state?.items,
        });
      }
      return push.apply(this, arguments);
    };
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
      localStorage.setItem("cibian-account-role-v1", role);
    }
  }, { email: EMAIL, storage: STORAGE, legacy, role });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    // Match local dev files and the baked-in books host, never arbitrary third-party hosts.
    const fixtureHost = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
    if (fixtureHost && path === "/word-lists/catalog.json") return json({
      ...CATALOG,
      lists: CATALOG.lists.map((item) => ({ ...item,
        glossary: { ...item.glossary, bytes: Buffer.byteLength(list), sha256: createHash("sha256").update(list).digest("hex") },
        cover: { url: `${ID}/cover.png`, bytes: COVER.length, sha256: COVER_SHA },
      })),
    });
    if (fixtureHost && path === `/word-lists/${ID}/cover.png`) {
      const gate = state.coverGate;
      // Ignore display <img> requests: only hold the cancellable preparation fetch.
      if (gate && route.request().resourceType() === "fetch") {
        state.coverGate = null;
        gate.arrive(); await gate.released;
      }
      try { return await route.fulfill({ status: 200, contentType: "image/png", body: COVER }); }
      catch (error) { if (!gate?.cancelled && !route.request().failure() && !context.pages().every(page => page.isClosed())) throw error; }
      return;
    }
    if (fixtureHost && path === "/public-books/catalog.json") return json({ packs: [] });
    if (fixtureHost && path === "/word-lists/discover-rails.json") return json({ rails: [] });
    if (fixtureHost && path === `/word-lists/${ID}/blurb.json`) return json({});
    if (fixtureHost && path === "/contributors.json") return json({ people: [], books: {} });
    if (fixtureHost && (path === `/word-lists/${ID}/glossary.json` || (url.origin === BASE.origin && path === `/api/glossary/${ID}`))) {
      state.glossaryFetches += 1;
      const gate = state.glossaryGate;
      state.glossaryGate = null;
      if (gate) { gate.arrive(); await gate.released; }
      try { return await route.fulfill({ status: 200, contentType: "application/json", body: list }); }
      catch (error) { if (!gate?.cancelled && !route.request().failure() && !context.pages().every(page => page.isClosed())) throw error; }
      return;
    }
    if (url.origin === BASE.origin && path === `/api/book/${ID}/epub`) {
      state.libraryFetches += 1;
      check(state.signedIn && state.role === "trusted", "private endpoint uses only the trusted mock account");
      const gate = state.libraryGate;
      state.libraryGate = null;
      if (gate) { gate.arrive(); await gate.released; }
      if (state.libraryFailures > 0) {
        state.libraryFailures -= 1;
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"fixture-unavailable"}' });
      }
      // A cancelled request may have gone away by the time this deliberately late response is released.
      try {
        return await route.fulfill({ status: 200, contentType: "application/epub+zip", body: EPUB });
      } catch (error) {
        if (!gate?.cancelled && !route.request().failure() && !context.pages().every((page) => page.isClosed())) throw error;
      }
      return;
    }
    if (url.origin === BASE.origin && path === "/api/auth/me") return json({ user: state.signedIn
      ? { email: EMAIL, nickname: "Fixture Reader", role: state.role, emailVerified: true } : null,
      glossary: { unlimited: true } });
    if (url.origin === BASE.origin && path === "/api/sync") {
      if (!synced) return json({ items: [] });
      if (route.request().method() === "GET") state.syncPulls += 1;
      else {
        for (const item of route.request().postDataJSON()?.items ?? []) {
          const key = `${item.kind}:${item.itemId}`;
          if (!remote.has(key) || remote.get(key).updatedAt <= item.updatedAt) remote.set(key, item);
        }
      }
      return json({ items: [...remote.values()] });
    }
    if (url.origin === BASE.origin && path === "/api/qq-groups") return json({ saved: true, groups: [] });
    if (url.origin === BASE.origin && path === "/api/analytics/word-taps") return json({ ok: true });
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
  return { context, page, state, mobile, remote };
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

// A card with no EPUB on this device shows the catalog picture (it does not depend on the file),
// never a cached picture taken from an EPUB.
async function catalogCover(page, id) {
  const img = page.locator("li.book-card img");
  await img.first().waitFor();
  check(await page.locator("li.book-card [data-generated-cover]").count() === 0,
    "an unpaired card shows its catalog cover, not the generated title cover");
  // The shelf renders cloudCover's versioned URL, not the legacy IndexedDB data URL.
  await page.waitForFunction(({ path, version }) => {
    const image = document.querySelector("li.book-card img");
    if (!image?.getAttribute("src")) return false;
    const url = new URL(image.getAttribute("src"), location.href);
    return url.pathname === path && url.searchParams.get("v") === version && image.complete && image.naturalWidth > 0;
  }, { path: `/word-lists/${ID}/cover.png`, version: COVER_SHA.slice(0, 12) });
  const shown = new URL(await img.first().getAttribute("src"), page.url());
  check(shown.pathname === `/word-lists/${ID}/cover.png` && shown.searchParams.get("v") === COVER_SHA.slice(0, 12),
    "the card renders the loaded, current catalog picture rather than a cached EPUB picture");
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
  if (new URL(page.url()).pathname.replace(/\/$/, "") === "/shelf") {
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
  await pairing(test.page).waitFor().catch(async (error) => {
    console.error("Pairing entry state:", test.page.url(), await test.page.locator("body").innerText(), test.state.errors);
    throw error;
  });
  await test.page.waitForFunction(() => {
    const input = document.querySelector("[data-own-epub]");
    return input && !input.disabled;
  });
  check(new URL(test.page.url()).pathname === "/shelf/", `${target} resumes pairing, not /words or /read`);
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

async function readBook(page, id, expected = "Marrow Bridge") {
  await page.waitForURL((url) => url.pathname === `/read/${id}`);
  await page.locator("article.book-body").waitFor().catch(async (error) => {
    console.error("Reader state:", await page.locator("body").innerText(), await stored(page, id));
    throw error;
  });
  await page.waitForFunction((text) => document.querySelector("article.book-body")?.textContent?.replaceAll(String.fromCharCode(173), "").includes(text), expected);
  const text = (await page.locator("article.book-body").textContent()).replaceAll(String.fromCharCode(173), "");
  check(text.includes(expected), "real stored EPUB body is readable at the expected chapter");
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
    await catalogCover(page, id);
    // A legacy EPUB picture is ignored: the shelf always loads the versioned catalog URL.
    await seedCover(page, id, "data:image/gif;base64,wrong-cached-cover", { source: "epub", ref: "" });
    await page.reload();
    await cards(page).first().waitFor();
    await catalogCover(page, id);
    check(!(await page.locator("li.book-card img").first().getAttribute("src")).includes("wrong-cached-cover"),
      "a stale EPUB picture is never shown while unpaired");
    await untouched(page, id, baseline);
    await wordbook(test, id);

    for (const target of ["cover", "title"]) {
      await resumePairing(test, target);
      await dismiss(page);
      await catalogCover(page, id);
      await untouched(page, id, baseline);
    }
    await page.reload();
    await cards(page).first().waitFor();
    for (const target of ["cover", "title"]) {
      await resumePairing(test, target);
      await dismiss(page);
      await catalogCover(page, id);
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
    check(await pairing(page).locator("[data-match-rate]").getAttribute("data-match-rate") === "0", "wrong edition visibly reports a zero match");
    check(await pairing(page).locator("[data-own-epub-confirm]").isVisible(), "low match requires an explicit continue action");
    // Low matches are deliberately confirmable in this app, not hard-blocked. Cancel the warning.
    await untouched(page, id, baseline);
    await dismiss(page);
    await untouched(page, id, baseline);

    await setSignedIn(test, false);
    for (const target of ["cover", "title"]) {
      await clickBook(test, target);
      const auth = page.getByRole("dialog");
      await auth.locator('input[type="password"]').waitFor();
      check(new URL(page.url()).pathname === "/shelf/" && await pairing(page).count() === 0,
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
    // A matching EPUB automatically saves/registers and calls onSaved. No confirmation click.
    await readBook(page, id);
    check((await shelfState(page)).books[0].matchRate === 100, "matching EPUB automatically registers its 100% match");
    check(await page.locator("article.book-body").count() === 1, "pairing opens the reader before cover validation");
    const pairedCover = await coverState(page, id);
    check(pairedCover.cover.length > 0 && pairedCover.info?.source === "catalog", "paired book stores its selected cover provenance");
    await sameCard(page, id, false);
    const installed = await stored(page, id);
    check(installed.bodies.length === 1 && installed.bodies[0] === id, "automatic pairing installs body under the original ID only");
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

async function cleanCase(test) {
  for (const gate of test.state.gates) gate.release();
  await test.context.close();
}

function cleanNetwork(test) {
  check(test.state.unexpected.length === 0, `no real services or unexpected downloads: ${test.state.unexpected.join(", ")}`);
  check(test.state.errors.length === 0, `no uncaught browser errors: ${test.state.errors.join(", ")}`);
}

async function waitPairingReady(page) {
  await pairing(page).waitFor();
  await page.locator("[data-own-epub]:not([disabled])").waitFor({ state: "attached" });
}

async function chooseEpub(page, buffer = EPUB, duplicate = false) {
  const input = page.locator("[data-own-epub]");
  if (duplicate) {
    // Same-turn change events, each with a real file: the first handler clears the input's value.
    await input.evaluate((element, bytes) => {
      const file = new File([new Uint8Array(bytes)], "fixture.epub", { type: "application/epub+zip" });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        element.files = transfer.files;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, [...buffer]);
  } else {
    await input.setInputFiles({ name: "fixture.epub", mimeType: "application/epub+zip", buffer });
  }
}

async function discoverAdd(test) {
  await test.page.goto(at("/discover"));
  await test.page.locator(`[data-word-list="${ID}"] [data-shelf-add]`).click();
  await waitPairingReady(test.page);
  const books = (await shelfState(test.page)).books;
  check(books.length === 1 && books[0].needsEpub, "Discover first add creates exactly one waiting card");
  return books[0].id;
}

async function singleInstall(page, id) {
  const probe = await page.evaluate(() => window.__pairingProbe);
  assert.deepEqual(probe.bodyWrites, [id], "one body write: repeated events do not enqueue another install");
  check(probe.reads.length === 1, "onSaved opens the reader exactly once");
  await sameCard(page, id, false);
  const saved = await stored(page, id);
  check(saved.bodies.length === 1 && saved.bodies[0] === id && saved.pack?.bookId === id && saved.pack?.packId === ID,
    "one body and one install identity stay under the original card ID");
}

// Dispatch twice in the same JS turn, before React can repaint a disabled control.
async function doubleClick(page, selector) {
  await page.locator(selector).evaluate((button) => { button.click(); button.click(); });
}

async function firstDiscoverFlow(mobile, trusted) {
  console.log(`\n== first Discover ${trusted ? "trusted library" : "own EPUB"} -> automatic reader`);
  const test = await newCase(mobile, { role: trusted ? "trusted" : "user" });
  try {
    const id = await discoverAdd(test);
    check(await test.page.locator("[data-library-open]").count() === (trusted ? 1 : 0), "library action respects the mocked account role");
    if (trusted) await doubleClick(test.page, "[data-library-open]");
    else await chooseEpub(test.page, EPUB, true);
    await readBook(test.page, id);
    await singleInstall(test.page, id);
    check(test.state.libraryFetches === (trusted ? 1 : 0), "one private request for trusted download, none for own-file pairing");
    cleanNetwork(test);
  } finally {
    await cleanCase(test);
  }
}

async function assertSyncedWork(page, words, atRead = false) {
  // Snapshot at pushState avoids asserting byte equality against the reader's legitimate scroll remeasurement.
  const state = atRead ? await page.evaluate(() => window.__pairingProbe.reads[0]) : {
    vocab: await shelfState(page),
    progress: await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-progress-v1") || "{}").state?.items),
  };
  assert.deepEqual(state.progress[SYNC_ID], SYNC_PROGRESS, "pairing never resets the synced reading place");
  assert.deepEqual(state.vocab.words, words, "pairing never resets saved words, sources or review schedule");
  check(state.vocab.books.length === 1 && state.vocab.books[0].id === SYNC_ID, "sync identity/work survives without a duplicate");
}

async function heldDiscover(page, open = false) {
  await page.goto(at("/discover"));
  const card = page.locator(`[data-word-list="${ID}"]`);
  await card.locator('[data-shelf-state="on"]').waitFor();
  check(await card.locator('[data-shelf-state="off"]').count() === 0, "synced no-record card is already held in Discover");
  await card.locator("[data-card-detail]").click();
  const detail = page.locator(`[data-book-detail="${ID}"]`);
  await detail.locator('[data-detail-action="on"]').waitFor();
  check(await detail.getByRole("button", { name: "Remove from shelf", exact: true }).count() === 1,
    "held detail offers removal rather than another add");
  if (open) {
    await detail.locator('[data-detail-action="on"]').click();
    await waitPairingReady(page);
  } else {
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await detail.waitFor({ state: "hidden" });
  }
}

async function syncedFlow(mobile, trusted) {
  console.log(`\n== real sync, no PackRecord: ${mobile ? "Discover" : "shelf"} -> ${trusted ? "private library" : "own file"}`);
  const test = await newCase(mobile, { synced: true, role: trusted ? "trusted" : "user" });
  const { page } = test;
  try {
    await shelf(page);
    await page.waitForFunction(({ key, id }) => {
      const vocab = JSON.parse(localStorage.getItem(key) || "{}").state;
      const progress = JSON.parse(localStorage.getItem("cibian-progress-v1") || "{}").state?.items;
      return vocab?.books.some((book) => book.id === id) && vocab.words.length === 1 && progress?.[id];
    }, { key: STORAGE, id: SYNC_ID });
    check(test.state.syncPulls > 0, "nonempty account sync was actually pulled");
    const initial = await stored(page, SYNC_ID);
    check(initial.pack === undefined && initial.bodies.length === 0, "sync creates shelf/work but no PackRecord and no body");
    await page.locator("[data-file-missing]").waitFor();
    check(await cards(page).count() === 1, "synced shelf shows one file-needed card");
    const words = (await shelfState(page)).words;
    check(words[0].stage === 3 && words[0].reps === 7 && words[0].sources[0].book === SYNC_KEY, "sync installs real saved-word review/source data");
    await assertSyncedWork(page, words);
    await heldDiscover(page, false);
    check((await stored(page, SYNC_ID)).pack === undefined, "rendering held Discover does not fabricate an install record");
    if (mobile) await heldDiscover(page, true);
    else { await shelf(page); await resumePairing(test, "cover"); }
    if (trusted) await doubleClick(page, "[data-library-open]");
    else await chooseEpub(page);
    await readBook(page, SYNC_ID, "As the sun sank");
    await assertSyncedWork(page, words, true);
    await singleInstall(page, SYNC_ID);
    check((await shelfState(page)).books[0].source === "epub", "registerInstalled marks the original card readable");
    check(test.state.libraryFetches === (trusted ? 1 : 0), "synced pairing respects private-library role and single flight");
    await shelf(page);
    await sameCard(page, SYNC_ID, false);
    cleanNetwork(test);
  } finally {
    await cleanCase(test);
  }
}

async function consentFlow(none) {
  console.log(`\n== ${none ? "no snippets" : "low match"}: cancel, then explicitly continue`);
  const test = await newCase(false, { list: none ? NONE_LIST : LIST });
  const { page } = test;
  try {
    const id = await discoverAdd(test);
    const baseline = await stored(page, id);
    await dismiss(page);
    await shelf(page);
    for (const accept of [false, true]) {
      await resumePairing(test, "title");
      await chooseEpub(page, none ? EPUB : WRONG_EPUB);
      await page.locator('[data-own-epub-phase="confirm"] [data-own-epub-confirm]').waitFor();
      const match = page.locator("[data-match-rate]");
      check(await match.getAttribute("data-match-rate") === (none ? "none" : "0"), "explicit consent uses the expected match category");
      check(await match.getAttribute("data-match-kind") === (none ? "none" : "anchor"), "match data hooks expose none separately from low");
      const before = await stored(page, id);
      check(before.bodies.length === 0 && before.gloss === baseline.gloss, "uncertain preview never installs before consent");
      assert.deepEqual(before.pack, baseline.pack);
      if (!accept) {
        await dismiss(page);
        check((await stored(page, id)).bodies.length === 0, "cancelling explicit consent keeps the card uninstalled");
      } else {
        await doubleClick(page, "[data-own-epub-confirm]");
        await readBook(page, id);
        await singleInstall(page, id);
      }
    }
    cleanNetwork(test);
  } finally {
    await cleanCase(test);
  }
}

async function removeCachedList(page) {
  await page.evaluate((id) => new Promise((resolve, reject) => {
    const request = indexedDB.open("cibian-books");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("notes", "readwrite");
      tx.objectStore("notes").delete(`wordlist:${id}`);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), ID);
}

async function cancellationFlow(trusted) {
  console.log(`\n== cancel ${trusted ? "late private download" : "checking"}, then retry`);
  const test = await newCase(false, { role: trusted ? "trusted" : "user" });
  const { page, state } = test;
  try {
    const id = await discoverAdd(test);
    await dismiss(page);
    await shelf(page);
    await resumePairing(test, "cover");
    if (!trusted) await removeCachedList(page);
    const gate = holdNext(state, trusted ? "libraryGate" : "glossaryGate");
    if (trusted) await doubleClick(page, "[data-library-open]");
    else await chooseEpub(page, EPUB, true);
    await page.locator(`[data-own-epub-phase="${trusted ? "downloading" : "checking"}"]`).waitFor();
    await gate.wait();
    await dismiss(page);
    gate.cancelled = true;
    gate.release();
    // Negative async assertion: allow the deliberately late response and queued browser work to drain.
    await page.waitForTimeout(500);
    check((await stored(page, id)).bodies.length === 0, "cancelled checking/download cannot install late");
    check(await page.locator("[data-own-epub-phase]").count() === 0 && new URL(page.url()).pathname.replace(/\/$/, "") === "/shelf",
      "late result neither reopens the dialog nor navigates to the reader");
    const probe = await page.evaluate(() => window.__pairingProbe);
    check(probe.bodyWrites.length === 0 && probe.reads.length === 0, "cancel leaves no write and no onSaved callback");
    if (trusted) {
      check(state.libraryFetches === 1, "two download clicks share one in-flight request");
      state.libraryFailures = 1;
      await resumePairing(test, "title");
      await page.locator("[data-library-open]").click();
      await page.locator('[data-own-epub-phase="error"] [role="alert"]').waitFor();
      check((await stored(page, id)).bodies.length === 0, "failed private download never installs");
      await page.locator("[data-library-open]").click();
    } else {
      await resumePairing(test, "title");
      await chooseEpub(page);
    }
    await readBook(page, id);
    await singleInstall(page, id);
    cleanNetwork(test);
  } finally {
    await cleanCase(test);
  }
}

async function coverCancellationFlow() {
  console.log("== cancel hanging catalog cover preparation without a saving lock");
  const test = await newCase(false);
  const { page, state } = test;
  try {
    const id = await discoverAdd(test);
    const gate = holdNext(state, "coverGate");
    await chooseEpub(page);
    await gate.wait();
    await page.locator('[data-own-epub-phase="preparing"]').waitFor();
    await dismiss(page);
    gate.cancelled = true; gate.release();
    await page.waitForTimeout(500);
    check((await stored(page, id)).bodies.length === 0, "cancelled cover preparation leaves no body");
    const probe = await page.evaluate(() => window.__pairingProbe);
    check(probe.bodyWrites.length === 0 && probe.reads.length === 0, "late cover never writes or opens the reader");
    cleanNetwork(test);
  } finally { await cleanCase(test); }
}

async function syncedDeletionFlow() {
  console.log("== sync deletion and same-id recreation invalidate a waiting pairing task");
  const test = await newCase(false, { synced: true, role: "trusted" });
  const { page, state, remote } = test;
  try {
    await shelf(page);
    await page.waitForFunction(({key,id}) => JSON.parse(localStorage.getItem(key) || "{}").state?.books.some(book => book.id === id), {key:STORAGE,id:SYNC_ID});
    await resumePairing(test, "cover");
    const gate = holdNext(state, "libraryGate");
    await page.locator("[data-library-open]").click(); await gate.wait();
    remote.set(`shelf:${SYNC_KEY}`, {kind:"shelf",itemId:SYNC_KEY,updatedAt:Date.now()+10000,deleted:true,data:{}});
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(({key,id}) => !JSON.parse(localStorage.getItem(key) || "{}").state?.books.some(book => book.id === id), {key:STORAGE,id:SYNC_ID});
    const recreated = syncFixture().find(item => item.kind === "shelf");
    remote.set(`shelf:${SYNC_KEY}`, {...recreated,updatedAt:Date.now()+20000});
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(({key,id}) => JSON.parse(localStorage.getItem(key) || "{}").state?.books.some(book => book.id === id), {key:STORAGE,id:SYNC_ID});
    gate.release(); await page.waitForTimeout(700);
    const probe = await page.evaluate(() => window.__pairingProbe);
    check(probe.bodyWrites.length === 0 && probe.reads.length === 0, "deleted and recreated id rejects the old download generation");
    check((await stored(page, SYNC_ID)).bodies.length === 0, "no late body survives sync delete/recreate");
    check((await shelfState(page)).books.filter(book => book.id === SYNC_ID).length === 1, "only the newly synced original id remains");
    cleanNetwork(test);
  } finally { await cleanCase(test); }
}

async function saveRetryFlow() {
  console.log("\n== automatic save failure -> retry retained preview");
  const test = await newCase(false);
  const { page } = test;
  try {
    const id = await discoverAdd(test);
    await page.evaluate(() => { window.__pairingProbe.failBodyWrites = 1; });
    await chooseEpub(page);
    await page.locator('[data-own-epub-phase="error"] [data-own-epub-retry]').waitFor();
    check((await stored(page, id)).bodies.length === 0, "storage failure is visible without installing a body");
    check((await page.evaluate(() => window.__pairingProbe.reads)).length === 0, "storage failure never calls onSaved");
    const fetches = test.state.glossaryFetches;
    await doubleClick(page, "[data-own-epub-retry]");
    await readBook(page, id);
    const probe = await page.evaluate(() => window.__pairingProbe);
    assert.deepEqual(probe.bodyWrites, [id, id], "one failed attempt then one retry write, despite a repeated click");
    check(probe.reads.length === 1 && test.state.glossaryFetches === fetches, "retry reuses its checked preview and opens the reader once");
    await sameCard(page, id, false);
    cleanNetwork(test);
  } finally {
    await cleanCase(test);
  }
}

async function legacyFlow() {
  console.log("\n== legacy notes without an EPUB requirement");
  const test = await newCase(false, { legacy: true });
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
  await firstDiscoverFlow(false, false);
  await firstDiscoverFlow(true, true);
  await syncedFlow(false, false);
  await syncedFlow(true, false);
  await syncedFlow(false, true);
  await syncedFlow(true, true);
  await consentFlow(false);
  await consentFlow(true);
  await cancellationFlow(false);
  await cancellationFlow(true);
  await coverCancellationFlow();
  await syncedDeletionFlow();
  await saveRetryFlow();
  await legacyFlow();
  console.log(`\n${checks} shelf-pairing checks passed (${BASE.origin}).`);
} catch (error) {
  console.error(`\nFAIL after ${checks} checks:`, error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
