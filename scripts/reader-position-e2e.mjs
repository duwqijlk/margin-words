// Isolated synthetic books: navigation, legacy paragraph parity, jumps and exit timing.
// node scripts/reader-position-e2e.mjs [baseUrl] [--timing]
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const timingOnly = process.argv.includes("--timing");
const [width, height] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);
const paragraphs = (label) => Array.from({ length: 36 }, (_, i) =>
  `${label} passage ${i}. The lantern seller counted the windows along the quiet street and watched the rain falling over the garden. Each house had a different door and a small light beside the gate.`);
const chapter = (label, html = true) => {
  const texts = paragraphs(label);
  if (!html) { texts[2] = ""; texts[3] = "I"; }
  return { title: label, paragraphs: texts, ...(html ? { html: texts.map((p) => `<p>${p}</p>`).join("") } : {}) };
};
const books = [
  { id: "position-html", title: "Position HTML", chapters: [chapter("First"), chapter("Second")] },
  { id: "position-old", title: "Position old", chapters: [chapter("Old first", false), chapter("Old second", false)],
    extras: [{ ...chapter("Old appendix", false), id: "x0", href: "appendix", opfHref: "appendix", itemId: "appendix", spineAt: 1 }] },
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let failures = 0;
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "en-US" });
  // Synthetic data only; never fetch hosted books or use an existing browser profile.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(base + "shelf");
    await page.waitForSelector("header");
    await page.evaluate(async (books) => {
      const request = indexedDB.open("cibian-books", 3);
      const db = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => {
          for (const name of ["books", "covers", "notes"])
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "notes"], "readwrite");
        for (const book of books) {
          const stored = { ...book, author: "Test", glossary: {}, pending: [], totalHard: 0 };
          tx.objectStore("books").put(stored, book.id);
          tx.objectStore("notes").put({ ...stored, chapters: undefined }, `gloss:${book.id}`);
          tx.objectStore("notes").put({ paragraphs: [], sentences: [], phrases: {} }, `extras:${book.id}`);
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
        books: books.map((b) => ({ id: b.id, title: b.title, author: "Test", source: "epub", cloth: "cloth", createdAt: 1, updatedAt: 1 })), words: [], log: {},
      } }));
    }, books);
    await run(page);
    assert.deepEqual(errors, [], "no browser errors");
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
const progress = (page, id = "position-html") => page.evaluate((id) => JSON.parse(localStorage.getItem("cibian-progress-v1") || "{}").state?.items?.[id], id);
async function seedPlace(page, id, place) {
  await page.evaluate(({ id, place }) => localStorage.setItem("cibian-progress-v1", JSON.stringify({ version: 0, state: { items: { [id]: { chapter: 0, chapters: 2, scroll: 0, updatedAt: 1, ...place } } } })), { id, place });
}
async function open(page, id = "position-html") {
  await page.goto(base + "read/" + id);
  await page.waitForSelector("article.book-body p");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
}
async function scrollToParagraph(page, index) {
  return page.evaluate((index) => {
    window.dispatchEvent(new WheelEvent("wheel"));
    const p = document.querySelectorAll("article.book-body p")[index];
    window.scrollTo(0, scrollY + p.getBoundingClientRect().top - 96);
    window.dispatchEvent(new Event("scroll"));
    return scrollY;
  }, index);
}
async function pick(page, title) {
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.locator('[role="dialog"] ol button').filter({ hasText: title }).click();
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
}
async function atParagraph(page, index) {
  const top = await page.locator("article.book-body p").nth(index).evaluate((p) => p.getBoundingClientRect().top);
  assert.ok(Math.abs(top - 96) <= 8, `paragraph ${index} top=${top}, expected 96`);
}

try {
  if (!timingOnly) {
    await scenario("same chapter selection repositions without remount", async (page) => {
      await open(page);
      await scrollToParagraph(page, 12);
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.originalArticle = document.querySelector("article"); window.originalParagraph = document.querySelector("article p"); });
      await pick(page, "First");
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.evaluate(() => window.originalArticle === document.querySelector("article") && window.originalParagraph === document.querySelector("article p")), true);
    });
    for (const extra of [false, true]) {
      await scenario(`paragraphs-only ${extra ? "extra" : "chapter"} restore and same selection`, async (page) => {
        const id = "position-old";
        const label = extra ? "Old appendix" : "Old first";
        await seedPlace(page, id, { ...(extra ? { extraId: "x0" } : {}), anchor: { chapter: 0, paragraph: 12, quote: paragraphs(label)[12].slice(0, 75), offset: 0 } });
        await open(page, id);
        await atParagraph(page, 12);
        await page.waitForTimeout(550);
        assert.equal((await progress(page, id)).anchor.paragraph, 12, "decorative heading is not a paragraph");
        await page.reload();
        await page.waitForSelector("article.book-body p");
        await atParagraph(page, 12);
        await pick(page, label);
        assert.equal(await page.evaluate(() => scrollY), 0);
      });
    }
    await scenario("repeated quote in a tall paragraph restores the saved occurrence", async (page) => {
      const quote = "The lantern keeper waited beside the river for the morning boat.";
      const filler = " A long path wound through the trees while small birds called from the branches.".repeat(45);
      const text = quote + filler + " " + quote + filler;
      const offset = text.lastIndexOf(quote);
      await page.evaluate(async (text) => {
        const request = indexedDB.open("cibian-books", 3);
        const db = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
        await new Promise((resolve, reject) => {
          const tx = db.transaction("books", "readwrite");
          const store = tx.objectStore("books");
          const get = store.get("position-old");
          get.onsuccess = () => { const book = get.result; book.chapters[0].paragraphs = [text]; store.put(book, book.id); };
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, text);
      await seedPlace(page, "position-old", { anchor: { chapter: 0, paragraph: 0, quote, offset } });
      await open(page, "position-old");
      const top = await page.locator("article p").evaluate((p, offset) => {
        const range = document.createRange();
        range.setStart(p.firstChild, offset);
        range.setEnd(p.firstChild, offset + 1);
        return range.getBoundingClientRect().top;
      }, offset);
      assert.ok(Math.abs(top - 98) <= 8, `second occurrence top=${top}`);
    });
    for (const missing of [false, true]) {
      await scenario(`wordbook ${missing ? "nearest fallback never flashes" : "matched jump flashes"}`, async (page) => {
        const sentence = missing ? "A vanished lantern is shining on another distant planet." : paragraphs("First")[12];
        await page.evaluate(({ sentence, missing }) => {
          const raw = JSON.parse(localStorage.getItem("cibian-notebook-v1"));
          raw.state.words = [{ id: "word", lemma: "lantern", surface: "lantern", pos: "noun", meaning: "A light", whyHard: "", recommend: true, sentence, stage: 0, dueAt: 0, createdAt: 1, reps: 0, lapses: 0,
            sources: [{ book: "book:positionhtml|test", title: "Position HTML", author: "Test", chapter: 0, surface: "lantern", sentence, savedAt: 1, at: { chapter: 0, paragraph: 12, quote: sentence.slice(0, 75), offset: 0 } }] }];
          localStorage.setItem("cibian-notebook-v1", JSON.stringify(raw));
        }, { sentence, missing });
        await page.goto(base + "words");
        await page.locator("[data-source-open]").click();
        await page.waitForSelector("article.book-body p");
        await atParagraph(page, 12);
        assert.equal(await page.locator(".book-flash").count(), missing ? 0 : 1);
      });
    }
  }
  for (const delay of ["before-frame", "before-debounce", "after-debounce"]) {
    await scenario(`scroll then leave ${delay}`, async (page) => {
      await open(page);
      await page.waitForTimeout(600);
      if (delay === "before-frame") {
        await page.evaluate(() => {
          window.dispatchEvent(new WheelEvent("wheel"));
          const p = document.querySelectorAll("article p")[12];
          window.scrollTo(0, scrollY + p.getBoundingClientRect().top - 96);
          window.dispatchEvent(new Event("scroll"));
          window.dispatchEvent(new PageTransitionEvent("pagehide"));
        });
      } else {
        await scrollToParagraph(page, 12);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (delay === "after-debounce") await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector('button[aria-label="Back to shelf"]').click());
        await page.waitForURL("**/shelf");
      }
      const saved = await progress(page);
      assert.equal(saved.anchor?.paragraph, 12, JSON.stringify(saved));
      await open(page);
      await atParagraph(page, 12);
    });
  }
  await scenario("backward chapter boundary then immediate leave", async (page) => {
    await seedPlace(page, "position-html", { chapter: 1 });
    await open(page);
    await page.waitForTimeout(600);
    // Leave in the first DOM commit of the preceding chapter, before its first rAF/save.
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector("article p")?.textContent.startsWith("First")) return;
        observer.disconnect();
        document.querySelector('button[aria-label="Back to shelf"]').click();
      });
      observer.observe(document.querySelector("article"), { childList: true, subtree: true });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true }));
    });
    await page.waitForURL("**/shelf");
    const saved = await progress(page);
    assert.equal(saved.chapter, 0, JSON.stringify(saved));
    assert.ok(saved.scroll > 0.9 && (!saved.anchor || saved.anchor.paragraph > 25), JSON.stringify(saved));
    await open(page);
    const y = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
    assert.ok(y.y > y.max * 0.85, JSON.stringify(y));
  });
  await scenario("opening a book keeps an unchanged place's time", async (page) => {
    // Showing the saved place is not a move. A fresh time here let the old place of a device that
    // had not synced yet beat the newer place of another device and be pushed back to the account.
    await seedPlace(page, "position-html", { chapter: 1, anchor: { chapter: 1, paragraph: 12, quote: paragraphs("Second")[12].slice(0, 75), offset: 0 } });
    await open(page);
    await atParagraph(page, 12);
    await page.waitForTimeout(1300);
    const saved = await progress(page);
    assert.equal(saved.chapter, 1, JSON.stringify(saved));
    assert.equal(saved.anchor?.paragraph, 12, JSON.stringify(saved));
    assert.equal(saved.updatedAt, 1, `restore must not refresh the time: ${JSON.stringify(saved)}`);
    await scrollToParagraph(page, 20);
    await page.waitForTimeout(600);
    const moved = await progress(page);
    assert.equal(moved.anchor?.paragraph, 20, JSON.stringify(moved));
    assert.ok(moved.updatedAt > 1, "a real move still gets a new time");
  });
  await scenario("an open book follows a newer place that arrives from sync", async (page) => {
    await open(page);
    await page.waitForTimeout(700);
    assert.ok((await page.locator("article p").first().textContent()).replace(/­/g, "").startsWith("First"));
    // What applyMerged does after a pull: replace the stored place, newer than this screen's.
    // Needs the Vite dev server, where the page and this import share one store module.
    const replaced = await page.evaluate(async (quote) => {
      // Import the same module URL the page loaded (Vite may add ?t= after an edit); a bare URL is a second store.
      const url = performance.getEntriesByType("resource").map((entry) => entry.name)
        .filter((name) => new URL(name).pathname === "/src/lib/progress-store.ts").pop();
      const store = url ? await import(url).catch(() => null) : null;
      if (!store) return false;
      const raw = { chapter: 1, chapters: 2, scroll: 0.5, updatedAt: Date.now() + 60_000,
        anchor: { chapter: 1, paragraph: 18, quote, offset: 0 }, extraId: "" };
      store.useProgress.setState((state) => ({ items: { ...state.items, "position-html": raw } }));
      return true;
    }, paragraphs("Second")[18].slice(0, 75));
    assert.ok(replaced, "run this scenario against the Vite dev server (it imports the live store)");
    // Hyphenation puts soft hyphens into the text ("Sec­ond"); compare without them.
    await page.waitForFunction(() => document.querySelector("article p")?.textContent.replace(/­/g, "").startsWith("Second"));
    await atParagraph(page, 18);
    await page.waitForTimeout(700);
    const saved = await progress(page);
    assert.equal(saved.chapter, 1, `the screen's next save keeps the synced chapter: ${JSON.stringify(saved)}`);
    assert.equal(saved.anchor?.paragraph, 18, JSON.stringify(saved));
  });
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
