// Synthetic IndexedDB fixture; run against an already-running app. No external lookups are opened.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const desktopWidth = Number(process.env.EXPECT_DESKTOP_WIDTH ?? 384);
assert.ok([336, 384].includes(desktopWidth), "EXPECT_DESKTOP_WIDTH must be 336 or 384");
const phrase = "against all odds";
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const settle = (page) => page.evaluate(() => new Promise(resolve => {
  let frames = 5;
  const tick = () => --frames ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}));
async function position(page, anchor, y) {
  await anchor.evaluate((el, top) => window.scrollBy(0, el.getBoundingClientRect().top - top), y);
  await settle(page);
}
async function links(card, term) {
  const q = encodeURIComponent(term);
  const urls = { longman: `https://www.ldoceonline.com/search/english/direct/?q=${q}`,
    webster: `https://www.merriam-webster.com/dictionary/${q}`, images: `https://www.bing.com/images/search?q=${q}` };
  for (const [site, href] of Object.entries(urls)) {
    const link = card.locator(`[data-lookup="${site}"]`);
    assert.equal(await link.getAttribute("href"), href);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/);
  }
}
async function geometry(page, anchor, card, width, height, side, article) {
  const c = await card.boundingBox();
  const a = await anchor.boundingBox();
  assert.ok(c && a);
  assert.equal(c.width, width >= 1024 ? desktopWidth : width >= 768 ? 288 : width);
  assert.ok(c.x >= -1 && c.x + c.width <= width + 1 && c.y >= -1 && c.y + c.height <= height + 1, "card inside viewport");
  assert.ok(c.x + c.width <= a.x + 1 || c.x >= a.x + a.width - 1 || c.y + c.height <= a.y + 1 || c.y >= a.y + a.height - 1, "card does not cover anchor");
  if (width >= 1024) {
    assert.equal(await card.getAttribute("data-float"), "");
    assert.ok(side === "bottom" ? c.y >= a.y + a.height : c.y + c.height <= a.y, `actual ${side} placement`);
  } else {
    assert.equal(await card.getAttribute("data-float"), null);
    if (width < 768) assert.ok(Math.abs(c.y + c.height - height) <= 1, "phone bottom sheet");
  }
  assert.deepEqual(await page.locator("article").boundingBox(), article, "article geometry unchanged");
}
async function metrics(card) {
  return card.evaluate(el => {
    const footer = el.querySelector("[data-word-footer]").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      scrollNeededToFooter: Math.max(0, Math.ceil(footer.bottom - box.top - el.clientTop - el.clientHeight + el.scrollTop)),
      maxScroll: el.scrollHeight - el.clientHeight };
  });
}
try {
  for (const [width, height] of [[1280, 800], [1024, 768], [1280, 600], [820, 1100], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "shelf");
    await page.waitForSelector("header");
    await page.evaluate(async (phraseKey) => {
      const id = "word-card-layout-regression";
      const sentence = "Against all odds the lantern seller carried the fragile lights through the flooded streets, while neighbors watched from their windows and wondered whether the exhausted traveler could reach the distant village before the rising river covered the last safe bridge.";
      const paragraphs = Array.from({ length: 40 }, () => sentence);
      const glossary = {
        lantern: { pos: "noun", meaning: "A portable light.", whyHard: "" },
        odds: { pos: "noun", meaning: "The chances that something will happen, especially when several difficulties make the hoped-for result seem very unlikely.", whyHard: "An abstract plural noun used in a fixed expression." },
      };
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
        tx.objectStore("books").put({ id, title: "Word card layout", author: "Test", glossary, pending: [], totalHard: 2,
          chapters: [{ title: "Chapter", paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join("") }] }, id);
        tx.objectStore("notes").put({ paragraphs: [{ chapter: 0, paragraph: 10, context: sentence,
          mainIdea: "A difficult journey.", simple: "The seller carries lights through a flood." }], sentences: [],
          phrases: { [phraseKey]: { pos: "idiom", meaning: "Despite many serious difficulties and very little chance of success, continuing to try until an unexpected result becomes possible through patience, determination, and help from others.",
            here: "The seller keeps carrying the lanterns toward the village even though the flooded streets, rising river, and approaching darkness all make a safe arrival seem almost impossible." } } }, `extras:${id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
        books: [{ id, title: "Word card layout", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {} } }));
    }, phrase);
    await page.goto(base + "read/word-card-layout-regression");
    await page.waitForSelector('article.book-body [role="button"][data-word="odds"]');
    await page.evaluate(() => {
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.testExternalControl = "1";
      control.textContent = "External control";
      control.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;padding:8px;background:white;color:black";
      document.body.append(control);
    });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Escape"); // Release the reader's initial saved-position hold without scrolling.
    for (const side of width >= 1024 ? ["bottom", "top"] : ["bottom"]) {
      for (const word of ["lantern", "odds"]) {
        const button = page.locator(`article [role="button"][data-word="${word}"]`).nth(10);
        const anchor = button.locator(".book-tap");
        await position(page, anchor, side === "top" ? height - 85 : 120);
        const article = await page.locator("article").boundingBox();
        await anchor.click();
        const card = page.locator("[data-word-card]");
        await card.waitFor({ state: "visible" });
        if (word === "odds") await card.locator('[data-part="phrase-meaning"]').waitFor();
        await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
        await settle(page);
        await geometry(page, anchor, card, width, height, side, article);
        if (width >= 1024) {
          await page.keyboard.press("Tab");
          assert.ok(await card.evaluate(el => el.contains(document.activeElement)), "Tab keeps focus inside desktop card");
        }
        assert.equal(await card.locator("h2").innerText(), word === "odds" ? phrase : word);
        await links(card, word === "odds" ? phrase : word);
        if (word === "odds") {
          assert.ok((await card.locator('[data-part="word-here"]').innerText()).includes("flooded streets"));
          assert.ok((await card.locator('[data-part="word-alone"]').innerText()).includes("chances that something"));
          const collapsed = await metrics(card);
          await card.locator('[data-part="sentence-box"] summary').click();
          assert.equal(await card.locator('[data-part="sentence-box"]').getAttribute("open"), "");
          await settle(page);
          const expanded = await metrics(card);
          assert.ok(expanded.scrollHeight > collapsed.scrollHeight, "expanded sentence adds content");
          console.log(JSON.stringify({ viewport: `${width}x${height}`, side, desktopWidth, collapsed, expanded }));
          await geometry(page, anchor, card, width, height, side, article);
          for (const mode of ["word", "phrase"]) {
            await card.locator(`[data-look-target="${mode}"]`).click();
            assert.equal(await card.locator(`[data-look-target="${mode}"]`).getAttribute("aria-checked"), "true");
            await links(card, mode === "word" ? word : phrase);
          }
          await card.evaluate(el => { el.scrollTop = el.scrollHeight; });
          await settle(page);
          const visibleFooter = await card.evaluate(el => {
            const footer = el.querySelector("[data-word-footer]").getBoundingClientRect();
            const box = el.getBoundingClientRect();
            return footer.top >= box.top && footer.bottom <= box.bottom;
          });
          assert.ok(visibleFooter, "footer reachable with internal scrolling");
        } else assert.equal(await card.locator("[data-look-target-group]").count(), 0);
        await page.keyboard.press("Escape");
        await card.waitFor({ state: "detached" });
        if (width >= 1024) {
          assert.equal(
            await button.evaluate(el => document.activeElement === el),
            true,
            `${width}x${height} ${side} ${word}: Escape restores focus to the exact originating word control`,
          );
        }
        assert.deepEqual(await page.locator("article").boundingBox(), article);

        // A click-away to a real external control closes without stealing its focus.
        await anchor.click();
        await card.waitFor({ state: "visible" });
        const external = page.locator('[data-test-external-control]');
        await external.click();
        await card.waitFor({ state: "detached" });
        assert.equal(await external.evaluate(el => document.activeElement === el), true,
          `${width}x${height} ${word}: click-away does not steal external control focus`);
      }
    }
    if (width >= 1024) {
      const origin = page.locator('article [role="button"][data-word="lantern"]').nth(10);
      const ink = origin.locator(".book-tap");
      const card = page.locator("[data-word-card]");
      const external = page.locator("[data-test-external-control]");
      await position(page, ink, 120);
      assert.equal(await origin.evaluate(el => el.tagName), "SPAN");
      assert.equal(await origin.getAttribute("tabindex"), "-1");
      assert.equal(await ink.getAttribute("role"), null, "inner ink stays non-interactive");
      assert.equal(await ink.getAttribute("tabindex"), null, "inner ink stays out of focus order");
      await ink.click();
      await card.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await origin.evaluate(el => document.activeElement === el), true);
      const scroll = await page.evaluate(() => [scrollX, scrollY]);
      await origin.evaluate(el => {
        el.dataset.testClicks = "0";
        el.addEventListener("click", () => { el.dataset.testClicks = String(Number(el.dataset.testClicks) + 1); });
      });
      for (const key of ["Enter", "Space"]) {
        const clicks = Number(await origin.getAttribute("data-test-clicks"));
        await page.keyboard.down(key);
        await settle(page);
        if (key === "Space") {
          assert.equal(await card.count(), 0, "Space keydown does not open a card");
          assert.equal(Number(await origin.getAttribute("data-test-clicks")), clicks);
        }
        await page.keyboard.up(key);
        await card.waitFor({ state: "visible" });
        await settle(page);
        assert.equal(await card.count(), 1, `${key} reopens one card`);
        assert.equal(Number(await origin.getAttribute("data-test-clicks")), clicks + 1, `${key} activates exactly once`);
        assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scroll, `${key} does not scroll the reader`);
        await card.locator("[data-panel-close]").click();
        await card.waitFor({ state: "detached" });
        await settle(page);
        assert.equal(await origin.evaluate(el => document.activeElement === el), true, "close button restores exact outer control");
        assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scroll, "close button restores without scrolling");
      }

      await ink.click();
      await card.waitFor({ state: "visible" });
      await settle(page);
      await external.focus();
      await origin.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().bottom + 100));
      await card.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await origin.evaluate(el => el.getBoundingClientRect().bottom < 0), true);
      assert.equal(await external.evaluate(el => document.activeElement === el), true, "offscreen dismissal never restores focus");

      await position(page, ink, 120);
      await ink.click();
      await card.waitFor({ state: "visible" });
      await settle(page);
      await external.focus();
      await page.setViewportSize({ width: 1023, height });
      await settle(page);
      assert.equal(await external.evaluate(el => document.activeElement === el), true, "crossing desktop breakpoint does not restore word focus");
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await page.setViewportSize({ width, height });
      await settle(page);
      await position(page, page.locator("article p").nth(10), 120);
      const marker = page.locator('[data-para-marker="10"]');
      await marker.waitFor({ state: "visible" });
      const article = await page.locator("article").boundingBox();
      await marker.click();
      const panel = page.locator("[data-para-panel]");
      await panel.waitFor({ state: "visible" });
      await panel.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
      await settle(page);
      assert.equal((await panel.boundingBox()).width, 336, "paragraph card stays 336px");
      assert.deepEqual(await page.locator("article").boundingBox(), article);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height}: widths, placement, article stability, lookup targets, sentence, click-away${width >= 1024 ? ", exact focus return, Enter/Space, close button, offscreen and breakpoint focus" : " and Escape dismissal"}`);
    await page.close();
  }
} finally {
  await browser.close();
}
