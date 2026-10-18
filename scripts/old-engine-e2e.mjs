#!/usr/bin/env node
/**
 * The whole reader on an engine at our floor (Chrome 69), without the APIs a newer one has.
 *
 *   node scripts/old-engine-e2e.mjs [baseUrl]
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 *
 * The e-ink readers this app is for (Moaan, Boox, Hisense) run Android WebViews from Chrome 69
 * to the low 90s, and `polyfills.ts` exists for exactly the gap. It was dead code for a while:
 * `package.json` says `sideEffects: false`, so `import "@/lib/polyfills"` was dropped from the
 * bundle. Then the shelf worked (it never calls the newer methods) and opening a book threw
 * `Object.fromEntries is not a function` - a white page with no clue.
 *
 * This removes everything added after Chrome 69 and walks the app: the shelf must draw, a book
 * must open with its text, a word must open its card, and the id generator must answer.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const BOOK = "old-engine-book";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const SENTENCE =
  "The lantern seller walked down the long street and every window showed a small yellow light. He counted the doors and the stones under his feet, and then he stopped to listen to the rain on the roof.";
const CHAPTERS = [
  { title: "Chapter 1", paragraphs: [SENTENCE, SENTENCE], html: `<h2>Chapter 1</h2><p>${SENTENCE}</p><p>${SENTENCE}</p>` },
];
const GLOSS = { lantern: { pos: "noun", meaning: "a light you can carry", whyHard: "A less common word." } };

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

/** Everything the app may meet on Chrome 69..91, taken away before it runs. */
await page.addInitScript(() => {
  const drop = (object, keys) => {
    for (const key of keys) {
      try {
        delete object[key];
      } catch {
        try {
          object[key] = undefined;
        } catch {
          /* not configurable */
        }
      }
    }
  };
  drop(Object, ["fromEntries", "hasOwn", "groupBy"]);
  drop(Promise, ["allSettled", "any"]);
  drop(Array.prototype, ["at", "findLast", "findLastIndex", "toSorted", "toReversed", "toSpliced", "with"]);
  drop(String.prototype, ["at", "replaceAll"]);
  drop(Element.prototype, ["replaceChildren"]);
  drop(Document.prototype, ["replaceChildren"]);
  drop(DocumentFragment.prototype, ["replaceChildren"]);
  drop(window, ["structuredClone"]);
  // `randomUUID` lives on Crypto.prototype, so deleting it off the instance would do nothing.
  if (window.Crypto) drop(Crypto.prototype, ["randomUUID"]);
  if (window.Intl) drop(window.Intl, ["Segmenter"]);
});

await page.goto(BASE + "shelf");
await page.waitForTimeout(1500);
check((await page.locator("[data-tab-bar], nav").count()) > 0, "the shelf draws on a Chrome 69 baseline");
check(errors.length === 0, "the shelf throws nothing", errors.join(" | ") || "none");

const uuid = await page.evaluate(() => {
  try {
    return crypto.randomUUID();
  } catch (error) {
    return `threw: ${error.message}`;
  }
});
check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid), "an id can be minted (crypto.randomUUID)", uuid);

await page.evaluate(
  async ({ chapters, glossary, book }) => {
    const now = Date.now();
    localStorage.setItem(
      "cibian-notebook-v1",
      JSON.stringify({
        state: {
          books: [{ id: book, title: "Old Engine Book", author: "Nobody", cloth: "cloth", createdAt: now, updatedAt: now, source: "epub" }],
          words: [],
        },
        version: 0,
      }),
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books", 3);
      request.onupgradeneeded = () => {
        const made = request.result;
        for (const name of ["books", "covers", "notes"]) if (!made.objectStoreNames.contains(name)) made.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "notes"], "readwrite");
      tx.objectStore("books").put({ id: book, title: "Old Engine Book", author: "Nobody", chapters, glossary, pending: [], totalHard: 1 }, book);
      tx.objectStore("notes").put({ id: book, title: "Old Engine Book", author: "Nobody", glossary, pending: [], totalHard: 1 }, `gloss:${book}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  { chapters: CHAPTERS, glossary: GLOSS, book: BOOK },
);

await page.goto(BASE + "read/" + BOOK);
await page.waitForTimeout(2500);
const reading = await page.evaluate(() => {
  const article = document.querySelector("article.book-body");
  const box = article?.getBoundingClientRect();
  return {
    article: Boolean(article),
    words: article?.querySelectorAll("button[data-word]").length ?? 0,
    letters: (article?.textContent ?? "").replace(/\s+/g, "").length,
    height: box ? Math.round(box.height) : 0,
    visible: article ? getComputedStyle(article).visibility : "",
  };
});
check(reading.article && reading.words > 0, "a book opens with its words on a Chrome 69 baseline", `${reading.words} words, ${reading.letters} letters, ${reading.height}px tall`);
check(reading.visible === "visible" && reading.letters > 50, "the reading text is really drawn", `${reading.visible}, ${reading.letters} letters`);
check(errors.length === 0, "opening a book throws nothing", errors.join(" | ") || "none");

// a tap must open the word card, which is the other place that reaches for newer APIs
await page.locator('button[data-word="lantern"]').first().click();
await page.waitForTimeout(900);
const card = await page.evaluate(() => {
  const aside = document.querySelector("aside[data-word-card], [data-para-panel]");
  return { open: Boolean(aside), text: (aside?.textContent ?? "").replace(/\s+/g, " ").slice(0, 40) };
});
check(card.open, "a tapped word opens its card", card.text || "nothing");
check(errors.length === 0, "the card throws nothing", errors.join(" | ") || "none");

await page.screenshot({ path: process.env.SHOT ?? "old-engine.png" });
await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
