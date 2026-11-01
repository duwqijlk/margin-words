// Synthetic reader fixture. Keep traditional scrollbars visible: hiding them masks the flip loop.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.argv[2] ?? "http://localhost:8098/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--disable-features=OverlayScrollbar,OverlayScrollbars"],
});
const settle = page => page.evaluate(() => new Promise(resolve => {
  let remaining = 5;
  const tick = () => --remaining ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}));

async function stable(page, label) {
  const card = page.locator("[data-word-card]");
  await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
  await settle(page);
  const frames = await card.evaluate(async el => {
    const rows = [];
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const content = el.querySelector("[data-word-content]");
      const body = el.querySelector("[data-word-body]");
      rows.push([el.style.top, el.style.maxHeight, el.offsetHeight, content.offsetWidth,
        content.offsetHeight, body.clientWidth, body.clientHeight, body.scrollHeight]);
    }
    return rows;
  });
  assert.equal(new Set(frames.map(row => JSON.stringify(row))).size, 1,
    `${label}: card must converge for 60 frames; ${JSON.stringify(frames.slice(0, 8))}`);
  const geometry = await card.evaluate(el => {
    const r = el.getBoundingClientRect();
    const anchor = document.querySelector("article .book-on .book-tap").getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight,
      clear: r.right <= anchor.left + 1 || r.left >= anchor.right - 1 || r.bottom <= anchor.top + 1 || r.top >= anchor.bottom - 1 };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1
    && geometry.top >= 0 && geometry.bottom <= geometry.height + 1, `${label}: inside viewport`);
  if (geometry.width >= 768) assert.ok(geometry.clear, `${label}: anchor stays visible`);
  return frames[0];
}

try {
  for (const mode of ["classic", "fallback", "overlay"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== base.origin) return route.abort();
        if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: "{}" });
        return route.continue();
      });
      await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = async () => {};
        if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
        localStorage.setItem("cibian-tutorial-v1", "seen");
        localStorage.setItem("cibian-feedback-tip-v1", "seen");
        localStorage.setItem("cibian-quote-tip-v1", "seen");
        localStorage.setItem("cibian-locale-v1", "en");
      });
      await page.goto(new URL("shelf", base).href);
      await page.evaluate(async () => {
        const id = "word-card-position";
        const words = ["lantern", "fragile", "garden", "window", "river", "travel", "quiet", "evening",
          "morning", "street", "seller", "doctor", "village", "weather", "house"];
        const glossary = {};
        words.forEach((word, i) => {
          glossary[word] = { pos: "noun", meaning: ("A portable light carried through the winding streets with a handle and a protective glass cover. ").repeat(4).slice(0, 58 + i * 4), whyHard: "" };
        });
        glossary.traveler = { pos: "noun", meaning: "A person who makes a long journey across distant lands. ".repeat(30), whyHard: "" };
        const paragraphs = Array.from({ length: 50 }, () => words.join(" ") + ". The neighbors watched the traveler make a long journey across the valley.");
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
          const tx = db.transaction(["books"], "readwrite");
          tx.objectStore("books").put({ id, title: "Position regression", author: "Synthetic fixture", glossary,
            pending: [], totalHard: words.length + 1,
            chapters: [{ title: "Chapter", paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join("") }] }, id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
          books: [{ id, title: "Position regression", author: "Synthetic fixture", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {},
        } }));
      });
      await page.goto(new URL("read/word-card-position", base).href);
      await page.locator('article [data-word="garden"]').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press("Escape");
      if (mode !== "classic") {
        // Exercise the legacy fixed-gutter fallback, or an overlay scrollbar with no layout width.
        await page.addStyleTag({ content: mode === "fallback"
          ? '@media(min-width:768px){[data-word-card] [data-word-body]{scrollbar-gutter:auto;overflow-y:scroll}}'
          : '[data-word-card] [data-word-body]{scrollbar-gutter:auto;scrollbar-width:none}[data-word-card] [data-word-body]::-webkit-scrollbar{width:0}' });
      }
      const open = async (word, y) => {
        await page.keyboard.press("Escape");
        const anchor = page.locator(`article [role="button"][data-word="${word}"]`).nth(15).locator(".book-tap");
        await anchor.evaluate((el, y) => window.scrollBy(0, el.getBoundingClientRect().top - y), y);
        await settle(page);
        const article = await page.locator("article").boundingBox();
        const scroll = await page.evaluate(() => scrollY);
        await anchor.click();
        await page.locator("[data-word-card]").waitFor();
        const frame = await stable(page, `${mode} ${word} at ${y}`);
        assert.deepEqual(await page.locator("article").boundingBox(), article, "opening card does not move reading text");
        assert.equal(await page.evaluate(() => scrollY), scroll, "opening card does not scroll the article");
        return frame;
      };
      for (const [word, y] of [["garden", 432], ["garden", 428], ["garden", 436], ["fragile", 432],
        ["lantern", 120], ["lantern", 740], ["traveler", 650]]) {
        await open(word, y);
      }
      await open("garden", 432);
      const card = page.locator("[data-word-card]");
      const collapsed = await card.locator("[data-word-content]").evaluate(el => el.offsetHeight);
      await card.locator("[data-feedback-toggle]").click();
      await stable(page, `${mode} feedback expanded`);
      assert.ok(await card.locator("[data-word-content]").evaluate(el => el.offsetHeight) > collapsed);
      await card.locator("[data-feedback-toggle]").click();
      await stable(page, `${mode} feedback collapsed`);
      assert.equal(await card.locator("[data-word-content]").evaluate(el => el.offsetHeight), collapsed);
      await open("traveler", 650);
      const body = page.locator("[data-word-body]");
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await stable(page, `${mode} body scroll`);
      assert.ok(await body.evaluate(el => el.scrollTop > 0), "long meaning scrolls inside the card");
      await open("traveler", 300);
      await page.setViewportSize({ width: 1024, height: 600 });
      await stable(page, `${mode} resize`);
      await page.evaluate(() => window.scrollBy(0, 30));
      await stable(page, `${mode} page scroll`);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1280, height: 450 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
      await open("traveler", 225);
      await page.keyboard.press("Escape");
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      for (const width of [767, 768, 769]) {
        await page.setViewportSize({ width, height: 800 });
        await open("garden", 432);
        assert.equal(await page.locator('[data-word-card][data-float]').count(), width >= 768 ? 1 : 0);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${mode}: threshold stability, internal scroll, resize, breakpoints and reading layout`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
