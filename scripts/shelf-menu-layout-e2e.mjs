#!/usr/bin/env node
/**
 * Offline Shelf menu / Book info layout regression. Attaches; never starts/builds a server.
 *   node scripts/shelf-menu-layout-e2e.mjs [http://127.0.0.1:8096/]
 *   CHROME=/path/to/chrome E2E_URL=http://127.0.0.1:8090/ node scripts/shelf-menu-layout-e2e.mjs
 * Uses shelf-info-e2e.mjs's disposable localStorage + parsed-book IDB fixture pattern.
 * All prose is original CC0 fixture text; all API/catalog/book requests are mocked or blocked.
 * Native and TEST-ONLY unsupported-gutter simulation at 1280 / 768 / 390, long and short.
 * Overlay is only claimed after an overflowing document measures a ZERO-pixel scrollbar.
 * Fallback simulation prunes gutter @supports in CSSOM at load and forces gutter:auto.
 * This tests the fallback path in current Chrome, NOT an actual unsupported browser engine.
 * No screenshots, report files, EPUBs, app imports, real books or production calls are used.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8096/");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(BASE.hostname), "Only a local running server is allowed");
const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
].find(existsSync);
assert.ok(CHROME, "Install local Google Chrome or set CHROME to its executable path");
const STORAGE = "cibian-notebook-v1";
const TIME = 1_790_000_000_000;
const TOLERANCE = 1;
const VIEWPORTS = [
  { name: "desktop1280", width: 1280, height: 1000, mobile: false },
  { name: "tablet768", width: 768, height: 1024, mobile: false },
  { name: "mobile390", width: 390, height: 844, mobile: true },
];
const MODES = [
  { name: "classic", args: ["--disable-features=OverlayScrollbar"], expectedGap: 15 },
  { name: "overlay", args: ["--enable-features=OverlayScrollbar,OverlayScrollbars,FluentOverlayScrollbar"], expectedGap: 0 },
];
const results = [];
const fixtureBooks = (long) => Array.from({ length: long ? 48 : 2 }, (_, index) => ({
  id: `layout-fixture-${index}`, title: `Harbor Fixture ${String(index + 1).padStart(2, "0")}`,
  author: "Original Fixture Writer", source: "epub", cloth: "sage", lexile: "640L",
  createdAt: TIME - index, updatedAt: TIME - index,
}));
const menu = (page) => page.getByRole("menu");
const info = (page) => page.getByRole("dialog", { name: "Book info", exact: true });
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function focused(page) {
  await page.waitForFunction(() => document.activeElement === document.querySelector("li.book-card [data-shelf-more]"));
}

async function newCase(browser, viewport, long, fallback) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile, hasTouch: viewport.mobile, deviceScaleFactor: 1,
    locale: "en-US", serviceWorkers: "block", reducedMotion: "reduce",
  });
  const state = { unexpected: [], errors: [], mocked: 0 };
  try {
    await context.addInitScript(({ fallback }) => {
      localStorage.setItem("cibian-locale-v1", "en");
      localStorage.setItem("cibian-site-notice-v1", "hidden");
      window.__layoutFallback = { simulated: fallback, removedSupports: 0 };
      if (!fallback) return;
      // TEST ONLY: JS CSS.supports() monkey-patching does NOT change CSS @supports.
      // Prune actual gutter branches, including nested @layer / @media, before app mount.
      const rewrite = (container) => {
        let rules;
        try { rules = container.cssRules; } catch { return; }
        if (!rules) return;
        for (let index = rules.length - 1; index >= 0; index--) {
          const rule = rules[index];
          if (rule instanceof CSSSupportsRule && /scrollbar-gutter/.test(rule.conditionText)) {
            const children = /^not\b/.test(rule.conditionText.trim()) ? [...rule.cssRules].map((child) => child.cssText) : [];
            container.deleteRule(index);
            for (const text of children.reverse()) container.insertRule(text, index);
            window.__layoutFallback.removedSupports += 1;
          } else if (rule.cssRules) rewrite(rule);
        }
      };
      const apply = () => {
        for (const sheet of document.styleSheets) rewrite(sheet);
        if (!document.documentElement || document.querySelector("[data-test-gutter-fallback]")) return;
        const style = document.createElement("style");
        style.setAttribute("data-test-gutter-fallback", "");
        style.textContent = "html { scrollbar-gutter: auto !important; }";
        document.documentElement.append(style);
      };
      new MutationObserver(apply).observe(document, { childList: true, subtree: true, characterData: true });
      document.addEventListener("load", apply, true);
      document.addEventListener("DOMContentLoaded", apply, { once: true });
      apply();
    }, { fallback });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const json = (body) => {
        state.mocked += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      };
      const fixtureHost = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
      if (fixtureHost && path === "/public-books/catalog.json") return json({ format: 1, name: "CC0 layout fixtures", packs: [] });
      if (fixtureHost && path === "/word-lists/catalog.json") return json({ lists: [] });
      if (fixtureHost && path === "/word-lists/discover-rails.json") return json({ rails: [] });
      if (fixtureHost && path === "/contributors.json") return json({ people: [], books: {} });
      if (url.origin === BASE.origin && path === "/api/auth/me") return json({ user: null });
      if (url.origin === BASE.origin && path === "/api/sync") return json({ items: [] });
      if (url.origin === BASE.origin && path === "/api/qq-groups") return json({ saved: true, groups: [] });
      if (url.origin === BASE.origin && path === "/api/analytics/word-taps") return json({ ok: true });
      if (url.origin === BASE.origin && path === "/__shelf-layout-fixture__") {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Original CC0 fixture setup</title>" });
      }
      // Exact same-origin static shell prefetch, not an API or book exception.
      if (url.origin === BASE.origin && request.method() === "GET" && path === "/admin") return route.continue();
      const appAsset = /^(?:\/assets\/|\/src\/|\/node_modules\/|\/@vite\/|\/@id\/|\/@fs\/|\/@react-refresh$)/.test(path)
        || /\.(?:js|mjs|css|woff2?|ttf|ico|svg|png|webmanifest)$/.test(path);
      if (url.origin === BASE.origin && request.method() === "GET"
        && !/^\/(?:api|books|word-lists|public-books|packs)(?:\/|$)/.test(path)
        && (path === "/shelf" || appAsset)) return route.continue();
      state.unexpected.push(`${request.method()} ${url.href}`);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => state.errors.push(error.message));
    await page.goto(new URL("/__shelf-layout-fixture__", BASE).href);
    const books = fixtureBooks(long);
    await page.evaluate(async ({ books, storage }) => {
      localStorage.setItem(storage, JSON.stringify({ version: 0, state: { books, words: [], log: {} } }));
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
          for (const book of books) {
            tx.objectStore("books").put({ id: book.id, title: book.title, author: book.author,
              chapters: [{ title: "Original fixture chapter", paragraphs: ["Only original regression fixture prose appears here."] }],
              glossary: {}, pending: [], totalHard: 0 }, book.id);
            tx.objectStore("notes").put({ id: book.id, title: book.title, author: book.author,
              glossary: {}, pending: [], totalHard: 0 }, `gloss:${book.id}`);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error || new Error("fixture IDB transaction aborted"));
        });
      } finally { db.close(); }
    }, { books, storage: STORAGE });
    await page.goto(new URL("/shelf", BASE).href);
    await page.locator("li.book-card").nth(books.length - 1).waitFor();
    await page.locator("[data-shelf-search]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator("li.book-card").count(), books.length);
    // Finish intentional positioning BEFORE baseline; helper scrolling is not lock drift.
    const trigger = page.locator("li.book-card").first().locator("[data-shelf-more]");
    await trigger.scrollIntoViewIfNeeded();
    await page.evaluate((long) => window.scrollTo({ top: long ? Math.min(120, scrollY + 120) : 0, behavior: "instant" }), long);
    await settle(page);
    return { context, page, state, trigger };
  } catch (error) { await context.close(); throw error; }
}

// RAF samples include intermediate menu->dialog unlock/relock frames, not only final states.
async function monitor(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout target: ${selector}`);
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width };
    };
    const snapshot = () => {
      const root = document.documentElement, body = document.body;
      return {
        scrollY, scrollX, innerWidth, clientWidth: root.clientWidth, bodyWidth: body.clientWidth,
        scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
        gutter: getComputedStyle(root).scrollbarGutter,
        rootRectGutter: innerWidth - root.getBoundingClientRect().width,
        viewportScrollbar: innerWidth - root.clientWidth,
        bodyMarginRight: getComputedStyle(body).marginRight,
        bodyOverflowY: getComputedStyle(body).overflowY,
        locked: body.hasAttribute("data-scroll-locked"),
        header: rect("header > div"), card: rect("li.book-card"),
        title: rect('li.book-card button[lang="en"]'), search: rect("[data-shelf-search]"),
      };
    };
    const baseline = snapshot();
    const run = window.__shelfLayout = { baseline, samples: [], phase: "baseline", active: true, snapshot };
    const tick = () => {
      if (!run.active) return;
      run.samples.push({ phase: run.phase, ...snapshot() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return baseline;
  });
}
async function phase(page, name) { await page.evaluate((name) => { window.__shelfLayout.phase = name; }, name); }
async function snapshot(page) { return page.evaluate(() => window.__shelfLayout.snapshot()); }
async function openMenu(test, mobile) {
  const { page, trigger } = test;
  if (mobile) {
    await trigger.tap();
    assert.equal(await trigger.getAttribute("data-shelf-arm"), "", "first phone tap arms the trigger");
    assert.equal(await menu(page).count(), 0, "first phone tap must NOT open the menu");
    assert.equal(await info(page).count(), 0, "first phone tap must NOT open Book info");
    await trigger.tap();
  } else await trigger.click();
  await menu(page).waitFor();
  await page.waitForFunction(() => document.body.hasAttribute("data-scroll-locked"));
  await settle(page);
}
async function outside(test, mobile) {
  // Empty left page margin, not a control or scrollbar; Radix handles the real native event.
  const { page } = test;
  const position = { x: 2, y: page.viewportSize().height - 16 };
  if (mobile) await page.touchscreen.tap(position.x, position.y);
  else await page.mouse.click(position.x, position.y);
}
function differences(baseline, sample) {
  const changes = [];
  for (const target of ["header", "card", "title", "search"]) {
    for (const key of ["x", "width"]) {
      const from = baseline[target][key], to = sample[target][key];
      if (Math.abs(to - from) > TOLERANCE) changes.push(`${target}.${key} ${from}->${to} (delta ${to - from}px)`);
    }
  }
  for (const key of ["scrollY", "scrollX"]) {
    if (Math.abs(sample[key] - baseline[key]) > TOLERANCE) changes.push(`${key} ${baseline[key]}->${sample[key]}`);
  }
  return changes;
}
async function run(browser, mode, viewport, long, fallback) {
  const label = `${mode.name}/${viewport.name}/${long ? "long-scrollable" : "short-not-scrollable"}/${fallback ? "TEST-ONLY-unsupported-gutter" : "native-gutter"}`;
  let test;
  const record = { label, failures: [], states: {} };
  try {
    test = await newCase(browser, viewport, long, fallback);
    const { page, state } = test;
    record.baseline = await monitor(page);
    assert.equal(record.baseline.scrollHeight > record.baseline.clientHeight + 1, long, "fixture must actually have the requested scrollability");
    if (long) {
      assert.ok(record.baseline.scrollY > 0, "long shelf must test preservation at nonzero scrollY");
      const expectedGap = viewport.mobile ? 0 : mode.expectedGap;
      assert.equal(record.baseline.viewportScrollbar, expectedGap, "each long fixture must verify its actual viewport scrollbar mode");
    }
    if (fallback) assert.equal(record.baseline.gutter, "auto", "test-only unsupported baseline must not reserve a gutter");
    const save = async (name, locked) => {
      await settle(page);
      const value = await snapshot(page);
      record.states[name] = value;
      assert.equal(value.locked, locked, `${name}: actual Radix scroll-lock state`);
      if (locked) {
        assert.equal(value.bodyOverflowY, "hidden", `${name}: background remains scroll-locked`);
        assert.equal(value.viewportScrollbar, 0, `${name}: visible viewport scrollbar is removed, not confused with reserved gutter`);
        if (mode.name === "classic" && !viewport.mobile && !fallback) {
          assert.equal(value.rootRectGutter, 15, `${name}: stable gutter survives while visible scrollbar is hidden`);
        }
        if (fallback && long && mode.name === "classic" && !viewport.mobile) {
          assert.equal(value.bodyMarginRight, "15px", `${name}: unsupported simulation preserves original Radix compensation`);
        }
      }
    };
    const dismiss = async (name, dialog = false, method = "escape") => {
      await phase(page, name);
      if (method === "outside") await outside(test, viewport.mobile);
      else if (method === "close") await info(page).getByRole("button", { name: "Close", exact: true }).click();
      else await page.keyboard.press("Escape");
      await (dialog ? info(page) : menu(page)).waitFor({ state: "hidden" });
      await focused(page);
      await save(name, false);
    };
    const show = async (name) => {
      await phase(page, name);
      await openMenu(test, viewport.mobile);
      assert.equal(await page.getByRole("dialog").count(), 0);
      await save(name, true);
    };
    await show("menu-open");
    await dismiss("menu-Escape");
    await show("menu-outside-open");
    await dismiss("menu-outside-click", false, "outside");
    for (const method of ["close", "escape", "outside"]) {
      await show(`info-${method}-menu`);
      await phase(page, `menu-to-info-${method}`);
      if (viewport.mobile) await page.locator("[data-shelf-info-menu]").tap();
      else await page.locator("[data-shelf-info-menu]").click();
      await info(page).waitFor();
      assert.equal(await menu(page).count(), 0, "menu must unmount during dialog handoff");
      await page.waitForFunction(() => document.querySelector("[data-shelf-book-info]")?.contains(document.activeElement));
      await save(`info-${method}-open`, true);
      await dismiss(`info-${method}-dismiss`, true, method);
    }
    const samples = await page.evaluate(() => {
      window.__shelfLayout.active = false;
      return window.__shelfLayout.samples;
    });
    record.frames = samples.length;
    const all = [...samples, ...Object.entries(record.states).map(([phase, value]) => ({ phase, ...value }))];
    record.maxDelta = Math.max(0, ...all.flatMap((sample) => [
      ...["header", "card", "title", "search"].flatMap((target) => ["x", "width"].map((key) => Math.abs(sample[target][key] - record.baseline[target][key]))),
      Math.abs(sample.scrollY - record.baseline.scrollY), Math.abs(sample.scrollX - record.baseline.scrollX),
    ]));
    for (const sample of all) {
      const drift = differences(record.baseline, sample);
      if (drift.length && !record.failures.some((message) => message.startsWith(`${sample.phase}:`))) record.failures.push(`${sample.phase}: ${drift.join("; ")}`);
    }
    assert.deepEqual(state.unexpected, [], "No unmocked API/book/external requests allowed");
    assert.deepEqual(state.errors, [], "No page errors");
    assert.ok(state.mocked > 0, "fixture routes must have been exercised");
    record.fallback = await page.evaluate(() => window.__layoutFallback);
  } catch (error) { record.failures.push(error.stack || String(error)); }
  finally { if (test) await test.context.close(); }
  results.push(record);
  const brief = (value) => value && ({ scrollY: value.scrollY, header: value.header, card: value.card,
    title: value.title, search: value.search, rootClient: value.clientWidth, bodyWidth: value.bodyWidth,
    bodyMarginRight: value.bodyMarginRight, viewportScrollbar: value.viewportScrollbar,
    scrollableContent: value.scrollHeight > value.clientHeight + 1,
    visibleClassicScrollbar: value.viewportScrollbar > 0 && value.scrollHeight > value.clientHeight + 1 && value.bodyOverflowY !== "hidden",
    rootRectGutter: value.rootRectGutter, bodyOverflowY: value.bodyOverflowY, locked: value.locked });
  console.log(`${record.failures.length ? "FAIL" : "PASS"} ${label} frames=${record.frames ?? 0} maxDelta=${record.maxDelta ?? "n/a"}px`);
  console.log(`  baseline ${JSON.stringify(brief(record.baseline))}`);
  console.log(`  menu-lock ${JSON.stringify(brief(record.states["menu-open"]))}`);
  console.log(`  info-lock ${JSON.stringify(brief(record.states["info-close-open"]))}`);
  if (fallback) console.log(`  fallback simulation ${JSON.stringify(record.fallback)}`);
  for (const failure of record.failures) console.log(`  ${failure}`);
}

console.log(`Shelf layout regression: ${BASE.href}; tolerance <=${TOLERANCE}px; Chrome sandbox ON`);
console.log("Mobile emulation uses actual zero-width viewport scrollbars even under the classic launch; desktop/tablet classic coverage must measure 15px.");
console.log("visibleClassicScrollbar checks overflow + viewport width + lock; rootRectGutter is reserved space, NOT proof of a visible scrollbar.");
for (const mode of MODES) {
  const browser = await chromium.launch({ executablePath: CHROME, chromiumSandbox: true,
    args: mode.args, ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const probe = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await probe.setContent('<!doctype html><html><body style="height:4000px"></body></html>');
    const gap = await probe.evaluate(() => innerWidth - document.documentElement.clientWidth);
    await probe.close();
    if (gap !== mode.expectedGap) {
      console.log(`UNAVAILABLE ${mode.name}: overflowing-page measured scrollbar=${gap}px; expected=${mode.expectedGap}px; NOT claiming this mode passed.`);
      results.push({ label: `${mode.name}/availability`, failures: [`Actual scrollbar ${gap}px, expected ${mode.expectedGap}px`] });
      continue;
    }
    console.log(`\nMeasured ${mode.name} scrollbar=${gap}px (real overflowing-page probe; no test scrollbar styling)`);
    for (const viewport of VIEWPORTS) {
      for (const long of [true, false]) {
        for (const fallback of [false, true]) await run(browser, mode, viewport, long, fallback);
      }
    }
  } finally { await browser.close(); }
}
const failed = results.filter((result) => result.failures.length);
console.log(`\n${failed.length ? "FAIL" : "PASS"}: ${results.length} cases; ${failed.length} failing; max drift=${Math.max(0, ...results.map((result) => result.maxDelta || 0))}px.`);
process.exitCode = failed.length ? 1 : 0;
