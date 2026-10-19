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
 *   - when the dictionary has no recording, both accents are tried and then exactly one fallback
 *     voice speaks - never two
 *   - an accented word is asked for whole ("café", never "caf")
 *   - the audio element is attached to the document (some Android WebViews will not start a
 *     detached one)
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
    paragraphs: [
      SENTENCE,
      "He counted the doors and the stones under his feet.",
      "A café stood on the corner.",
    ],
    html: `<h2>Chapter 1</h2><p>${SENTENCE}</p><p>He counted the doors and the stones under his feet.</p><p>A café stood on the corner.</p>`,
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

// Recorders instead of sound. Installed before the app runs: the reader builds its audio with
// `document.createElement("audio")`, so the prototype is where playback is observed.
await page.addInitScript(() => {
  window.__audios = [];
  window.__voices = [];
  window.__failAudio = false;
  const records = new WeakMap();
  const pending = new WeakMap();

  HTMLMediaElement.prototype.play = function () {
    const src = this.src || this.getAttribute("src") || "";
    const record = { src, attached: this.isConnected, playing: true };
    window.__audios.push(record);
    records.set(this, record);
    if (window.__failAudio) {
      record.playing = false;
      return Promise.reject(new TypeError("Failed to load because no supported source was found."));
    }
    return new Promise((resolve, reject) => {
      pending.set(this, { resolve, reject });
      setTimeout(() => {
        const waiting = pending.get(this);
        if (waiting) {
          pending.delete(this);
          waiting.resolve();
        }
      }, 30);
    });
  };
  HTMLMediaElement.prototype.pause = function () {
    const record = records.get(this);
    if (record) record.playing = false;
    const waiting = pending.get(this);
    if (!waiting) return;
    pending.delete(this);
    // What the browser does to a play() that a later call interrupts.
    const error = new Error("The play() request was interrupted by a call to pause()");
    error.name = "AbortError";
    waiting.reject(error);
  };

  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      paused: false,
      pending: false,
      speaking: false,
      getVoices: () => [],
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
          books: [
            {
              id: book,
              title: "Audio Book",
              author: "Nobody",
              cloth: "cloth",
              createdAt: now,
              updatedAt: now,
              source: "epub",
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
          title: "Audio Book",
          author: "Nobody",
          chapters,
          glossary,
          pending: [],
          totalHard: 2,
        },
        book,
      );
      tx.objectStore("notes").put(
        { id: book, title: "Audio Book", author: "Nobody", glossary, pending: [], totalHard: 2 },
        `gloss:${book}`,
      );
      // The phrase list lives beside the word list.
      tx.objectStore("notes").put(
        { rev: "", source: "custom", paragraphs: [], sentences: [], phrases },
        `extras:${book}`,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  { chapters: CHAPTERS, glossary: GLOSS, phrases: PHRASES, book: BOOK },
);

await page.goto(BASE + "read/" + BOOK);
await page.waitForTimeout(2500);

const reset = () =>
  page.evaluate(() => {
    window.__audios.length = 0;
    window.__voices.length = 0;
  });
const heard = () =>
  page.evaluate(() => ({
    audios: window.__audios.map((audio) => ({
      src: audio.src,
      playing: audio.playing,
      attached: audio.attached,
    })),
    voices: [...window.__voices],
  }));

// 1. a word inside a phrase: the phrase is said, once, with no fallback voice
await reset();
await page.locator('[role=button][data-word="lantern"]').first().click();
await page.waitForTimeout(900);
const phrase = await heard();
check(
  phrase.audios.length === 1 && /lantern(%20|\+| )seller/.test(phrase.audios[0].src),
  "a tap on a phrase word says the phrase once",
  phrase.audios.map((audio) => audio.src.split("audio=")[1]).join(" + ") || "nothing",
);
check(
  phrase.voices.length === 0,
  "no fallback voice is added",
  phrase.voices.join(" | ") || "none",
);

// 2. a word with no phrase: that word, once
await reset();
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(900);
const word = await heard();
check(
  word.audios.length === 1 && /audio=window/.test(word.audios[0].src),
  "a tap on a plain word says that word once",
  word.audios.map((audio) => audio.src.split("audio=")[1]).join(" + ") || "nothing",
);
check(
  word.voices.length === 0,
  "no fallback voice for a plain word",
  word.voices.join(" | ") || "none",
);

// 3. tapping twice does not stack voices
await page.locator('[role=button][data-word="lantern"]').first().click();
await page.waitForTimeout(120);
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(900);
const both = await heard();
const stillPlaying = both.audios.filter((audio) => audio.playing);
check(
  stillPlaying.length <= 1,
  "only one audio is left playing after a quick second tap",
  `${stillPlaying.length} of ${both.audios.length} still playing`,
);
check(
  both.voices.length === 0,
  "quick taps add no fallback voice",
  both.voices.join(" | ") || "none",
);

// 4. the dictionary has no recording: the other accent is tried, then exactly one voice
await page.evaluate(() => {
  window.__failAudio = true;
});
await reset();
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(1200);
const fallback = await heard();
check(
  fallback.audios.length === 2 && fallback.audios.every((audio) => !audio.playing),
  "a word with no recording is tried in both accents",
  fallback.audios.map((audio) => audio.src.split("type=")[1]).join(" + ") || "nothing",
);
check(
  fallback.voices.length === 1 && /^window$/i.test(fallback.voices[0]),
  "then the fallback voice says it once",
  fallback.voices.join(" | ") || "none",
);
await page.evaluate(() => {
  window.__failAudio = false;
});

// 5. the audio element is in the document: a detached one does not start on some Android WebViews
await reset();
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(600);
const attached = await heard();
check(
  attached.audios.length === 1 && attached.audios[0].attached,
  "the audio element is in the document when it plays",
  attached.audios[0] ? `attached=${attached.audios[0].attached}` : "nothing",
);

// 6. a word that ends in an accented letter is asked for whole, not cut down to its ASCII part
await reset();
await page.locator('[role=button][data-word="café"]').first().click();
await page.waitForTimeout(700);
const accented = await heard();
check(
  accented.audios.length === 1 && accented.audios[0].src.includes("audio=caf%C3%A9"),
  "an accented word reaches the dictionary whole",
  accented.audios[0] ? accented.audios[0].src.split("audio=")[1] : "nothing",
);

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
