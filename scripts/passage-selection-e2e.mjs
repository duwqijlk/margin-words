// Local synthetic reader only. Real mouse drags; audio and all external traffic are blocked.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = new URL(process.argv[2] || "http://localhost:8098/");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const sentence = "The old man sat by the door with a small bag and watched the quiet street while the children played near the garden.";
const normalize = text => text.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  try {
    const reports = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) return route.abort();
      if (url.pathname === "/api/feedback/passage") {
        reports.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: "{}" });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: "{}" });
      return route.continue();
    });
    await context.addInitScript(() => {
      HTMLMediaElement.prototype.play = async () => {};
      if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
      for (const key of ["tutorial", "feedback-tip", "quote-tip"]) localStorage.setItem(`cibian-${key}-v1`, "seen");
      localStorage.setItem("cibian-locale-v1", "en");
      localStorage.setItem("cibian-prefs-v1", JSON.stringify({ version: 0, state: { size: 16, column: 85 } }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("shelf", base).href);
    await page.locator("[data-settings-button]").waitFor();
    await page.evaluate(async sentence => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("cibian-books", 3);
        req.onupgradeneeded = () => {
          for (const name of ["books", "covers", "notes"]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("books", "readwrite");
        tx.objectStore("books").put({ id: "passage-selection", title: "Selection fixture", author: "Test", glossary: {}, pending: [], totalHard: 0,
          chapters: [{ title: "Chapter", paragraphs: [sentence], html: `<p>${sentence}</p>` }] }, "passage-selection");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: { books: [{ id: "passage-selection", title: "Selection fixture", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {} } }));
    }, sentence);
    await page.goto(new URL("read/passage-selection", base).href);
    await page.locator("article .book-tap").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(3000);
    async function drag(count, reverse = false) {
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      const points = await page.locator("article p").first().evaluate((el, count) => {
        const words = [...el.querySelectorAll(".book-tap")];
        const a = words[1].getBoundingClientRect();
        const b = words[count].getBoundingClientRect();
        return [{ x: a.left + 2, y: a.top + a.height / 2 }, { x: b.right - 2, y: b.top + b.height / 2 }];
      }, count);
      if (reverse) points.reverse();
      await page.mouse.move(points[0].x, points[0].y);
      await page.mouse.down();
      await page.waitForTimeout(100);
      await page.mouse.move(points[1].x, points[1].y, { steps: 20 });
      await page.mouse.up();
      await page.locator("[data-passage-ask]").waitFor();
      // The selection bar appears after the 250ms debounce, after mouse-up snapping has run.
      return normalize(await page.evaluate(() => window.getSelection()?.toString() || ""));
    }
    for (const count of [3, 4, 5, 11]) for (const reverse of [false, true]) {
      const expected = sentence.split(" ").slice(1, count + 1).join(" ");
      assert.equal(await drag(count, reverse), expected, `${count} words, reverse=${reverse}: native range preserved`);
      const geometry = await page.locator("article").boundingBox();
      await page.locator("[data-passage-ask]").click();
      assert.equal(normalize(await page.locator("[data-passage-selected]").innerText()), expected);
      assert.deepEqual(await page.locator("article").boundingBox(), geometry, "feedback overlay does not shift article");
      await page.locator('[data-passage-reason="phrase"]').click();
      await page.locator("[data-passage-text]").fill("My explanation for this word group.");
      await page.locator("[data-passage-send]").click();
      await page.locator("[data-passage-thanks]").waitFor();
      const report = reports.at(-1);
      assert.equal(report.selected, expected);
      assert.equal(report.span, "words");
      assert.equal(report.reason, "phrase");
      assert.equal(report.suggestion, "My explanation for this word group.");
      assert.equal(sentence.slice(report.start, report.end), expected);
      await page.locator('[data-passage-card] button[aria-label="Close"]').click();
    }
    assert.equal(await drag(12), sentence, "long selection still snaps to containing sentence");
    await page.locator("[data-quote-keep]").click();
    const quotes = await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-quotes-v1") || "{}"));
    assert.ok(JSON.stringify(quotes).includes("The old man sat by the door"), "intentional sentence quote still saves");
    await page.locator('article [data-word="old"] .book-tap').first().click();
    await page.locator("[data-word-card]").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(reports.length, 8);
    assert.deepEqual(errors, []);
    console.log("PASS desktop: 3/4/5/11-word forward/backward drags, exact feedback payloads and explanations, 12-word sentence snapping, overlay geometry; no audio or live writes");
  } finally { await context.close(); }
} finally { await browser.close(); }
