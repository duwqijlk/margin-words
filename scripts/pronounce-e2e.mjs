#!/usr/bin/env node
/**
 * Pronunciation: exactly one voice per tap.
 *
 *   node scripts/pronounce-e2e.mjs [baseUrl]
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 *
 * The book is seeded into IndexedDB. `Audio` and `speechSynthesis` are replaced with recorders,
 * so nothing is downloaded or spoken:
 *   - a tap on a word that belongs to a phrase says the PHRASE once (one audio, no fallback voice)
 *   - a tap on any other word says that word once
 *   - a second tap never stacks a second voice
 * The bug this guards: the word's `play()` was paused by the phrase, rejected with `AbortError`,
 * the catch took that for a failure and spoke the word with the fallback voice - two voices.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const BOOK = "audio-book";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const SENTENCE =
  "The lantern seller walked down the long street and every window showed a small yellow light.";
const CHAPTERS = [
  {
    title: "Chapter 1",
    paragraphs: [SENTENCE, "He counted the doors and the stones under his feet."],
    html: `<h2>Chapter 1</h2><p>${SENTENCE}</p><p>He counted the doors and the stones under his feet.</p>`,
  },
];
const GLOSS = {
  lantern: { pos: "noun", meaning: "a light you can carry", whyHard: "A less common word." },
  window: { pos: "noun", meaning: "glass you look through", whyHard: "Common, but useful." },
};
const PHRASES = {
  "lantern seller": { meaning: "a person who sells lanterns", pos: "phrase" },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (error) => console.log("page error:", error.message));

// Recorders instead of sound. Installed before the app runs.
await page.addInitScript(() => {
  window.__audios = [];
  window.__voices = [];
  class RecordedAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      window.__audios.push(this);
    }
    play() {
      this.paused = false;
      return new Promise((resolve, reject) => {
        this._reject = reject;
        setTimeout(() => {
          if (!this.paused) resolve();
        }, 40);
      });
    }
    pause() {
      const wasPlaying = !this.paused;
      this.paused = true;
      if (this._reject) {
        // What the browser does to a play() that a later call interrupts.
        const error = new Error("The play() request was interrupted by a call to pause()");
        error.name = "AbortError";
        this._reject(error);
      }
      this.__wasPlaying = wasPlaying;
    }
  }
  window.Audio = RecordedAudio;
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      paused: false,
      cancel() {},
      resume() {},
      speak(utterance) {
        window.__voices.push(utterance.text);
      },
    },
  });
});

await page.goto(BASE + "shelf");
await page.waitForTimeout(1000);

await page.evaluate(
  async ({ chapters, glossary, phrases, book }) => {
    const now = Date.now();
    localStorage.setItem(
      "cibian-notebook-v1",
      JSON.stringify({
        state: {
          books: [{ id: book, title: "Audio Book", author: "Nobody", cloth: "cloth", createdAt: now, updatedAt: now, source: "epub" }],
          words: [],
        },
        version: 0,
      }),
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cibian-books", 3);
      request.onupgradeneeded = () => {
        const created = request.result;
        for (const name of ["books", "covers", "notes"]) if (!created.objectStoreNames.contains(name)) created.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "notes"], "readwrite");
      tx.objectStore("books").put(
        { id: book, title: "Audio Book", author: "Nobody", chapters, glossary, pending: [], totalHard: 2 },
        book,
      );
      tx.objectStore("notes").put({ id: book, title: "Audio Book", author: "Nobody", glossary, pending: [], totalHard: 2 }, `gloss:${book}`);
      // The phrase list lives beside the word list.
      tx.objectStore("notes").put({ rev: "", source: "custom", paragraphs: [], sentences: [], phrases }, `extras:${book}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  { chapters: CHAPTERS, glossary: GLOSS, phrases: PHRASES, book: BOOK },
);

await page.goto(BASE + "read/" + BOOK);
await page.waitForTimeout(2500);

const reset = () => page.evaluate(() => {
  window.__audios.length = 0;
  window.__voices.length = 0;
});
const heard = () => page.evaluate(() => ({
  audios: window.__audios.map((audio) => ({ src: audio.src, paused: audio.paused })),
  voices: [...window.__voices],
}));

// 1. a word inside a phrase: the phrase is said, once, with no fallback voice
await reset();
await page.locator('button[data-word="lantern"]').first().click();
await page.waitForTimeout(900);
const phrase = await heard();
check(
  phrase.audios.length === 1 && /lantern(%20|\+| )seller/.test(phrase.audios[0].src),
  "a tap on a phrase word says the phrase once",
  phrase.audios.map((audio) => audio.src.split("audio=")[1]).join(" + ") || "nothing",
);
check(phrase.voices.length === 0, "no fallback voice is added", phrase.voices.join(" | ") || "none");

// 2. a word with no phrase: that word, once
await reset();
await page.locator('button[data-word="window"]').first().click();
await page.waitForTimeout(900);
const word = await heard();
check(
  word.audios.length === 1 && /audio=window/.test(word.audios[0].src),
  "a tap on a plain word says that word once",
  word.audios.map((audio) => audio.src.split("audio=")[1]).join(" + ") || "nothing",
);
check(word.voices.length === 0, "no fallback voice for a plain word", word.voices.join(" | ") || "none");

// 3. tapping twice does not stack voices
await page.locator('button[data-word="lantern"]').first().click();
await page.waitForTimeout(120);
await page.locator('button[data-word="window"]').first().click();
await page.waitForTimeout(900);
const both = await heard();
const stillPlaying = both.audios.filter((audio) => !audio.paused);
check(
  stillPlaying.length <= 1,
  "only one audio is left playing after a quick second tap",
  `${stillPlaying.length} of ${both.audios.length} still playing`,
);
check(both.voices.length === 0, "quick taps add no fallback voice", both.voices.join(" | ") || "none");

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
