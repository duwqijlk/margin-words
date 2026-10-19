#!/usr/bin/env node
/**
 * Page-turn mode and the dialogs, in a real browser.
 *
 *   node scripts/paging-e2e.mjs [baseUrl]
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 * The book is seeded into IndexedDB by this script, so no network and no account are needed.
 *
 * Checks:
 *   - a centered dialog (Settings, Account) is centered on its FIRST frame: no card that first
 *     paints with its corner at the middle of the screen and then jumps
 *   - PageDown / PageUp move exactly one screenful of text (the window height minus the top bar)
 *   - the last short strip of a chapter turns the page instead of being shown twice
 *   - a forward turn opens the next chapter at its top; a backward turn opens the previous one
 *     at its last line
 *   - a page is a WHOLE number of lines: the first line of the new page starts at the top bar,
 *     uncut, and no line is shown twice
 *   - a tap never turns the page, wherever it lands, and two taps turn nothing either:
 *     page-turn mode belongs to the keys and the reader's own page buttons
 */
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const BOOK = "probe-book";
const FOCUS = process.env.FOCUS === "1";
const FONT_SIZE = Number(process.env.FONT_SIZE ?? 20);
const SHOT = join(process.env.SHOT_DIR ?? tmpdir(), "paging-e2e.png");
// VIEWPORT=390x844 runs the same checks on a phone-sized screen.
const [VIEW_W, VIEW_H] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);

const para = (n) =>
  `<p>The lantern seller walked down the long street number ${n}, and every window showed a small yellow light. ` +
  `He counted the doors and the steps and the stones under his feet, then he stopped to listen to the rain on the roof.</p>`;
const CHAPTERS = [1, 2, 3].map((n) => ({
  title: `Chapter ${n}`,
  paragraphs: Array.from({ length: 30 }, (_, i) => para(n * 100 + i).replace(/<[^>]+>/g, "")),
  html: `<h2>Chapter ${n}</h2>` + Array.from({ length: 30 }, (_, i) => para(n * 100 + i)).join(""),
}));
const GLOSS = {
  lantern: { pos: "noun", meaning: "a light you can carry", whyHard: "A less common word." },
  seller: { pos: "noun", meaning: "a person who sells things", whyHard: "Two words joined." },
};

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });
page.on("pageerror", (error) => console.log("page error:", error.message));

await page.goto(BASE + "shelf");
await page.waitForTimeout(1200);

/* ---- a centered dialog must not move after its first frame */
await page.evaluate(() => {
  window.__boxes = [];
  const sample = () => {
    const el = document.querySelector("[role=dialog]");
    if (el) {
      const box = el.getBoundingClientRect();
      window.__boxes.push({
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      });
    }
    if (window.__boxes.length < 40) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
await page.click("[data-account-button]");
await page.waitForTimeout(700);
const boxes = await page.evaluate(() => window.__boxes);
const first = boxes[0];
const settled = boxes[boxes.length - 1];
const dx = Math.abs(settled.x - first.x);
const dy = Math.abs(settled.y - first.y);
check(
  boxes.length > 2 && dx <= 12 && dy <= 12,
  "the account dialog stays where it first paints",
  `center moved ${dx}px right and ${dy}px down over ${boxes.length} frames`,
);
await page.keyboard.press("Escape");

/* ---- seed one book, then read it */
await page.evaluate(
  async ({ chapters, glossary, book, focus, size }) => {
    localStorage.setItem("cibian-prefs-v1", JSON.stringify({ state: { focus, size }, version: 0 }));
    const now = Date.now();
    localStorage.setItem(
      "cibian-notebook-v1",
      JSON.stringify({
        state: {
          books: [
            {
              id: book,
              title: "Probe Book",
              author: "Nobody",
              cloth: "cloth",
              createdAt: now,
              updatedAt: now,
              source: "epub",
              lexile: "800L",
            },
          ],
          words: [],
        },
        version: 0,
      }),
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books", 3);
      request.onupgradeneeded = () => {
        const created = request.result;
        for (const name of ["books", "covers", "notes"])
          if (!created.objectStoreNames.contains(name)) created.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "notes"], "readwrite");
      tx.objectStore("books").put(
        {
          id: book,
          title: "Probe Book",
          author: "Nobody",
          chapters,
          glossary,
          pending: [],
          totalHard: Object.keys(glossary).length,
        },
        book,
      );
      tx.objectStore("notes").put(
        { id: book, title: "Probe Book", author: "Nobody", glossary, pending: [], totalHard: 2 },
        `gloss:${book}`,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  { chapters: CHAPTERS, glossary: GLOSS, book: BOOK, focus: FOCUS, size: FONT_SIZE },
);

await page.goto(BASE + "read/" + BOOK);
await page.waitForTimeout(2000);
check((await page.locator("article.book-body").count()) === 1, "the reader opens the seeded book");

const optionalKeys = await page.evaluate(() => {
  const send = (target, key) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return {
    arrow: send(document.body, "ArrowDown"),
    space: send(document.querySelector("header button"), " "),
  };
});
check(!optionalKeys.arrow, "with paging off, arrows keep their native behavior");
check(!optionalKeys.space, "Space on a header button is not intercepted for paging");

// No page-turn setting is written on purpose: this is the DEFAULT state (the setting is off),
// which is what almost every reader runs. PageDown must still turn exactly one page - leaving
// those keys to the engine is what silently bypassed the whole calculation on the e-readers.

const page_ = () =>
  page.evaluate(() => {
    const article = document.querySelector("article.book-body");
    const line = article ? Number.parseFloat(getComputedStyle(article).lineHeight) || 32 : 32;
    const header = document.querySelector("header")?.getBoundingClientRect();
    // Focus mode translates the header offscreen without changing its height.
    const bar = header ? Math.max(0, header.bottom) : 0;
    const visible = Math.max(
      120,
      Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) - bar,
    );
    return {
      y: Math.round(window.scrollY),
      max: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      chapter: document.querySelector("header p.text-xs")?.textContent ?? "",
      // The reader turns whole lines, keeping 4 of them back as tolerance (PAGE_KEEP_LINES).
      step:
        Math.floor(visible / line) - 4 >= 1
          ? Math.round((Math.floor(visible / line) - 4) * line)
          : Math.round(Math.min(visible, line)),
      line,
      visible: Math.round(visible),
    };
  });

const start = await page_();
check(
  start.step > 200,
  "one page is a whole number of lines, minus four kept back",
  `${start.step}px (${Math.round(start.step / start.line)} of ${Math.round(start.visible / start.line)} lines, ${start.line}px each)`,
);
check(
  start.visible - start.step >= start.line * 4 - 1,
  "a turn keeps four lines of the page just read on screen",
  `step ${start.step}px of ${start.visible}px visible`,
);

await page.keyboard.press("PageDown");
await page.waitForTimeout(600);
const afterDown = await page_();
check(
  Math.abs(afterDown.y - start.y - start.step) <= 3,
  "PageDown moves one page",
  `moved ${afterDown.y - start.y}px, one page is ${start.step}px`,
);

await page.keyboard.press("PageDown");
await page.waitForTimeout(600);
const afterTwo = await page_();
check(
  Math.abs(afterTwo.y - afterDown.y - start.step) <= 3,
  "the second PageDown moves one more page",
  `moved ${afterTwo.y - afterDown.y}px`,
);
check(
  Math.abs(afterTwo.y - Math.round(afterTwo.y / start.line) * start.line) <= 1,
  "the page break lands on a line, so the first line is not cut",
  `y=${afterTwo.y}px, line=${start.line}px`,
);

// The browser's own page scroll on top of ours (a WebView or a reader app that also scrolls on a
// page key). Six rounds of shrinking our own step never helped with this; the page guard puts the
// page back to exactly one of our pages.
const beforeExtra = await page_();
await page.evaluate(() => {
  window.addEventListener(
    "keydown",
    () => setTimeout(() => window.scrollBy(0, window.innerHeight), 40),
    { once: true, capture: true },
  );
});
await page.keyboard.press("PageDown");
await page.waitForTimeout(1000);
const afterExtra = await page_();
check(
  Math.abs(afterExtra.y - beforeExtra.y - start.step) <= 3,
  "a browser scroll on top of a turn is put back to one page",
  `moved ${afterExtra.y - beforeExtra.y}px, one page is ${start.step}px`,
);

await page.keyboard.press("PageUp");
await page.waitForTimeout(600);
const afterUp = await page_();
check(
  Math.abs(afterExtra.y - afterUp.y - start.step) <= 3,
  "PageUp moves back one full page",
  `moved ${afterExtra.y - afterUp.y}px`,
);
check(
  start.visible - start.step < 5 * start.line + 2,
  "overlap is bounded to four lines plus rounding, never a percentage of the screen",
);

// Setup jumps simulate a reader gesture, not an unowned native page-key jump.
// Otherwise the e-ink guard correctly undoes the test's own teleport.
const place = async (fromEnd) =>
  page.evaluate((offset) => {
    window.dispatchEvent(new WheelEvent("wheel"));
    window.scrollTo(
      0,
      offset === null ? 0 : document.documentElement.scrollHeight - window.innerHeight - offset,
    );
  }, fromEnd);

// the last short strip is shown, then the next turn opens the next chapter
await place(200);
await page.waitForTimeout(400);
await page.keyboard.press("PageDown");
await page.waitForTimeout(600);
const strip = await page_();
check(
  strip.chapter === afterTwo.chapter && Math.abs(strip.y - strip.max) <= 3,
  "the last strip is shown without skipping a line",
  `${strip.chapter} at ${strip.y}px of ${strip.max}px`,
);

await page.keyboard.press("PageDown");
await page.waitForTimeout(1000);
const stripNext = await page_();
check(
  stripNext.chapter !== strip.chapter && stripNext.y <= 4,
  "the turn after it opens the next chapter",
  `${stripNext.chapter} at ${stripNext.y}px`,
);

// at the bottom of a chapter: next chapter, top
await place(0);
await page.waitForTimeout(400);
await page.keyboard.press("PageDown");
await page.waitForTimeout(1000);
const nextChapter = await page_();
check(
  nextChapter.chapter !== stripNext.chapter && nextChapter.y <= 4,
  "a turn at the end of a chapter opens the next one at its top",
  `${nextChapter.chapter} at ${nextChapter.y}px`,
);

// at the top of a chapter: previous chapter, BOTTOM
await page.keyboard.press("PageUp");
await page.waitForTimeout(1400);
const previous = await page_();
check(
  previous.chapter === stripNext.chapter && Math.abs(previous.y - previous.max) <= 8,
  "a turn back opens the previous chapter at its last line",
  `${previous.chapter} at ${previous.y}px of ${previous.max}px`,
);

// a tap never turns the page - not in the margin, not in the middle, not twice
await place(null);
await page.waitForTimeout(400);
await page.mouse.click(VIEW_W - 14, Math.round(VIEW_H / 2));
await page.waitForTimeout(300);
await page.mouse.click(Math.round(VIEW_W / 2), Math.round(VIEW_H / 2));
await page.waitForTimeout(300);
await page.mouse.click(VIEW_W - 14, Math.round(VIEW_H / 2));
await page.waitForTimeout(80);
await page.mouse.click(VIEW_W - 14, Math.round(VIEW_H / 2));
await page.waitForTimeout(600);
const tapped = await page_();
check(tapped.y === 0, "taps do not turn the page", `${tapped.y}px after four taps`);

await page.screenshot({ path: SHOT });
await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
