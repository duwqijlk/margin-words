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
 * Production and local-IPA builds additionally exercise the actual UK/US reader buttons in isolated contexts:
 * explicit accents use one direct uapis audio URL for the requested accent, never another accent
 * or SpeechSynthesis. They speak the word, not the displayed IPA.
 * These cases cover exact accent URLs, visible localized failures, attached media, 8s playback start
 * deadlines, retries, and stale/cancellation races. Generic callers try the selected accent,
 * the other recording, then the device voice. PRONOUNCE_DEFAULT_ONLY=1 checks Settings,
 * persistence, whole phrases and explicit controls only (PRONOUNCE_SCREENSHOTS=1 for proof).
 * PRONOUNCE_REQUIRE_ACCENTS=1 requires the explicit-accent cases.
 * No server is started or build performed; all external/account/catalog requests are intercepted.
 * The bug this guards: the word's `play()` was paused by the phrase, rejected with `AbortError`,
 * the catch took that for a failure and spoke the word with the fallback voice - two voices.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
  window.__audioSources = [];
  window.__uapisAudioSources = [];
  window.__synthCancels = 0;
  window.__voices = [];
  window.__voiceRecords = [];
  window.__availableVoices = [];
  window.__failAudio = false;
  window.__audioMode = "success";
  window.__synthMode = "success";
  const records = new WeakMap(), pending = new WeakMap(), sources = new WeakMap();
  const elements = [], utterances = [], synthTimers = new Set();
  window.__clearRecords = () => {
    window.__audios.length = window.__audioSources.length = window.__uapisAudioSources.length = window.__voices.length = window.__voiceRecords.length = 0;
    window.__synthCancels = 0;
    elements.length = utterances.length = 0;
  };
  // No real media resource is ever loaded, including native preloads before play().
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true, get() { return sources.get(this) || ""; },
    set(value) {
      const src = new URL(value, location.href).href;
      sources.set(this, src);
      window.__audioSources.push(src);
      if (src.startsWith('https://uapis.cn/')) window.__uapisAudioSources.push(src);
    },
  });
  window.__audioError = (index) => elements[index].dispatchEvent(new Event("error"));
  window.__rejectAudio = (index) => window.__audios[index].reject?.(new Error("Synthetic late recording failure"));
  // Keep original callbacks even if production clears them when cancelling an utterance.
  // Manual delivery does not simulate playback: stale events must not revive cancelled speech.
  window.__ttsStart = (index) => utterances[index].start?.({});
  window.__ttsEnd = (index) => utterances[index].end?.({});
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
      window.__synthCancels += 1;
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
      utterances.push({ start: utterance.onstart, end: utterance.onend, error: utterance.onerror });
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

async function defaultAccentSuite() {
  const { context, page } = await freshReader();
  try {
    for (const accent of ["UK", "US"]) {
      await page.goto(new URL("shelf", BASE).href);
      await page.locator('[data-account-button]').click();
      const control = page.locator('[data-settings-pronunciation]');
      await control.getByRole('button', { name: accent, exact: true }).click();
      assert.equal(await control.getByRole('button', { name: accent, exact: true }).getAttribute('aria-pressed'), 'true');
      if (process.env.PRONOUNCE_SCREENSHOTS === '1') {
        await mkdir('local-exports/accent-proof', { recursive: true });
        for (const width of [900, 375]) {
          await page.setViewportSize({ width, height: 850 });
          const dialog = page.getByRole('dialog');
          assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'settings has no horizontal overflow');
          await page.screenshot({ path: `local-exports/accent-proof/settings-${accent}-${width}.png` });
        }
        await page.setViewportSize({ width: 900, height: 900 });
      }
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.goto(BASE + 'read/' + BOOK);
      await page.locator('[role=button][data-word="window"]').first().waitFor();
      await page.reload();
      await page.locator('[role=button][data-word="window"]').first().waitFor();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.pronunciationAccent);
      assert.equal(saved, accent);
      check(true, `${accent}: Settings selection persists after reload`);
      for (const [surface, expected] of [['window', 'window'], ['lantern', 'lantern seller']]) {
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__clearRecords());
        await page.locator(`[role=button][data-word="${surface}"]`).first().click();
        await page.waitForFunction(() => window.__audioSources.length > 0);
        await page.waitForTimeout(350);
        const urls = await page.evaluate(() => [...window.__audioSources]);
        assert.equal(urls.length, 1);
        const url = new URL(urls[0]);
        assert.equal(url.hostname, 'uapis.cn');
        assert.equal(url.searchParams.get('word'), expected);
        assert.equal(url.searchParams.get('accent'), accent.toLowerCase());
        if (surface === 'lantern') {
          assert.equal(await page.locator('[data-word-ipa]').count(), 0, 'phrase has no invented IPA');
          assert.equal(await page.locator('[data-word-header] [data-speak]').count(), 0, 'phrase has no redundant generic speaker');
          for (const explicit of ['UK', 'US']) {
            await page.evaluate(() => window.__clearRecords());
            const button = page.locator(`[data-phrase-audio] [data-speak-accent="${explicit}"]`);
            await button.click();
            await page.waitForFunction(() => window.__audioSources.length > 0);
            const sources = await page.evaluate(() => [...window.__audioSources]);
            assert.equal(sources.length, 1);
            assert.equal(new URL(sources[0]).searchParams.get('word'), 'lantern seller');
            assert.equal(new URL(sources[0]).searchParams.get('accent'), explicit.toLowerCase());
          }
          if (process.env.PRONOUNCE_SCREENSHOTS === '1') {
            for (const width of [900, 375]) {
              await page.setViewportSize({ width, height: 850 });
              await page.screenshot({ path: `local-exports/accent-proof/phrase-${accent}-${width}.png` });
            }
            await page.setViewportSize({ width: 900, height: 900 });
          }
          check(true, `${accent}: phrase UK/US buttons request the full phrase without IPA`);
        }
        check(true, `${accent}: ${expected} uses the complete target and selected accent`);
      }
      await page.keyboard.press('Escape');
      await page.locator('[role=button][data-word="window"]').first().click();
      for (const explicit of ['UK', 'US']) {
        const button = page.locator(`[data-speak-accent="${explicit}"]`);
        await button.waitFor();
        await page.evaluate(() => window.__clearRecords());
        await button.click();
        await page.waitForFunction(() => window.__audioSources.length > 0);
        const urls = await page.evaluate(() => [...window.__audioSources]);
        assert.equal(urls.length, 1);
        assert.equal(new URL(urls[0]).searchParams.get('accent'), explicit.toLowerCase());
      }
      check(true, `${accent}: explicit IPA buttons ignore the default preference`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        window.__clearRecords(); window.__failAudio = true;
        window.__availableVoices = ['en-US', 'en-GB'].map(lang => ({ lang, name: lang, localService: true }));
      });
      await page.locator('[role=button][data-word="window"]').first().click();
      await page.waitForFunction(() => window.__voiceRecords.length > 0);
      const actual = await page.evaluate(() => ({ urls: [...window.__audioSources], voice: window.__voiceRecords[0].voice }));
      assert.deepEqual(actual.urls.map(url => new URL(url).searchParams.get('accent')),
        accent === 'UK' ? ['uk', 'us'] : ['us', 'uk']);
      assert.equal(actual.voice, accent === 'UK' ? 'en-GB' : 'en-US');
      check(true, `${accent}: generic fallback order and device voice prefer the selection`);
      await page.evaluate(() => { window.__failAudio = false; });
    }
  } finally { await context.close(); }
}

try {
if (process.env.PRONOUNCE_DEFAULT_ONLY === "1") {
  await defaultAccentSuite();
} else {
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
  phrase.audios.length === 1 && /^lantern seller$/i.test(new URL(phrase.audios[0].src).searchParams.get("word") ?? ""),
  "a tap on a phrase word says the phrase once",
  phrase.audios.map((audio) => new URL(audio.src).searchParams.get("word")).join(" + ") || "nothing",
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
  word.audios.length === 1 && new URL(word.audios[0].src).searchParams.get("word") === "window",
  "a tap on a plain word says that word once",
  word.audios.map((audio) => new URL(audio.src).searchParams.get("word")).join(" + ") || "nothing",
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

// 4. the service has no recording: the other accent is tried, then exactly one voice
await page.evaluate(() => {
  window.__failAudio = true;
});
await reset();
await page.locator('[role=button][data-word="window"]').first().click();
await page.waitForTimeout(1200);
const fallback = await heard();
check(
  fallback.audios.length === 2 && fallback.audios.every((audio) => !audio.playing)
    && fallback.audios.map((audio) => new URL(audio.src).searchParams.get("accent")).join(",") === "us,uk",
  "a word with no recording is tried in both accents",
  fallback.audios.map((audio) => new URL(audio.src).searchParams.get("accent")).join(" + ") || "nothing",
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
  accented.audios.length === 1
    && new URL(accented.audios[0].src).searchParams.get("word") === "café",
  "an accented word reaches the service whole",
  accented.audios[0] ? new URL(accented.audios[0].src).searchParams.get("word") : "nothing",
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
    audioSources: [...window.__audioSources],
    uapisAudioSources: [...window.__uapisAudioSources],
    voices: window.__voiceRecords,
    cancels: window.__synthCancels,
  }));
  const configure = (page, options) => page.evaluate(options => {
    if (options.audio) window.__audioMode = options.audio;
    if (options.tts) window.__synthMode = options.tts;
  }, options);
  function noSpeech(actual) {
    assert.deepEqual(actual.voices, [], "explicit accents never use SpeechSynthesis");
  }
  function uapis(actual, accent, word = "window", sourceIndex = -1) {
    const sources = sourceIndex < 0 ? actual.uapisAudioSources : actual.uapisAudioSources.slice(sourceIndex);
    assert.equal(sources.length, 1, "explicit accents make exactly one uapis audio request");
    const url = new URL(sources[0]);
    assert.equal(url.hostname, "uapis.cn");
    assert.equal(url.pathname, "/api/v1/dictionary/audio");
    assert.equal(url.searchParams.get("word"), word);
    assert.equal(url.searchParams.get("accent"), accent.toLowerCase());
    assert.equal(actual.audioSources.every(source => source.startsWith("https://uapis.cn/")), true,
      "every recording request goes to the uapis provider");
  }
  async function failed(page, accent, locale = "en") {
    await state(page, accent, "failed", 10000);
    const control = button(page, accent).locator('xpath=ancestor::*[@data-speak-control]');
    const error = control.locator('[data-speak-error][role="status"]');
    await error.waitFor({ state: "visible" });
    const expected = locale === "zh"
      ? String.fromCodePoint(accent === "UK" ? 0x82f1 : 0x7f8e, 0x97f3, 0x6682, 0x65f6, 0x65e0, 0x6cd5,
        0x64ad, 0x653e, 0xff0c, 0x70b9, 0x4e00, 0x4e0b, 0x91cd, 0x8bd5, 0x3002)
      : `${accent === "UK" ? "British" : "American"} pronunciation is unavailable. Tap to retry.`;
    const message = (await error.innerText()).trim();
    const localizedUnavailable = [
      0x6682, 0x65f6, 0x65e0, 0x6cd5, 0x64ad, 0x653e,
    ].map((codePoint) => String.fromCodePoint(codePoint)).join("");
    assert.ok(message === expected || message.includes(localizedUnavailable), "visible localized failure, not just a tooltip");
    assert.equal(await button(page, accent).getAttribute("title"), message);
  }
  async function run(name, fn, locale = "en", genericPhrase = false) {
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
      // Let ordinary no-accent auto-pronunciation settle before clearing observations.
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__clearRecords());
      await fn(page);
      // Only the final race intentionally invokes a generic caller and may create Audio.
      if (!genericPhrase) {
        const actual = await heard(page);
        assert.ok(actual, "playback observations captured");
      }
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.words), [], "pronunciation never saves a word");
      check(true, name);
    } catch (error) { check(false, name, error.stack || error.message); }
    finally { await context?.close(); }
  }

  for (const accent of ["UK", "US"]) {
    for (const audio of ["success", "throw"]) await run(`${accent}: direct uapis media ${audio}`, async page => {
      await configure(page, { audio });
      await button(page, accent).click();
      if (audio === "throw") {
        await failed(page, accent);
      } else {
        await state(page, accent, "started");
        assert.equal(await page.locator('[data-speak-error]').count(), 0);
      }
      const actual = await heard(page);
      uapis(actual, accent, "window", 0);
      noSpeech(actual);
      assert.equal(actual.audios[0].playing, audio === "success");
    });
    const unavailable = [
      ["provider unavailable", "reject"],
      ["provider throws", "throw"],
    ];
    for (const [description, audio] of unavailable) await run(`${accent}: ${description} fails visibly without fallback`, async page => {
      await configure(page, { audio });
      await button(page, accent).click();
      await failed(page, accent);
      const actual = await heard(page);
      uapis(actual, accent, "window", 0);
      noSpeech(actual);
    });
    await run(`${accent}: missing audio retries on the next tap`, async page => {
      await configure(page, { audio: "reject" });
      await button(page, accent).click();
      await failed(page, accent);
      const failedAttempt = await heard(page);
      uapis(failedAttempt, accent, "window", 0);
      noSpeech(failedAttempt);
      await configure(page, { audio: "success" });
      await button(page, accent).click();
      await state(page, accent, "started");
      const actual = await heard(page);
      assert.equal(actual.uapisAudioSources.length, 2, "retry makes one fresh uapis request");
      uapis(actual, accent, "window", 1);
      noSpeech(actual);
      assert.equal(actual.audios.at(-1).playing, true, "retry starts the recording once");
      assert.equal(await page.locator('[data-speak-error]').count(), 0, "retry clears failure feedback");
    });
  }
  await run("switching accents requests fresh uapis recordings", async page => {
    for (const accent of ["UK", "US", "UK"]) {
      await button(page, accent).click();
      await state(page, accent, "started");
    }
    const actual = await heard(page);
    assert.deepEqual(actual.uapisAudioSources.map(source => new URL(source).searchParams.get("accent")), ["uk", "us", "uk"]);
    noSpeech(actual);
  });
  for (const accent of ["UK", "US"]) {
    for (const audio of ["reject", "throw"]) await run(`${accent}: media ${audio} produces visible localized failure`, async page => {
      await configure(page, { audio });
      await button(page, accent).click();
      await failed(page, accent);
      const actual = await heard(page);
      uapis(actual, accent, "window", 0);
      noSpeech(actual);
    }, audio === "reject" ? "zh" : "en");
    await run(`${accent}: media error after start changes started to failed without another source`, async page => {
      await configure(page, { audio: "success" });
      await button(page, accent).click();
      await state(page, accent, "started");
      await page.evaluate(() => window.__audioError(0));
      await failed(page, accent);
      const actual = await heard(page);
      uapis(actual, accent, "window", 0);
      noSpeech(actual);
      assert.equal(actual.audios[0].playing, false, "failed audio is cancelled");
    });
    await run(`${accent}: audio that never starts fails within the 8s bound`, async page => {
      await configure(page, { audio: "never" });
      const started = Date.now();
      await button(page, accent).click();
      await state(page, accent, "loading");
      await page.waitForTimeout(100);
      assert.equal(await button(page, accent).getAttribute("data-speak-status"), "loading", "queued is not reported as started");
      await state(page, accent, "failed", 10000);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 7500 && elapsed <= 10500, `8s start deadline, observed ${elapsed}ms`);
      await failed(page, accent);
      const expired = await heard(page);
      uapis(expired, accent, "window", 0);
      noSpeech(expired);
      await page.evaluate(() => window.__audioError(0));
      await page.waitForTimeout(100);
      await failed(page, accent);
      assert.deepEqual(await heard(page), expired, "late callbacks cannot revive an expired request");
    });
  }
  for (const previous of ["never", "success"]) {
    for (const nextAccent of ["UK", "US"]) await run(`stale ${previous === "never" ? "pending" : "started"} audio callbacks cannot overwrite a newer ${nextAccent} request`, async page => {
      await configure(page, { audio: previous });
      await button(page, "UK").click();
      await state(page, "UK", previous === "never" ? "loading" : "started");
      await configure(page, { audio: "success" });
      await button(page, nextAccent).click();
      await state(page, nextAccent, "started");
      const current = await heard(page);
      assert.deepEqual(current.uapisAudioSources.map(source => new URL(source).searchParams.get("accent")), ["uk", nextAccent.toLowerCase()]);
      assert.deepEqual(current.audios.map(audio => audio.playing), [false, true]);
      await page.evaluate(() => window.__audioError(0));
      await page.waitForTimeout(100);
      await state(page, nextAccent, "started");
      if (nextAccent === "US") await state(page, "UK", "aborted");
      assert.deepEqual(await heard(page), current, "stale callbacks do not cancel newer audio");
      assert.equal(await page.locator('[data-speak-error]').count(), 0);
    });
  }
  await run("stale audio callbacks cannot mark a newer queued request as started", async page => {
    await configure(page, { audio: "never" });
    await button(page, "UK").click();
    await state(page, "UK", "loading");
    await button(page, "US").click();
    await state(page, "US", "loading");
    const current = await heard(page);
    assert.deepEqual(current.uapisAudioSources.map(source => new URL(source).searchParams.get("accent")), ["uk", "us"]);
    await page.evaluate(() => window.__audioError(0));
    await page.waitForTimeout(100);
    await state(page, "US", "loading");
    await state(page, "UK", "aborted");
    assert.deepEqual(await heard(page), current);
    assert.equal(await page.locator('[data-speak-error]').count(), 0);
  });
  await run("rapid UK -> US -> generic phrase cancels direct audio and leaves one generic recording", async page => {
    assert.equal(await page.locator('[data-word-header] [data-speak]:not([data-speak-accent])').count(), 0,
      "IPA-enabled word cards have only UK/US, never a redundant generic header button");
    await configure(page, { audio: "never" });
    // The real no-argument reader phrase caller starts with the saved preference.
    await page.evaluate(() => {
      document.querySelector('[data-word-ipa] [data-speak-accent="UK"]').click();
      document.querySelector('[data-word-ipa] [data-speak-accent="US"]').click();
    });
    const explicit = await heard(page);
    assert.deepEqual(explicit.uapisAudioSources.map(source => new URL(source).searchParams.get("accent")), ["uk", "us"]);
    noSpeech(explicit);
    await page.locator('[role="button"][data-word="lantern"]').first().click();
    const phraseButtons = page.locator('[data-phrase-audio] [data-speak-accent]');
    await phraseButtons.first().waitFor();
    assert.equal(await phraseButtons.count(), 2, "phrase card has UK/US controls without IPA");
    assert.equal(await page.locator('[data-word-ipa]').count(), 0);
    await page.waitForTimeout(150);
    const current = await heard(page);
    const explicitCount = explicit.audios.length;
    assert.equal(current.audios.length, explicitCount + 1, "only the final generic phrase adds one Audio attempt");
    const url = new URL(current.audios.at(-1).src);
    assert.equal(url.hostname, "uapis.cn", "generic phrase uses the uapis recording");
    assert.equal(url.pathname, "/api/v1/dictionary/audio");
    assert.equal(url.searchParams.get("accent"), "us");
    assert.equal(url.searchParams.get("word"), "lantern seller");
    assert.equal(current.audioSources.at(-1), current.audios.at(-1).src);
    assert.equal(current.audios.at(-1).attached, true);
    assert.ok([true, false].includes(current.audios.at(-1).playing), "generic audio attempt is recorded");
    noSpeech(current);
    assert.deepEqual(current.audios.slice(0, explicitCount).map(audio => audio.playing), [false, false]);
    assert.ok(current.cancels > explicit.cancels, "generic caller cancels pending explicit audio");
    for (const index of [0, 1]) for (const callback of ["__audioError"]) {
      await page.evaluate(({ index, callback }) => window[callback](index), { index, callback });
      await page.waitForTimeout(50);
      assert.deepEqual(await heard(page), current, "stale UK/US callbacks cannot interrupt the generic phrase or add speech");
      assert.equal(await page.locator('[data-speak-error]').count(), 0, "aborted requests do not show failure");
    }
  }, "en", true);
}
