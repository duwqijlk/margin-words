// Synthetic books and mocked APIs only. Optional second URL compares reader typography with a baseline build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = new URL(process.argv[2] || "http://localhost:8098/");
const baseline = process.argv[3] ? new URL(process.argv[3]) : null;
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const dictionaries = Object.fromEntries(["en", "zh"].map(locale => {
  const src = readFileSync(new URL(`../src/lib/i18n-${locale}.ts`, import.meta.url), "utf8");
  return [locale, key => JSON.parse(src.match(new RegExp(`"${key.replaceAll(".", "\\.")}":\\s*("(?:[^"\\\\]|\\\\.)*")`))[1])];
}));
const row = { id: "font-fixture", title: "Typography 123", author: "Synthetic fixture", lexile: "790L", isbn: "9781234567897", series: "Fixture", seriesNumber: 2, words: 1234, paragraphs: 56, sentences: 78, phrases: 90, glossary: { url: "font-fixture/glossary.json", bytes: 100, sha256: "" }, added: "2026-10-01" };

async function setup(origin, locale, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname.endsWith("/word-lists/catalog.json")) data = { lists: [row] };
    else if (url.pathname.endsWith("/public-books/catalog.json")) data = { packs: [] };
    else if (url.pathname.startsWith("/api/")) data = {};
    else if (url.origin !== origin.origin) return route.abort();
    if (data) return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    return route.continue();
  });
  await context.addInitScript(locale => {
    for (const key of ["tutorial", "feedback-tip", "quote-tip"]) localStorage.setItem(`cibian-${key}-v1`, "seen");
    localStorage.setItem("cibian-locale-v1", locale);
    // Typography checks must never play audio or invoke device speech.
    HTMLMediaElement.prototype.play = async () => {};
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
  }, locale);
  const page = await context.newPage();
  await page.goto(new URL("shelf", origin).href);
  await page.locator("[data-account-button]").waitFor();
  await page.evaluate(async () => {
    const id = "font-fixture";
    const paragraphs = Array.from({ length: 35 }, () => "The lantern seller walked along the street and counted 123 quiet houses.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books", 3);
      request.onupgradeneeded = () => {
        for (const name of ["books", "covers", "notes"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("books", "readwrite");
      tx.objectStore("books").put({ id, title: "Typography 123", author: "Synthetic fixture", glossary: { lantern: { pos: "noun", meaning: "A portable light carried through the streets.", whyHard: "" } }, pending: [], totalHard: 1,
        chapters: Array.from({ length: 12 }, (_, i) => ({ title: `Chapter ${i + 1}`, paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join("") })) }, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
      books: [{ id, title: "Typography 123", author: "Synthetic fixture", source: "epub", cloth: "cloth", createdAt: 1 }],
      words: [{ id: "font-word", lemma: "lantern", surface: "lantern", pos: "noun", meaning: "A portable light.", whyHard: "", sentence: paragraphs[0], recommend: true, stage: 0, dueAt: 1, addedAt: 1, sources: [{ book: "font-fixture", title: "Typography 123", surface: "lantern", savedAt: 1 }] }], log: {},
    } }));
    localStorage.setItem("cibian-progress-v1", JSON.stringify({ version: 0, state: { items: { [id]: { chapter: 2, chapters: 12, scroll: 0.3, updatedAt: Date.now() } } } }));
  });
  return { context, page };
}
const ready = page => page.evaluate(() => document.fonts.ready.then(() => undefined));
const family = locator => locator.first().evaluate(el => getComputedStyle(el).fontFamily);
const checkFace = async (page, selector, expected, label) => {
  const locator = page.locator(selector);
  assert.ok(await locator.count(), `${label}: element exists`);
  for (const font of await locator.evaluateAll(els => els.map(el => getComputedStyle(el).fontFamily))) assert.equal(font, expected, `${label}: ${font}`);
};
const noOverflow = async page => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no page horizontal overflow");

async function readerSnapshot(page, origin, font) {
  await page.evaluate(font => localStorage.setItem("cibian-prefs-v1", JSON.stringify({ version: 0, state: { font, size: 20, leading: 1.8, width: "medium", focus: false } })), font);
  await page.goto(new URL("read/font-fixture", origin).href);
  await page.locator('article [data-word="lantern"]').first().waitFor();
  await ready(page);
  await page.keyboard.press("Escape");
  const snapshot = async selector => page.locator(selector).first().evaluate(el => {
    const css = getComputedStyle(el);
    return [css.fontFamily, css.fontSize, css.lineHeight, css.fontVariantNumeric, css.fontFeatureSettings];
  });
  const article = await snapshot("article");
  const toolbar = await snapshot("[data-reader-bar] button");
  const anchor = page.locator('article [data-word="lantern"] .book-tap').first();
  await anchor.scrollIntoViewIfNeeded();
  const geometry = await page.locator("article").boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  await anchor.click();
  await page.locator("[data-word-card]").waitFor();
  assert.deepEqual(await page.locator("article").boundingBox(), geometry, "word overlay leaves article unchanged");
  assert.equal(await page.evaluate(() => scrollY), scroll, "word overlay leaves reading position unchanged");
  const card = await snapshot("[data-word-header]");
  const body = await snapshot("[data-word-content]");
  assert.equal(await page.locator('html[data-ui-font]').count(), 0, "reader has no UI scope");
  assert.match(await family(page.locator("[data-reader-bar] button")), /Atkinson Hyperlegible/);
  assert.match(article[0], new RegExp({ literata: "Literata", lora: "Lora", sans: "Atkinson Hyperlegible" }[font]));
  await page.keyboard.press("Escape");
  const locale = await page.evaluate(() => localStorage.getItem("cibian-locale-v1"));
  await page.getByRole("button", { name: dictionaries[locale]("rs.aria"), exact: true }).click();
  await page.locator("[data-reader-settings]").waitFor();
  const settings = await snapshot("[data-reader-settings] h3");
  await page.keyboard.press("Escape");
  return { article, toolbar, card, body, settings };
}

try {
  for (const locale of ["en", "zh"]) for (const width of [320, 1280]) {
    const { context, page } = await setup(base, locale, width);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const t = dictionaries[locale];
    try {
      await page.goto(new URL("dashboard", base).href);
      await page.locator("[data-dash] dd").first().waitFor();
      await ready(page);
      const expected = await family(page.locator("[data-dash] dd"));
      assert.match(expected, /^Literata/);
      await checkFace(page, "[data-overview-tabs] button, [data-dash] dt, [data-sponsor-link]", expected, "dashboard text");
      await noOverflow(page);
      await page.locator("[data-sponsor-link]").click();
      await checkFace(page, "[data-sponsor-address]", expected, "wallet code");
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await page.goto(new URL("shelf", base).href);
      await page.locator("[data-continue-progress]").waitFor();
      await ready(page);
      await checkFace(page, "[data-continue-card] b, [data-progress-ring] b, [data-continue-card] p, li.book-card button", expected, "shelf");
      assert.match(await page.locator("[data-progress-ring] b").evaluate(el => getComputedStyle(el).fontVariantNumeric), /lining-nums.*tabular-nums/);
      await noOverflow(page);
      for (const panel of ["[data-account-dialog]"]) {
        await page.locator("[data-account-button]").click();
        await page.locator(panel).waitFor();
        await checkFace(page, `${panel} button, ${panel} input, ${panel} h2`, expected, panel);
        await noOverflow(page);
        await page.keyboard.press("Escape");
      }
      await page.goto(new URL("book/font-fixture", base).href);
      await page.locator('[data-book-detail="font-fixture"]').waitFor();
      await ready(page);
      await checkFace(page, "[data-detail-facts] dd, [data-detail-facts] dt, [data-detail-actions] button", expected, "book detail portal");
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await page.goto(new URL("words", base).href);
      await page.locator("[data-notebook]").waitFor();
      await checkFace(page, "[data-notebook] h1, [data-review-start], [data-word-row]", expected, "notebook");
      await page.locator("[data-review-start]").click();
      await page.locator("[data-review-count]").waitFor();
      await checkFace(page, "[data-review-count]", expected, "focused review");
      await noOverflow(page);
      await page.keyboard.press("Escape");
      for (const font of ["literata", "lora", "sans"]) {
        const actual = await readerSnapshot(page, base, font);
        if (baseline) {
          const previous = await setup(baseline, locale, width);
          try { assert.deepEqual(actual, await readerSnapshot(previous.page, baseline, font), `reader ${font}: baseline unchanged`); }
          finally { await previous.context.close(); }
        }
      }
      // Use actual controls and history, not direct page loads, to test scope cleanup.
      await page.getByRole("button", { name: t("reader.backShelf"), exact: true }).click();
      await page.locator("[data-continue-card]").waitFor();
      assert.equal(await page.locator('html[data-ui-font="display"]').count(), 1);
      await page.locator("[data-continue-open]").click();
      await page.locator("article").waitFor();
      assert.equal(await page.locator("html[data-ui-font]").count(), 0);
      await page.goBack();
      await page.locator("[data-continue-card]").waitFor();
      assert.equal(await page.locator('html[data-ui-font="display"]').count(), 1);
      await page.goForward();
      await page.locator("article").waitFor();
      assert.equal(await page.locator("html[data-ui-font]").count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${locale} ${width}px: UI/portal families, lining figures, review, reader preferences and history${baseline ? ", reader baseline identical" : ""}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
