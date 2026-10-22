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
 * Local-IPA builds additionally exercise the actual UK/US reader buttons in isolated contexts:
 * accent-only recordings/voices, localized failure feedback, 8s start deadlines and stale races.
 * Normal builds explicitly skip these cases. PRONOUNCE_REQUIRE_ACCENTS=1 forbids that skip.
 * No server is started or build performed; all external/account/catalog requests are intercepted.
 * The bug this guards: the word's `play()` was paused by the phrase, rejected with `AbortError`,
 * the catch took that for a failure and spoke the word with the fallback voice - two voices.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const BOOK = "audio-book";

let failures = 0;
let checks = 0;
let explicitCases = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
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
const pageErrors = [];

// Every run uses disposable storage, never a real browser profile. Route everything before app
// boot: even audio preloads, account checks and catalogs cannot reach an external service.
async function freshReader(locale = "en") {
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 }, locale: locale === "zh" ? "zh-CN" : "en-US",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/catalog.json"))
      return route.fulfill({ contentType: "application/json", body: '{"version":1,"books":[],"packs":[]}' });
    if (url.origin !== new URL(BASE).origin) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Synthetic offline fixture"}' });
    if (/\/(?:packs|public-books|word-lists)\//.test(url.pathname) || /\.(?:epub|pack\.zip)$/i.test(url.pathname))
      return route.abort("blockedbyclient");
    return route.continue();
  });
  await context.addInitScript(installRecorders);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const blank = new URL("__pronounce_fixture_seed__", BASE).href;
  await page.route(blank, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Pronunciation fixture</title>" }));
  await page.goto(blank);
  await seedReader(page, locale);
  await page.goto(BASE + "read/" + BOOK);
  await page.locator('[role=button][data-word="window"]').first().waitFor();
  return { context, page };
}

// Installed before the app. Observe the prototype because the app creates attached elements,
// not `new Audio`. Deferred failures intentionally survive pause() to exercise stale callbacks.
function installRecorders() {
  window.__audios = [];
  window.__voices = [];
  window.__voiceRecords = [];
  window.__availableVoices = [];
  window.__failAudio = false;
  window.__audioMode = "success";
  window.__synthMode = "success";
  const records = new WeakMap(), pending = new WeakMap(), sources = new WeakMap();
  const elements = [], utterances = [], synthTimers = new Set();
  window.__clearRecords = () => {
    window.__audios.length = window.__voices.length = window.__voiceRecords.length = 0;
    elements.length = utterances.length = 0;
  };
  // No real media resource is ever loaded, including native preloads before play().
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true, get() { return sources.get(this) || ""; },
    set(value) { sources.set(this, new URL(value, location.href).href); },
  });
  window.__audioError = (index) => elements[index].dispatchEvent(new Event("error"));
  window.__rejectAudio = (index) => window.__audios[index].reject?.(new Error("Synthetic late recording failure"));
  window.__ttsError = (index) => utterances[index].error?.({ error: "synthesis-failed" });
  HTMLMediaElement.prototype.play = function () {
    const mode = window.__failAudio ? "reject" : window.__audioMode;
    const record = { src: this.src, attached: this.isConnected, playing: false, mode };
    window.__audios.push(record);
    elements.push(this);
    records.set(this, record);
    if (mode === "throw") throw new Error("Synthetic synchronous play failure");
    if (mode === "reject") return Promise.reject(new Error("Synthetic recording unavailable"));
    return new Promise((resolve, reject) => {
      record.reject = reject;
      pending.set(this, { resolve, reject });
      if (mode === "hold" || mode === "never") return;
      setTimeout(() => {
        if (!pending.has(this)) return;
        pending.delete(this);
        record.playing = true;
        this.dispatchEvent(new Event("playing"));
        resolve();
      }, 30);
    });
  };
  HTMLMediaElement.prototype.pause = function () {
    const record = records.get(this);
    if (record) record.playing = false;
    const waiting = pending.get(this);
    pending.delete(this);
    if (!waiting || record?.mode === "hold" || record?.mode === "never") return;
    const error = new Error("The play() request was interrupted by a call to pause()");
    error.name = "AbortError";
    waiting.reject(error);
  };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    paused: false, pending: false, speaking: false,
    getVoices: () => window.__availableVoices,
    cancel() {
      for (const timer of synthTimers) clearTimeout(timer);
      synthTimers.clear();
      window.__voiceRecords.forEach(record => { record.playing = false; });
    },
    resume() {},
    speak(utterance) {
      window.__voices.push(utterance.text);
      const record = { text: utterance.text, lang: utterance.lang,
        voice: utterance.voice?.lang ?? null, name: utterance.voice?.name ?? null, playing: false };
      window.__voiceRecords.push(record);
      utterances.push({ error: utterance.onerror });
      const mode = window.__synthMode;
      if (mode === "throw") throw new Error("Synthetic synchronous synthesis failure");
      if (mode === "never") return;
      const timer = setTimeout(() => {
        synthTimers.delete(timer);
        if (mode === "error") utterance.onerror?.({ error: "synthesis-failed" });
        else { record.playing = true; utterance.onstart?.({}); }
      }, 30);
      synthTimers.add(timer);
    },
  } });
}

async function seedReader(page, locale) {
await page.evaluate(
  async ({ chapters, glossary, phrases, book, locale }) => {
    if (localStorage.getItem("cibian-notebook-v1")) throw new Error("Expected isolated fixture storage");
    localStorage.setItem("cibian-locale-v1", locale);
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
  { chapters: CHAPTERS, glossary: GLOSS, phrases: PHRASES, book: BOOK, locale },
);
}

try {
const { context, page } = await freshReader();
await page.waitForTimeout(2500);

const reset = () => page.evaluate(() => window.__clearRecords());
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
  fallback.audios.length === 2 && fallback.audios.every((audio) => !audio.playing)
    && fallback.audios.map((audio) => new URL(audio.src).searchParams.get("type")).join(",") === "2,1",
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

// Optional IPA is absent from the normal build. Never silently skip a broken enabled build:
// a mounted IPA region must become ready; CI can require the feature explicitly with this flag.
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(800);
const ipa = page.locator('[data-word-ipa][data-ipa-word="window"]');
if (await ipa.count()) {
  await ipa.locator('xpath=self::*[@data-ipa-status="ready"]').waitFor();
  check(await ipa.locator('[data-speak-accent]').count() === 2, "enabled reader exposes UK and US buttons for window");
  await context.close();
  await explicitSuite();
} else {
  check(await page.locator('[data-word-header] [data-speak]:not([data-speak-accent])').count() === 1,
    "normal-build word card retains its generic listen button");
  check(process.env.PRONOUNCE_REQUIRE_ACCENTS !== "1", "normal build has no explicit-accent controls",
    process.env.PRONOUNCE_REQUIRE_ACCENTS === "1" ? "PRONOUNCE_REQUIRE_ACCENTS=1 requires the local-IPA build" : "SKIP explicit-accent cases (IPA feature disabled)");
  await context.close();
}
check(pageErrors.length === 0, "no uncaught app errors", pageErrors.join(" | "));
} catch (error) {
  check(false, "pronunciation suite completed", error.stack || error.message);
} finally {
  await browser.close();
}
console.log(`\n${checks - failures}/${checks} checks passed; ${explicitCases} explicit-accent cases; ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

async function explicitSuite() {
  const button = (page, accent) => page.locator(`[data-word-ipa] [data-speak-accent="${accent}"]`);
  const state = async (page, accent, expected, timeout = 2000) => {
    await button(page, accent).locator(`xpath=self::*[@data-speak-status="${expected}"]`).waitFor({ timeout });
  };
  const heard = (page) => page.evaluate(() => ({
    audios: window.__audios.map(({ src, attached, playing }) => ({ src, attached, playing })),
    voices: window.__voiceRecords,
  }));
  const configure = (page, options) => page.evaluate(options => {
    if (options.audio) window.__audioMode = options.audio;
    if (options.tts) window.__synthMode = options.tts;
    if (options.voices) window.__availableVoices = options.voices;
  }, options);
  const voice = (accent) => ({ name: `Synthetic ${accent}`, lang: accent === "UK" ? "en-GB" : "en-US", localService: true });
  const allVoices = [{ name: "System default", lang: "fr-FR", default: true }, voice("US"), voice("UK")];
  function recording(actual, accent, count = 1) {
    assert.equal(actual.audios.length, count, "one requested-accent recording per tap, never the opposite accent");
    for (const audio of actual.audios) {
      const url = new URL(audio.src);
      assert.equal(url.searchParams.get("type"), accent === "UK" ? "1" : "2");
      assert.equal(url.searchParams.get("audio"), "window", "speak displayed word, not IPA");
      assert.ok(audio.attached, "audio must be attached before play()");
    }
  }
  async function failed(page, accent, locale = "en") {
    await state(page, accent, "failed");
    const control = button(page, accent).locator('xpath=ancestor::*[@data-speak-control]');
    const error = control.locator('[data-speak-error][role="status"]');
    await error.waitFor({ state: "visible" });
    const expected = locale === "zh"
      ? String.fromCodePoint(accent === "UK" ? 0x82f1 : 0x7f8e, 0x97f3, 0x6682, 0x65f6, 0x65e0, 0x6cd5,
        0x64ad, 0x653e, 0xff0c, 0x70b9, 0x4e00, 0x4e0b, 0x91cd, 0x8bd5, 0x3002)
      : `${accent === "UK" ? "British" : "American"} pronunciation is unavailable. Tap to retry.`;
    assert.equal((await error.innerText()).trim(), expected, "visible localized failure, not just a tooltip");
    assert.equal(await button(page, accent).getAttribute("title"), expected);
  }
  async function run(name, fn, locale = "en") {
    explicitCases += 1;
    let context;
    try {
      const reader = await freshReader(locale);
      context = reader.context;
      const page = reader.page;
      await page.locator('[role=button][data-word="window"]').first().click();
      await page.locator('[data-word-ipa][data-ipa-status="ready"]').waitFor();
      await button(page, "UK").waitFor();
      await button(page, "US").waitFor();
      // Let the ordinary reader auto-pronunciation settle before clearing observations.
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__clearRecords());
      await fn(page);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.words), [], "pronunciation never saves a word");
      check(true, name);
    } catch (error) { check(false, name, error.stack || error.message); }
    finally { await context?.close(); }
  }

  for (const accent of ["UK", "US"]) {
    await run(`${accent}: dictionary uses only requested accent`, async page => {
      await button(page, accent).click();
      await state(page, accent, "started");
      const actual = await heard(page);
      recording(actual, accent);
      assert.equal(actual.audios.filter(audio => audio.playing).length, 1);
      assert.deepEqual(actual.voices, []);
      assert.equal(await page.locator('[data-speak-error]').count(), 0);
    });
    await run(`${accent}: rejected recording falls back only to matching device voice`, async page => {
      await configure(page, { audio: "reject", voices: allVoices });
      await button(page, accent).click();
      await state(page, accent, "started");
      const actual = await heard(page);
      recording(actual, accent);
      assert.equal(actual.voices.length, 1);
      assert.deepEqual(actual.voices[0], { text: "window", lang: voice(accent).lang,
        voice: voice(accent).lang, name: voice(accent).name, playing: true });
      assert.equal(actual.audios.filter(audio => audio.playing).length, 0);
      assert.equal(await page.locator('[data-speak-error]').count(), 0);
    });
    await run(`${accent}: opposite/default voices never satisfy explicit playback`, async page => {
      await configure(page, { audio: "reject", voices: [allVoices[0], voice(accent === "UK" ? "US" : "UK"),
        { name: "Other English", lang: "en-AU" }] });
      await button(page, accent).click();
      await failed(page, accent);
      const actual = await heard(page);
      recording(actual, accent);
      assert.deepEqual(actual.voices, [], "no opposite, generic English, or system default voice");
    });
    await run(`${accent}: empty voices are retried on the next tap`, async page => {
      await configure(page, { audio: "reject", voices: [] });
      await button(page, accent).click();
      await failed(page, accent);
      assert.deepEqual((await heard(page)).voices, []);
      await configure(page, { voices: [voice(accent)] });
      await button(page, accent).click();
      await state(page, accent, "started");
      const actual = await heard(page);
      recording(actual, accent, 2);
      assert.equal(actual.voices.length, 1, "newly loaded matching voice is selected once");
      assert.equal(actual.voices[0].voice, voice(accent).lang);
      assert.equal(await page.locator('[data-speak-error]').count(), 0, "retry clears failure feedback");
    });
  }
  await run("switching accents never reuses the previous cached synthesis voice", async page => {
    await configure(page, { audio: "reject", voices: allVoices });
    for (const accent of ["UK", "US", "UK"]) {
      await button(page, accent).click();
      await state(page, accent, "started");
    }
    const actual = await heard(page);
    assert.deepEqual(actual.audios.map(audio => new URL(audio.src).searchParams.get("type")), ["1", "2", "1"]);
    assert.deepEqual(actual.voices.map(utterance => [utterance.text, utterance.lang, utterance.voice]),
      [["window", "en-GB", "en-GB"], ["window", "en-US", "en-US"], ["window", "en-GB", "en-GB"]]);
    assert.deepEqual(actual.voices.map(utterance => utterance.playing), [false, false, true]);
  });
  await run("synchronous play() throw follows the same accent-only fallback", async page => {
    await configure(page, { audio: "throw", voices: allVoices });
    await button(page, "UK").click();
    await state(page, "UK", "started");
    const actual = await heard(page);
    recording(actual, "UK");
    assert.equal(actual.voices.length, 1);
    assert.equal(actual.voices[0].voice, "en-GB");
  });
  await run("media error after start becomes failed without a second voice", async page => {
    await configure(page, { voices: allVoices });
    await button(page, "UK").click();
    await state(page, "UK", "started");
    await page.evaluate(() => window.__audioError(0));
    await failed(page, "UK");
    const actual = await heard(page);
    recording(actual, "UK");
    assert.deepEqual(actual.voices, []);
    assert.ok(actual.audios.every(audio => !audio.playing));
  });
  for (const tts of ["error", "throw"]) await run(`TTS ${tts} produces visible localized failure`, async page => {
    await configure(page, { audio: "reject", voices: allVoices, tts });
    await button(page, "US").click();
    await failed(page, "US", tts === "error" ? "zh" : "en");
    const actual = await heard(page);
    recording(actual, "US");
    assert.equal(actual.voices.length, 1);
    assert.equal(actual.voices[0].voice, "en-US");
  }, tts === "error" ? "zh" : "en");
  await run("TTS error after onstart changes started to failed", async page => {
    await configure(page, { audio: "reject", voices: allVoices });
    await button(page, "US").click();
    await state(page, "US", "started");
    await page.evaluate(() => window.__ttsError(0));
    await failed(page, "US");
    assert.equal((await heard(page)).voices.length, 1);
  });
  for (const source of ["recording", "TTS"]) await run(`${source} that never starts fails within the 8s bound`, async page => {
    await configure(page, { audio: source === "recording" ? "never" : "reject",
      voices: source === "recording" ? [] : allVoices, tts: "never" });
    const started = Date.now();
    await button(page, "UK").click();
    await state(page, "UK", "loading");
    await page.waitForTimeout(100);
    assert.equal(await button(page, "UK").getAttribute("data-speak-status"), "loading", "queued is not reported as started");
    await state(page, "UK", "failed", 10000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 7500 && elapsed <= 10500, `8s start deadline, observed ${elapsed}ms`);
    await failed(page, "UK");
    const actual = await heard(page);
    recording(actual, "UK");
    assert.equal(actual.voices.length, source === "recording" ? 0 : 1);
    assert.ok(actual.audios.every(audio => !audio.playing));
    assert.ok(actual.voices.every(utterance => !utterance.playing));
  });
  await run("stale recording failure cannot overwrite a newer same-button request", async page => {
    await configure(page, { audio: "hold", voices: allVoices });
    await button(page, "UK").click();
    await state(page, "UK", "loading");
    await configure(page, { audio: "success" });
    await button(page, "UK").click();
    await state(page, "UK", "started");
    await page.evaluate(() => { window.__rejectAudio(0); window.__audioError(0); });
    await page.waitForTimeout(150);
    await state(page, "UK", "started");
    const actual = await heard(page);
    recording(actual, "UK", 2);
    assert.deepEqual(actual.voices, []);
    assert.deepEqual(actual.audios.map(audio => audio.playing), [false, true]);
    assert.equal(await page.locator('[data-speak-error]').count(), 0);
  });
  await run("stale TTS callback cannot fail or cancel a newer request", async page => {
    await configure(page, { audio: "reject", voices: allVoices });
    await button(page, "UK").click();
    await state(page, "UK", "started");
    await configure(page, { audio: "success" });
    await button(page, "US").click();
    await state(page, "US", "started");
    await page.evaluate(() => window.__ttsError(0));
    await page.waitForTimeout(150);
    await state(page, "US", "started");
    await state(page, "UK", "aborted");
    const actual = await heard(page);
    assert.deepEqual(actual.audios.map(audio => audio.playing), [false, true]);
    assert.equal(actual.voices.length, 1);
    assert.equal(actual.voices[0].playing, false);
    assert.equal(await page.locator('[data-speak-error]').count(), 0);
  });
  await run("rapid UK -> US -> generic phrase leaves exactly one current audio", async page => {
    assert.equal(await page.locator('[data-word-header] [data-speak]:not([data-speak-accent])').count(), 0,
      "IPA-enabled word cards have only UK/US, never a redundant generic header button");
    // Use the real reader phrase caller for the no-argument request. It remains generic even
    // when the optional IPA feature removes the redundant word-header listen control.
    await page.evaluate(() => {
      window.__audioMode = "hold";
      document.querySelector('[data-word-ipa] [data-speak-accent="UK"]').click();
      document.querySelector('[data-word-ipa] [data-speak-accent="US"]').click();
      window.__audioMode = "success";
      document.querySelector('[role="button"][data-word="lantern"]').click();
    });
    const generic = page.locator('[data-word-header] [data-speak]:not([data-speak-accent])');
    await generic.waitFor();
    assert.match(await generic.getAttribute("aria-label"), /lantern seller/,
      "phrase card retains its generic listen button");
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__rejectAudio(0); window.__rejectAudio(1); });
    await page.waitForTimeout(100);
    const actual = await heard(page);
    assert.deepEqual(actual.audios.map(audio => new URL(audio.src).searchParams.get("type")), ["1", "2", "2"]);
    assert.deepEqual(actual.audios.map(audio => new URL(audio.src).searchParams.get("audio")),
      ["window", "window", "lantern seller"]);
    assert.ok(actual.audios.every(audio => audio.attached));
    assert.deepEqual(actual.audios.map(audio => audio.playing), [false, false, true]);
    assert.deepEqual(actual.voices, []);
    assert.equal(await page.locator('[data-speak-error]').count(), 0, "aborted requests do not show failure");
  });
}
