#!/usr/bin/env node
/** Offline help grouping/source regression; attach to a running LOCAL server, never start one.
 * Original CC0 fixture, disposable IDB, mocked API/catalog/profile, Chrome sandbox ON.
 * CHROME=/path/to/chrome node scripts/help-panel-layout-e2e.mjs http://127.0.0.1:8096/
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8096/");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(BASE.hostname), "Local server only");
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);
assert.ok(CHROME, "Set CHROME to a local Chrome executable");
const ID = "help-source-fixture", A = "abc123def456", B = "def456abc123", UNKNOWN = "fff111aaa222";
const PEOPLE = [{ id: A, name: "Mira", helped: 2 }, { id: B, name: "A Reader With A Very Long Name XX", helped: 3 }];
const FIRST = "Mira carried a lantern along the quiet harbor while the boats waited for the morning tide.";
const SECOND = "The patient keeper watched the clouds because the next journey depended on the weather.";
const TEXT = `${FIRST} ${SECOND}`;
const CASES = [
  [1280, 900, "en", "light", "both", "known"], [1280, 900, "zh", "dark", "both", "delayed"],
  [768, 1024, "en", "sepia", "both", "missing"], [768, 1024, "zh", "clear", "sentence", "known"],
  [390, 844, "en", "clear", "both", "known"], [390, 844, "zh", "sepia", "paragraph", "known"],
  [320, 700, "zh", "light", "both", "missing"], [320, 700, "en", "dark", "sentence", "known"],
  [1280, 900, "en", "clear", "paragraph", "uncredited"], [390, 844, "zh", "dark", "both", "delayed"],
];
const LABELS = {
  en: ["Reading help", "Paragraph explanation", "Sentence explanations", "Reader contribution", "From this word list", "Original", "Explanation"],
  zh: ["\u9605\u8bfb\u89e3\u6790", "\u6bb5\u843d\u89e3\u6790", "\u53e5\u5b50\u89e3\u6790", "\u8bfb\u8005\u8d21\u732e", "\u8bcd\u8868\u89e3\u6790", "\u539f\u6587", "\u89e3\u91ca"],
};
function fixture(kind, profiles) {
  return {
    paragraphs: kind === "sentence" ? [] : [{ chapter: 0, paragraph: 8, context: FIRST,
      mainIdea: "The harbor is waiting for a safe journey.",
      simple: "Mira takes a light to the harbor. The keeper watches the sky. They will travel when the weather is safe.", hardWords: ["harbor"],
      ...(profiles === "uncredited" ? {} : { credit: profiles === "missing" ? UNKNOWN : A }) }],
    sentences: kind === "paragraph" ? [] : [
      { chapter: 0, context: FIRST, simple: "Mira takes a light to the boats before the tide comes in.", credit: profiles === "missing" ? UNKNOWN : B },
      { chapter: 0, context: SECOND, simple: "The keeper watches the sky to decide when to travel.", grammar: "Because gives the reason for watching the clouds." },
    ],
  };
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function geometry(page) {
  return page.locator("article.book-body").evaluate(article => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; };
    const p = article.querySelectorAll("p")[8], range = document.createRange(); range.selectNodeContents(p);
    return { article: rect(article), paragraph: rect(p), fragments: [...range.getClientRects()].map(r => ({ x: r.x, width: r.width, height: r.height, y: r.y - p.getBoundingClientRect().y })) };
  });
}
function unchanged(before, after, label) {
  assert.equal(after.fragments.length, before.fragments.length, `${label}: wrapping`);
  for (const key of ["article", "paragraph"]) for (const dim of ["x", "width", "height"]) assert.ok(Math.abs(after[key][dim] - before[key][dim]) <= 1, `${label}: ${key}.${dim}`);
  for (let i = 0; i < before.fragments.length; i++) for (const dim of ["x", "width", "height", "y"]) assert.ok(Math.abs(after.fragments[i][dim] - before.fragments[i][dim]) <= 1, `${label}: fragment ${i}.${dim}`);
}
async function run(browser, row) {
  const [width, height, locale, theme, kind, profiles] = row, label = row.join("/");
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768, serviceWorkers: "block", locale: locale === "zh" ? "zh-CN" : "en-US", reducedMotion: "reduce" });
  const unexpected = [], errors = [];
  let release, profileRequests = 0;
  const delayed = new Promise(resolve => { release = resolve; });
  try {
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const host = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
      const json = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
      if (host && path === "/contributors.json") { profileRequests++; if (profiles === "delayed") await delayed; return json({ people: profiles === "missing" ? [] : PEOPLE, books: {} }); }
      if (host && path === "/public-books/catalog.json") return json({ packs: [] });
      if (host && path === "/word-lists/catalog.json") return json({ lists: [] });
      if (host && path === "/word-lists/discover-rails.json") return json({ rails: [] });
      if (url.origin === BASE.origin && path === "/api/auth/me") return json({ user: null });
      if (url.origin === BASE.origin && path === "/api/sync") return json({ items: [] });
      if (url.origin === BASE.origin && path === "/api/qq-groups") return json({ groups: [] });
      if (url.origin === BASE.origin && path === "/api/analytics/word-taps") return json({ ok: true });
      if (url.origin === BASE.origin && path === "/__help-fixture__") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>CC0 fixture</title>" });
      const asset = /^(?:\/assets\/|\/src\/|\/node_modules\/|\/@vite\/|\/@id\/|\/@fs\/|\/@react-refresh$)/.test(path) || /\.(?:js|css|mjs|woff2?|ttf|svg|png|ico|webmanifest)$/.test(path);
      if (url.origin === BASE.origin && req.method() === "GET" && !/^\/(?:api|books|public-books|word-lists|packs)(?:\/|$)/.test(path) && (asset || ["/shelf", "/admin", `/read/${ID}`].includes(path))) return route.continue();
      unexpected.push(`${req.method()} ${url.href}`); return route.abort("blockedbyclient");
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", e => errors.push(e.message));
    await page.goto(new URL("/__help-fixture__", BASE).href);
    await page.evaluate(async ({ id, locale, theme, text, notes }) => {
      localStorage.setItem("cibian-locale-v1", locale); localStorage.setItem("cibian-site-notice-v1", "hidden");
      localStorage.setItem("cibian-prefs-v1", JSON.stringify({ version: 0, state: { theme, font: "literata", size: 20, leading: 1.8, width: "medium", column: 39, paging: false } }));
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: { books: [{ id, title: "Harbor fixture", author: "Original Fixture Writer", source: "epub", createdAt: 1 }], words: [], log: {} } }));
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open("cibian-books", 3); req.onupgradeneeded = () => { for (const name of ["books", "covers", "notes"]) req.result.createObjectStore(name); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      try { await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "notes"], "readwrite");
        const paragraphs = Array.from({ length: 28 }, (_, i) => i === 8 ? text : `The quiet harbor keeper counted the boats and checked the lamps before a new day. This is original fixture passage number ${i + 1}.`);
        const glossary = { harbor: { pos: "noun", meaning: "A sheltered place for boats.", whyHard: "" } };
        tx.objectStore("books").put({ id, title: "Harbor fixture", author: "Original Fixture Writer", chapters: [{ title: "Harbor", paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join("") }], glossary, pending: [], totalHard: 1 }, id);
        tx.objectStore("notes").put({ ...notes, phrases: {} }, `extras:${id}`);
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      }); } finally { db.close(); }
    }, { id: ID, locale, theme, text: TEXT, notes: fixture(kind, profiles) });
    await page.goto(new URL(`/read/${ID}`, BASE).href);
    const article = page.locator("article.book-body"); await article.waitFor(); await page.evaluate(() => document.fonts.ready); await page.keyboard.press("Escape");
    await article.locator("p").nth(8).evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 120)); await settle(page);
    const bulb = page.locator('[data-para-marker="8"]'); await bulb.waitFor({ state: "visible" });
    const before = await geometry(page); await bulb.click();
    const panel = page.locator("[data-para-panel]"); await panel.waitFor({ state: "visible" }); await panel.locator("[data-help-source]").first().waitFor(); await settle(page);
    const words = LABELS[locale];
    assert.equal(await panel.locator("h2").innerText(), words[0]); assert.equal(await panel.getAttribute("aria-label"), words[0]);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.equal(await panel.locator('[data-part="paragraph-help"]').count(), kind === "sentence" ? 0 : 1);
    assert.equal(await panel.locator('[data-part="sentences"]').count(), kind === "paragraph" ? 0 : 1);
    for (const source of await panel.locator("[data-help-source]").all()) {
      const value = await source.getAttribute("data-help-source"); assert.equal(await source.locator(":scope > span").innerText(), words[value === "reader" ? 3 : 4]);
      assert.equal(await source.locator("button,a").count(), 0, "source is not an action");
    }
    if (kind !== "sentence") {
      const para = panel.locator('[data-part="paragraph-help"]'); assert.equal(await para.locator("h3").innerText(), words[1]);
      assert.equal(await para.locator("[data-help-source]").getAttribute("data-help-source"), profiles === "uncredited" ? "word-list" : "reader");
      assert.ok(await para.evaluate(el => !!(el.querySelector("[data-help-source]").compareDocumentPosition(el.querySelector('[data-part="main-idea"]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }
    if (kind !== "paragraph") {
      assert.equal(await panel.locator('[data-part="sentences"] > h3').innerText(), words[2]);
      const notes = panel.locator("[data-sentence-note]"); assert.equal(await notes.count(), 2);
      assert.equal(await notes.nth(0).locator("[data-help-source]").getAttribute("data-help-source"), "reader");
      assert.equal(await notes.nth(1).locator("[data-help-source]").getAttribute("data-help-source"), "word-list");
      assert.equal(await notes.nth(0).locator('[data-part="grammar"]').count(), 0); assert.equal(await notes.nth(1).locator('[data-part="grammar"]').count(), 1);
      for (const note of await notes.all()) {
        assert.ok((await note.innerText()).includes(words[5])); assert.ok((await note.innerText()).includes(words[6]));
        assert.ok(await note.evaluate(el => !!(el.querySelector("[data-help-source]").compareDocumentPosition(el.querySelector('[data-part="sentence-context"]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
      }
    }
    if (profiles === "delayed") {
      assert.equal(await panel.locator('[data-part="credit"]').count(), 0); assert.ok(await panel.locator('[data-help-source="reader"]').count() > 0);
      unchanged(before, await geometry(page), "pending profile"); release(); await panel.locator('[data-credit]').first().waitFor(); await settle(page);
    }
    if (profiles === "missing") {
      assert.equal(await panel.locator('[data-part="credit"]').count(), 0); assert.equal((await panel.innerText()).includes(UNKNOWN), false, "no private ID in text");
    } else if (profiles !== "uncredited") {
      await panel.locator('[data-credit]').first().waitFor();
      if (kind !== "sentence") assert.equal(await panel.locator('[data-part="paragraph-help"] [data-credit]').getAttribute("data-credit"), A);
      if (kind !== "paragraph") assert.equal(await panel.locator('[data-sentence-note] [data-credit]').getAttribute("data-credit"), B);
    }
    unchanged(before, await geometry(page), "open/profile");
    if (kind !== "sentence") {
      const toggle = panel.locator('[aria-expanded]'); assert.equal(await toggle.getAttribute("aria-expanded"), "true"); await toggle.click();
      assert.equal(await panel.locator('[data-part="simple"]').count(), 0); unchanged(before, await geometry(page), "collapse"); await toggle.click(); await panel.locator('[data-part="simple"]').waitFor();
    }
    if (kind !== "paragraph") {
      const button = panel.locator('[data-part="sentence-context"]').first(); await button.click(); assert.equal(await button.getAttribute("aria-pressed"), "true");
      await page.locator('[data-sentence-mark="0"][data-chosen]').first().waitFor({ state: "attached" });
      await panel.locator('[data-sentence-note]').first().locator('[data-help-source] > span').click(); assert.equal(await button.getAttribute("aria-pressed"), "true", "source click does not select/deselect");
      await button.click(); assert.equal(await button.getAttribute("aria-pressed"), "false"); assert.equal(await page.locator('[data-sentence-mark][data-chosen]').count(), 0);
      unchanged(before, await geometry(page), "select/deselect");
    }
    const overflow = await panel.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right }));
    assert.ok(overflow.scrollWidth <= overflow.width + 1, "no horizontal overflow"); assert.ok(overflow.x >= -1 && overflow.right <= width + 1, "panel inside viewport");
    const footer = panel.locator('[data-part="help-footer"]'); await footer.scrollIntoViewIfNeeded();
    assert.equal(await footer.locator('xpath=ancestor::*[@data-sentence-note or @data-part="paragraph-help"]').count(), 0);
    assert.ok(await footer.evaluate(el => { const p = el.closest("[data-para-panel]").getBoundingClientRect(), r = el.getBoundingClientRect(); return r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }), "footer reachable");
    await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" }); await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.isConnected && !document.activeElement.closest("[data-para-panel]")), true, "no focus remains in a detached panel");
    unchanged(before, await geometry(page), "close"); assert.equal(await page.locator('[data-sentence-mark]').count(), 0); assert.equal(await article.locator('[data-help-keep]').count(), 0);
    assert.ok(profileRequests <= 1, "shared profile request"); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${label}: grouping, sources, controls, marks, footer, text geometry`);
  } finally { release(); await context.close(); }
}
const browser = await chromium.launch({ executablePath: CHROME, chromiumSandbox: true });
try { for (const row of CASES) await run(browser, row); } finally { await browser.close(); }
console.log(`PASS: ${CASES.length} isolated help-panel cases; original fixtures; no live services.`);
