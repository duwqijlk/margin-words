// Local synthetic book: typography, selected-word updates, and non-overlapping note bulbs.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "shelf");
    await page.waitForSelector("header");
    await page.evaluate(async () => {
      const id = "layout-regression";
      const paragraph = "The lantern seller walked along the street and stopped to watch the quiet houses in the rain.";
      const paragraphs = ["A centered dedication.", "unbelievable weather today.", ...Array.from({ length: 30 }, () => paragraph)];
      const glossary = { lantern: { pos: "noun", meaning: "A portable light.", whyHard: "" } };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("cibian-books", 3);
        request.onupgradeneeded = () => {
          for (const name of ["books", "covers", "notes"])
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "notes"], "readwrite");
        tx.objectStore("books").put({
          id, title: "Layout regression", author: "Test", glossary, pending: [], totalHard: 1,
          chapters: [{ title: "Chapter", paragraphs,
            html: '<p style="text-align:center">A centered dedication.</p><p><em>un</em>believable weather today.</p>' + paragraphs.slice(2).map(p => `<p>${p}</p>`).join("") }],
        }, id);
        tx.objectStore("notes").put({ paragraphs: [{ chapter: 0, paragraph: 2, context: paragraph, mainIdea: "A walk.", simple: "The seller walks in the rain." }], phrases: {}, sentences: [] }, `extras:${id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: { books: [{ id, title: "Layout regression", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {} } }));
    });
    await page.goto(base + "read/layout-regression");
    await page.waitForSelector('article.book-body [role=button][data-word]');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("[data-para-marker]");
    const typography = await page.evaluate(() => {
      const paragraphs = document.querySelectorAll("article p");
      const weather = document.querySelector('[role=button][data-word="weather"]');
      return {
        align: getComputedStyle(paragraphs[0]).textAlign,
        last: getComputedStyle(paragraphs[0]).textAlignLast,
        weatherItalic: Boolean(weather.closest("em")),
        weatherFont: getComputedStyle(weather.querySelector(".book-tap")).fontStyle,
        words: [...paragraphs[1].querySelectorAll('[role=button][data-word]')].map(el => el.dataset.word),
      };
    });
    assert.equal(typography.align, "center");
    assert.equal(typography.last, "center");
    assert.equal(typography.weatherItalic, false);
    assert.equal(typography.weatherFont, "normal");
    assert.deepEqual(typography.words, ["unbelievable", "weather", "today"]);
    const geometry = await page.evaluate(() => {
      // The ✦ is an empty span after the paragraph's last word, on that word's line.
      const mark = document.querySelector("[data-para-marker]");
      const rect = mark.getBoundingClientRect();
      const paragraph = document.querySelectorAll("article p")[Number(mark.dataset.paraMarker)];
      const words = paragraph.querySelectorAll("[role=button][data-word]");
      const last = words[words.length - 1].getBoundingClientRect();
      return {
        inside: rect.left >= 0 && rect.right <= innerWidth,
        owned: paragraph.contains(mark) && mark.textContent === "",
        afterLastWord: rect.left >= last.right - 1 && Math.abs((rect.top + rect.bottom) / 2 - (last.top + last.bottom) / 2) < last.height / 2,
      };
    });
    assert.equal(geometry.inside, true);
    assert.equal(geometry.owned, true);
    assert.equal(geometry.afterLastWord, true);
    const position = await page.locator("article").boundingBox();
    await page.locator('[role=button][data-word="lantern"] .book-tap').first().click();
    await page.waitForSelector("[data-word-card]");
    assert.equal(await page.locator("[role=button][data-word].book-on").count(), 1);
    const after = await page.locator("article").boundingBox();
    assert.deepEqual(after, position, "opening a card must not shift the article");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-word-card]", { state: "detached" });
    assert.equal(await page.locator("[role=button][data-word].book-on").count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: centered text, inline-word formatting, help marks, selection and overlay stability`);
    await page.close();
  }
} finally {
  await browser.close();
}
