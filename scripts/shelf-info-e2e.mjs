#!/usr/bin/env node
/**
 * Offline Shelf / Book info regression: five synthetic cards, seven checks per viewport.
 * Attach to a finished build; never starts a server. Requires Playwright and Chrome.
 *   E2E_URL=http://127.0.0.1:8090 CHROME=/path/to/chrome node scripts/shelf-info-e2e.mjs
 *   node scripts/shelf-info-e2e.mjs http://127.0.0.1:8090/
 * All prose/data below is original CC0 fixture material, not a real book or account.
 * No EPUBs, repo book snapshots, app-module imports, or live services are read.
 * localStorage and valid parsed-book IDB records exist only in disposable contexts.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8090/");
const at = (path) => new URL(path, BASE).href;
const STORAGE = "cibian-notebook-v1";
const TIME = 1_790_000_000_000;
const AUTHOR = "Fixture Writer";
const REASON = "Original fixture language uses old forms of address.";
const SERIES = "Harbor Fixture Collection";
const ISBN = "9780000000002";
const baseBook = (id, title, details) => ({
  id, title, author: AUTHOR, source: "epub", cloth: "sage",
  createdAt: TIME, updatedAt: TIME, ...details,
});
const BOOKS = [
  baseBook("info-harbor", "Harbor", {
    lexile: "640L", isbn: ISBN, series: SERIES, seriesNumber: 2, matchRate: 100,
    oldFashioned: true, oldFashionedReason: REASON,
  }),
  baseBook("info-long", "A Remarkably Long Original Fixture Title Across Many Narrow Lines", { matchRate: 80 }),
  baseBook("info-needs", "Waiting Fixture", { source: "notes", needsEpub: true, matchRate: 0 }),
  baseBook("info-missing", "Missing Fixture", { matchRate: 79 }),
  baseBook("info-notes", "Notes Fixture", { author: "", source: "notes", matchRate: 101 }),
];
// Explicit keys rather than importing the implementation under test.
const KEYS = { "info-harbor": "book:harbor|fixturewriter", "info-needs": "book:waitingfixture|fixturewriter" };
function word(id, bookId, dueAt, secondSource = false) {
  const book = BOOKS.find((item) => item.id === bookId);
  const sentence = `An original fixture sentence contains ${id}.`;
  const source = { book: KEYS[bookId], title: book.title, author: book.author, sentence, surface: id, savedAt: TIME };
  return {
    id, surface: id, lemma: id, pos: "noun", meaning: "An original regression fixture.",
    whyHard: "", recommend: false, sentence, stage: 0, dueAt, createdAt: TIME, reps: 0, lapses: 0,
    // Two occurrences of one word must not turn the 2-due menu count into 3.
    sources: secondSource ? [source, { ...source, sentence: `Another fixture sentence contains ${id}.` }] : [source],
  };
}
const WORDS = [
  word("fixturealpha", "info-harbor", 1, true), word("fixturebeta", "info-harbor", 1),
  word("fixturegamma", "info-harbor", Number.MAX_SAFE_INTEGER), word("fixturedelta", "info-needs", 1),
];
const PUBLIC_CATALOG = { format: 1, name: "CC0 synthetic fixtures", updated: "2026-10-01", packs: [{
  ...BOOKS[0], rev: "fixture-v1", version: 2, words: 777,
  epub: { url: "info-harbor/book.epub", bytes: 1, sha256: "0".repeat(64) },
  glossary: { url: "info-harbor/glossary.json", bytes: 1, sha256: "0".repeat(64) },
}] };

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok ${label}`);
}
async function eventually(read, test, label) {
  const deadline = Date.now() + 10000;
  let value;
  do {
    value = await read();
    if (test(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  assert.fail(`${label}; last value: ${JSON.stringify(value)}`);
}
const cards = (page) => page.locator("li.book-card");
const cardFor = (page, book) => cards(page).filter({ has: page.getByRole("button", { name: book.title, exact: true }) });
const info = (page) => page.getByRole("dialog", { name: "Book info", exact: true });

async function newCase(browser, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: mobile, hasTouch: mobile, locale: "en-US", serviceWorkers: "block",
  });
  const state = { unexpected: [], errors: [], catalogRequests: 0 };
  try {
    await context.addInitScript(() => {
      localStorage.setItem("cibian-locale-v1", "en");
      window.__shelfInfoFetches = [];
      const originalFetch = window.fetch;
      window.fetch = function (input, init) {
        window.__shelfInfoFetches.push({ url: String(input?.url ?? input), method: init?.method ?? input?.method ?? "GET" });
        return originalFetch.apply(this, arguments);
      };
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      const fixtureHost = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
      if (fixtureHost && path === "/public-books/catalog.json") {
        state.catalogRequests += 1;
        return json(PUBLIC_CATALOG);
      }
      if (fixtureHost && path === "/word-lists/catalog.json") return json({ lists: [] });
      if (fixtureHost && path === "/word-lists/discover-rails.json") return json({ rails: [] });
      if (fixtureHost && path === "/contributors.json") return json({ people: [], books: {} });
      if (url.origin === BASE.origin && path === "/api/auth/me") return json({ user: null });
      if (url.origin === BASE.origin && path === "/api/sync") return json({ items: [] });
      if (url.origin === BASE.origin && path === "/api/qq-groups") return json({ saved: true, groups: [] });
      if (url.origin === BASE.origin && path === "/api/analytics/word-taps") return json({ ok: true });
      if (url.origin === BASE.origin && path === "/__shelf-info-fixture__") {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>CC0 fixture setup</title>" });
      }
      // The app prefetches its static /admin page shell. This exact same-origin GET
      // exception is not an API/auth exception and admits no book content or external hosts.
      if (url.origin === BASE.origin && request.method() === "GET" && path === "/admin") return route.continue();
      // Only app code/assets may reach the supplied server. Never pass through book/API requests.
      const appAsset = /^(?:\/assets\/|\/src\/|\/node_modules\/|\/@vite\/|\/@id\/|\/@fs\/|\/@react-refresh$)/.test(path)
        || /\.(?:js|mjs|css|woff2?|ttf|ico|svg|png|webmanifest)$/.test(path);
      if (url.origin === BASE.origin && !/^\/(?:api|word-lists|public-books|packs)(?:\/|$)/.test(path)
        && (path === "/shelf" || path === "/notebook" || appAsset)) return route.continue();
      state.unexpected.push(`${request.method()} ${url.href}`);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => state.errors.push(error.message));
    // Seed at the same origin before the app starts, avoiding asynchronous init-script/IDB races.
    await page.goto(at("/__shelf-info-fixture__"));
    await page.evaluate(async ({ books, words, storage, time }) => {
      localStorage.setItem(storage, JSON.stringify({ version: 0, state: { books, words, log: {} } }));
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("cibian-books", 3);
        request.onupgradeneeded = () => {
          for (const store of ["books", "covers", "notes"]) request.result.createObjectStore(store);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["books", "notes"], "readwrite");
          for (const book of books.slice(0, 2)) {
            const body = { id: book.id, title: book.title, author: book.author,
              chapters: [{ title: "Original fixture chapter", paragraphs: ["Only original CC0 regression prose is stored here."] }],
              glossary: {}, pending: [], totalHard: 0 };
            tx.objectStore("books").put(body, book.id);
            tx.objectStore("notes").put({ id: book.id, title: book.title, author: book.author,
              glossary: {}, pending: [], totalHard: 0 }, `gloss:${book.id}`);
          }
          tx.objectStore("notes").put({ packId: books[0].id, bookId: books[0].id,
            rev: "fixture-v1", sha256: "0".repeat(64), installedAt: time }, `pack:${books[0].id}`);
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error || new Error("fixture IDB transaction aborted"));
        });
      } finally { db.close(); }
    }, { books: BOOKS, words: WORDS, storage: STORAGE, time: TIME });
    await page.goto(at("/shelf"));
    await cards(page).nth(BOOKS.length - 1).waitFor();
    await cardFor(page, BOOKS[3]).locator("[data-file-missing]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    return { context, page, state, mobile };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function openMenu(test, book, verifyFirstTap = false) {
  const { page, mobile } = test;
  const trigger = cardFor(page, book).locator("[data-shelf-more]");
  await trigger.scrollIntoViewIfNeeded();
  if (mobile) {
    await trigger.tap();
    if (verifyFirstTap) {
      assert.equal(await trigger.getAttribute("data-shelf-arm"), "", "first phone tap arms the corner trigger");
      assert.equal(await page.getByRole("menu").count(), 0, "first phone tap does not open a menu");
      assert.equal(await page.getByRole("dialog").count(), 0, "first phone tap does not open Book info");
    }
    await trigger.tap();
  } else await trigger.click();
  await page.getByRole("menu").waitFor();
  return trigger;
}
async function openInfo(test, book) {
  const trigger = await openMenu(test, book);
  await test.page.locator("[data-shelf-info-menu]").click();
  await info(test.page).waitFor();
  assert.equal(await test.page.getByRole("menu").count(), 0, "menu hands focus to the dialog and unmounts");
  return trigger;
}
async function closeInfo(page, trigger, escape = false) {
  if (escape) await page.keyboard.press("Escape");
  else await info(page).getByRole("button", { name: "Close", exact: true }).click();
  await info(page).waitFor({ state: "hidden" });
  await eventually(() => trigger.evaluate((element) => document.activeElement === element), Boolean,
    "closing Book info returns focus to its own three-dot trigger");
}
async function rowText(page, hook) {
  const row = info(page).locator(`[data-info-${hook}]`);
  await row.waitFor();
  return row.locator("dd").innerText();
}

async function run(browser, mobile) {
  const test = await newCase(browser, mobile);
  const { context, page, state } = test;
  const label = mobile ? "mobile" : "desktop";
  console.log(`\n== shelf info / ${label}`);
  try {
    // 1. Default cards keep facts out, including positive due and healthy matches.
    assert.equal(await cards(page).count(), BOOKS.length);
    for (const book of BOOKS) {
      const card = cardFor(page, book);
      assert.equal(await card.count(), 1);
      assert.equal(await card.locator("[data-classic-label], [data-lexile], [data-isbn], [data-series-label], [data-shelf-menu-due], [data-shelf-book-info]").count(), 0);
      assert.doesNotMatch(await card.innerText(), /\bdue\b|Lexile|640L|ISBN|9780000000002|Harbor Fixture Collection|Public domain|Match (?:80|100)%/i);
    }
    // The genuine notes-only legacy cue is not routine book metadata and must survive.
    assert.equal(await cardFor(page, BOOKS[4]).locator("[data-card-actions]").innerText(), "Sample notebook");
    assert.equal(await cardFor(page, BOOKS[2]).locator("[data-card-actions]").count(), 0);
    check(`${label}: five default cards hide routine facts/due and preserve the notes-only cue`);

    // 2. Compare real DOM geometry by cover row, including the phone's second row.
    const slots = await cards(page).evaluateAll((items) => items.map((card) => {
      const title = card.querySelector('button[lang="en"]');
      const author = title.parentElement.nextElementSibling;
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      };
      return { cover: rect(card.firstElementChild), title: rect(title), author: rect(author),
        titleAlign: getComputedStyle(title).textAlign, authorAlign: getComputedStyle(author).textAlign };
    }));
    for (const slot of slots) {
      assert.ok(slot.title.width > 0 && slot.author.height >= 15);
      assert.ok(Math.abs(slot.title.left - slot.author.left) <= 1, "title and author share a left edge");
      assert.equal(slot.titleAlign, "left");
      assert.ok(["left", "start"].includes(slot.authorAlign));
    }
    const sameRow = slots.filter((slot) => Math.abs(slot.cover.top - slots[0].cover.top) <= 1);
    assert.ok(sameRow.length >= 3, "multiple cards share the first grid row");
    assert.ok(Math.max(...sameRow.map((slot) => slot.title.top)) - Math.min(...sameRow.map((slot) => slot.title.top)) <= 1);
    assert.ok(Math.max(...sameRow.map((slot) => slot.author.top)) - Math.min(...sameRow.map((slot) => slot.author.top)) <= 1,
      "short and long titles reserve equal title slots");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${label}: short/long titles and authors align without horizontal overflow`);

    // 3. Actionable warnings survive; 80 is healthy, while zero is a real low match.
    assert.equal(await cardFor(page, BOOKS[0]).locator("[data-old-fashioned]").innerText(), "Old-fashioned");
    assert.match(await cardFor(page, BOOKS[0]).locator("[data-old-fashioned]").getAttribute("title"), /old forms of address/);
    assert.equal(await cardFor(page, BOOKS[2]).locator("[data-needs-epub]").innerText(), "Needs your e-book");
    assert.equal(await cardFor(page, BOOKS[2]).locator("[data-file-missing]").count(), 0);
    assert.equal(await cardFor(page, BOOKS[2]).locator("[data-shelf-low-match]").innerText(), "Low word-list match: 0%");
    assert.equal(await cardFor(page, BOOKS[3]).locator("[data-file-missing]").innerText(), "Book file needed");
    assert.equal(await cardFor(page, BOOKS[3]).locator("[data-shelf-low-match]").innerText(), "Low word-list match: 79%");
    for (const book of [BOOKS[0], BOOKS[1], BOOKS[4]]) {
      assert.equal(await cardFor(page, book).locator("[data-shelf-low-match], [data-file-missing], [data-needs-epub]").count(), 0);
    }
    check(`${label}: needs-file, missing-file, old-language and low-match warnings remain`);

    const beforeFetches = await page.evaluate(() => window.__shelfInfoFetches.slice());
    const beforeStorage = await page.evaluate((key) => localStorage.getItem(key), STORAGE);
    // 4. Real phone taps exercise arming, not synthesized clicks/eval.
    const trigger = await openMenu(test, BOOKS[0], true);
    assert.equal(await page.locator("[data-shelf-info-menu]").innerText(), "Book info");
    assert.equal(await page.locator("[data-shelf-menu-due]").innerText(), "2 due");
    await page.locator("[data-shelf-info-menu]").click();
    await info(page).waitFor();
    await eventually(() => info(page).evaluate((element) => element.contains(document.activeElement)), Boolean,
      "Book info owns focus after menu selection");
    assert.equal(await page.getByRole("menu").count(), 0);
    await closeInfo(page, trigger);
    const keyboardTrigger = await openInfo(test, BOOKS[0]);
    await closeInfo(page, keyboardTrigger, true);
    check(`${label}: ${mobile ? "first tap arms, second opens; " : "three-dot entry opens; "}button/Escape closing restores focus`);

    // 5. Full saved facts and caveat: even a saved 100% is not edition verification.
    const fullTrigger = await openInfo(test, BOOKS[0]);
    assert.equal(await info(page).locator("h3").innerText(), BOOKS[0].title);
    assert.equal(await info(page).getByText("Details saved on this device.", { exact: true }).count(), 1);
    assert.equal(await rowText(page, "author"), AUTHOR);
    assert.equal(await rowText(page, "series"), `${SERIES} · Book 2`);
    assert.equal(await rowText(page, "lexile"), "640L");
    assert.equal(await rowText(page, "isbn"), ISBN);
    assert.equal(await info(page).locator('[data-info-match="100"]').count(), 1);
    assert.match(await rowText(page, "match"), /Match 100%/);
    assert.match(await rowText(page, "match"), /not proof of a verified edition/);
    assert.match(await rowText(page, "match"), /no snippets to compare/);
    assert.equal(await info(page).locator('[data-info-due="2"]').count(), 1);
    assert.equal(await rowText(page, "due"), "2 due");
    assert.equal(await rowText(page, "file"), "On this device");
    assert.equal(await rowText(page, "public-domain"), "Public domain");
    assert.match(await rowText(page, "old-fashioned"), /Not recommended for beginners/);
    assert.ok((await rowText(page, "old-fashioned")).includes(REASON));
    await closeInfo(page, fullTrigger);
    check(`${label}: Book info shows complete saved facts, due count and non-verification caveat`);

    // 6. Zero must not disappear via truthiness; sparse/invalid fields are omitted.
    const zeroTrigger = await openInfo(test, BOOKS[2]);
    assert.equal(await info(page).locator('[data-info-match="0"]').count(), 1);
    assert.match(await rowText(page, "match"), /Match 0%/);
    assert.equal(await rowText(page, "file"), "Needs your e-book");
    await closeInfo(page, zeroTrigger);
    const missingTrigger = await openInfo(test, BOOKS[3]);
    assert.equal(await rowText(page, "file"), "Book file needed");
    await closeInfo(page, missingTrigger);
    const sparseTrigger = await openInfo(test, BOOKS[4]);
    assert.equal(await rowText(page, "file"), "Notebook only; no e-book attached");
    assert.equal(await info(page).locator('[data-info-due="0"]').count(), 1);
    assert.equal(await rowText(page, "due"), "0 due");
    assert.equal(await info(page).locator("[data-info-author], [data-info-series], [data-info-lexile], [data-info-isbn], [data-info-match], [data-info-public-domain], [data-info-old-fashioned]").count(), 0);
    assert.doesNotMatch(await info(page).innerText(), /undefined|NaN|Match 101%/);
    await closeInfo(page, sparseTrigger);
    await page.waitForLoadState("networkidle");
    assert.deepEqual(await page.evaluate(() => window.__shelfInfoFetches), beforeFetches,
      "Book info must not issue any fetch, including catalog, blurb or book content");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE), beforeStorage,
      "reading Book info must not mutate saved shelf/word state");
    check(`${label}: zero/missing/sparse facts are truthful; info adds no fetch or shelf writes`);

    // 7. Positive due stays in Words; zero stays quiet; navigation scopes unique saved words.
    await openMenu(test, BOOKS[1]);
    assert.equal(await page.locator("[data-shelf-menu-due]").count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await openMenu(test, BOOKS[0]);
    const wordsItem = page.getByRole("menuitem", { name: /Words from this book/ });
    assert.equal(await wordsItem.locator("[data-shelf-menu-due]").innerText(), "2 due");
    await wordsItem.click();
    await page.locator("#word-book").waitFor();
    assert.equal(await page.locator("#word-book").inputValue(), BOOKS[0].id);
    assert.equal(await page.locator(`#word-book option[value="${BOOKS[0].id}"]`).innerText(), `${BOOKS[0].title} (3)`);
    await page.getByRole("button", { name: "Start review (2)", exact: true }).waitFor();
    check(`${label}: Words shows two due, no zero badge, and three unique saved words in scope`);

    assert.ok(state.catalogRequests > 0, "public-domain provenance came from the mocked catalog");
    assert.deepEqual(state.unexpected, [], `${label}: no unmocked external/API/book requests`);
    assert.deepEqual(state.errors, [], `${label}: no page errors`);
  } finally { await context.close(); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome", chromiumSandbox: true,
});
try {
  await run(browser, false);
  await run(browser, true);
  console.log(`\nPASS: ${checks} Shelf / Book info checks; all fixtures were disposable and offline.`);
} finally { await browser.close(); }
