// Compare an explicit legacy display:contents baseline with the reader's semantic inline controls.
// Usage: node scripts/inline-layout-parity-e2e.mjs [baseUrl]
// Needs a local build served by Vite (build:local); only same-origin requests are allowed.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const bookId = "inline-layout-parity";
const viewports = [
  { name: "desktop", width: 1280, height: 800, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

// This paragraph deliberately combines a chapter drop cap, nested formatting, and a long listed
// word. The reader inserts the soft hyphen; the source itself remains ordinary book HTML.
const sourceHtml = `
  <p class="dropcap">Remarkable <em>quietly</em> carried the <strong>electromagnetically</strong> charged lantern through the narrow street while the patient seller watched every window.</p>
  <p>The <em>careful</em> traveler spoke <strong>softly</strong>, then continued characteristically toward the distant village, where the rain had covered the old bridge.</p>
  <p>Several neighbors waited beside the garden gate and wondered whether the fragile lights would reach the houses before the river rose again.</p>
`;
const paragraphs = [
  "Remarkable quietly carried the electromagnetically charged lantern through the narrow street while the patient seller watched every window.",
  "The careful traveler spoke softly, then continued characteristically toward the distant village, where the rain had covered the old bridge.",
  "Several neighbors waited beside the garden gate and wondered whether the fragile lights would reach the houses before the river rose again.",
];
const glossary = {
  remarkable: { pos: "adjective", meaning: "Unusually good or surprising.", whyHard: "" },
  quietly: { pos: "adverb", meaning: "Without making much noise.", whyHard: "" },
  electromagnetically: { pos: "adverb", meaning: "By means of electromagnetic forces.", whyHard: "" },
  careful: { pos: "adjective", meaning: "Taking care to avoid mistakes.", whyHard: "" },
  softly: { pos: "adverb", meaning: "In a gentle or quiet way.", whyHard: "" },
  characteristically: { pos: "adverb", meaning: "In a way typical of someone or something.", whyHard: "" },
};

function compareFragments(legacy, semantic, label) {
  assert.deepEqual(legacy.formattedItalicStyle, semantic.formattedItalicStyle, `${label}: italic formatting survives`);
  assert.deepEqual(legacy.formattedBoldStyle, semantic.formattedBoldStyle, `${label}: bold formatting survives`);
  assert.deepEqual(legacy.articleSize, semantic.articleSize, `${label}: article size unchanged`);
  assert.deepEqual(legacy.paragraphSizes, semantic.paragraphSizes, `${label}: paragraph sizes unchanged`);
  for (const key of ["dropcap", "softHyphen", "italic", "bold"]) {
    assert.ok(legacy[key] && semantic[key], `${label}: ${key} range exists`);
    assert.equal(legacy[key].length, semantic[key].length, `${label}: ${key} fragment count`);
    for (let index = 0; index < legacy[key].length; index += 1) {
      const before = legacy[key][index];
      const after = semantic[key][index];
      // Allow only sub-pixel glyph rounding; line breaks and ink geometry must stay stable.
      for (const property of ["left", "top", "width", "height"]) {
        assert.ok(Math.abs(before[property] - after[property]) <= 1, `${label}: ${key} fragment ${index} ${property}`);
      }
      assert.ok(before.width > 0 && after.width > 0, `${label}: ${key} fragment ${index} has ink`);
    }
  }
  assert.equal(legacy.words.length, semantic.words.length, `${label}: same word count`);
  for (let index = 0; index < legacy.words.length; index += 1) {
    assert.equal(legacy.words[index].word, semantic.words[index].word, `${label}: word ${index} spelling`);
    assert.equal(legacy.words[index].range.length, semantic.words[index].range.length, `${label}: word ${index} Range fragment count`);
    for (let fragment = 0; fragment < legacy.words[index].range.length; fragment += 1) {
      const before = legacy.words[index].range[fragment];
      const after = semantic.words[index].range[fragment];
      for (const property of ["left", "top", "width", "height"]) {
        // The final "window." text Range differs by 1.57px between these Chromium trees.
        // Bound that width difference while checking line positions and paragraph sizes separately.
        const tolerance = property === "width" ? 2 : 1;
        assert.ok(Math.abs(before[property] - after[property]) <= tolerance, `${label}: word ${index} (${legacy.words[index].word}) fragment ${fragment} ${property}: ${before[property]} vs ${after[property]}`);
      }
      assert.ok(before.width > 0 && after.width > 0, `${label}: word ${index} fragment ${fragment} has ink`);
    }
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      locale: "en-US",
    });
    await context.route("**/*", (route) => {
      const requestUrl = new URL(route.request().url());
      return requestUrl.origin === new URL(base).origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    try {
      await page.goto(`${base}shelf`);
      await page.waitForSelector("header");
      await page.evaluate(async ({ id, source, texts, list }) => {
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
          tx.objectStore("books").put({
            id,
            title: "Inline layout parity",
            author: "Test",
            glossary: list,
            pending: [],
            totalHard: Object.keys(list).length,
            chapters: [{ title: "Inline parity", paragraphs: texts, html: source }],
          }, id);
          tx.objectStore("notes").put({ paragraphs: [], sentences: [], phrases: {} }, `extras:${id}`);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
          books: [{ id, title: "Inline layout parity", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }],
          words: [],
          log: {},
        } }));
      }, { id: bookId, source: sourceHtml, texts: paragraphs, list: glossary });

      await page.goto(`${base}read/${bookId}`);
      await page.waitForSelector("article.book-body [data-word]");
      await page.waitForFunction(() => {
        const word = document.querySelector('[data-word="electromagnetically"] .book-tap');
        return Boolean(word && word.textContent?.includes("\u00ad"));
      });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      const result = await page.evaluate(() => {
        const roundInPage = (number) => Math.round(number * 100) / 100;
        const readFragmentsInPage = (root) => {
          const article = root.getBoundingClientRect();
          const fragments = (selector) => {
            const element = root.querySelector(selector);
            if (!element) return null;
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const rects = [];
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              rects.push(...range.getClientRects());
            }
            const seen = new Set();
            return rects
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map((rect) => ({
                left: roundInPage(rect.left - article.left),
                top: roundInPage(rect.top - article.top),
                width: roundInPage(rect.width),
                height: roundInPage(rect.height),
              }))
              .filter((rect) => {
                // A semantic inline wrapper contributes its own client rect as well as its
                // text child. Keep one record for identical geometry, but retain true line
                // fragments produced by wrapping or a soft hyphen.
                const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
          };
          const style = (selector) => {
            const element = root.querySelector(selector);
            if (!element) return null;
            const computed = getComputedStyle(element);
            return {
              fontStyle: computed.fontStyle,
              fontWeight: computed.fontWeight,
            };
          };
          return {
            articleSize: [roundInPage(article.width), roundInPage(article.height)],
            paragraphSizes: [...root.querySelectorAll('p')].map(p => {
              const rect = p.getBoundingClientRect();
              return [roundInPage(rect.width), roundInPage(rect.height)];
            }),
            dropcap: fragments('.dropcap [data-word="Remarkable"] .book-tap'),
            softHyphen: fragments('[data-word="electromagnetically"] .book-tap'),
            italic: fragments("p em"),
            bold: fragments("p strong"),
            formattedItalicStyle: style("p em .book-tap"),
            formattedBoldStyle: style("p strong .book-tap"),
            words: [...root.querySelectorAll("[data-word]")].map((element) => ({
              word: element.getAttribute("data-word"),
              range: fragments(`[data-i="${element.getAttribute("data-i")}"] .book-tap`),
            })),
          };
        };
        // Recreate the old reader's native control baseline explicitly. The production tree now
        // contains semantic inline spans, so this conversion is intentionally not a no-op: native
        // controls use display:contents while the real tree uses semantic inline display.
        const legacyHtmlInPage = (semanticHtml) => {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = semanticHtml;
          for (const semantic of wrapper.querySelectorAll('[role="button"][data-word]')) {
            const button = document.createElement("button");
            button.type = "button";
            // Retain role so the migrated ink/font selectors also style the legacy fixture.
            for (const attribute of semantic.attributes)
              button.setAttribute(attribute.name, attribute.value);
            button.style.display = "contents";
            button.append(...semantic.childNodes);
            semantic.replaceWith(button);
          }
          return wrapper.innerHTML;
        };
        const article = document.querySelector("article.book-body");
        if (!article) throw new Error("reader article did not mount");
        const semanticHtml = article.innerHTML;
        article.innerHTML = legacyHtmlInPage(semanticHtml);
        const legacy = readFragmentsInPage(article);
        const legacyControls = article.querySelectorAll("button[data-word]").length;
        article.innerHTML = semanticHtml;
        const semantic = readFragmentsInPage(article);
        const hasSoftHyphen = article.querySelector('[data-word="electromagnetically"] .book-tap')?.textContent?.includes("\u00ad");
        // Force a genuine discretionary break too: a soft hyphen that never wraps is not coverage.
        article.style.width = "180px";
        article.innerHTML = legacyHtmlInPage(semanticHtml);
        const narrowLegacy = readFragmentsInPage(article);
        article.innerHTML = semanticHtml;
        const narrowSemantic = readFragmentsInPage(article);
        return {
          legacy,
          semantic,
          narrowLegacy,
          narrowSemantic,
          hasSoftHyphen: Boolean(hasSoftHyphen),
          semanticControls: article.querySelectorAll('[role="button"][data-word]').length,
          legacyControls,
        };
      });

      assert.equal(result.hasSoftHyphen, true, `${viewport.name}: long listed word keeps its soft hyphen`);
      assert.equal(result.legacyControls, result.semanticControls, `${viewport.name}: semantic fixture keeps every word control`);
      compareFragments(result.legacy, result.semantic, viewport.name);
      assert.ok(result.narrowSemantic.softHyphen.length > 1, `${viewport.name}: long word actually wraps`);
      compareFragments(result.narrowLegacy, result.narrowSemantic, `${viewport.name} narrow`);
      assert.deepEqual(errors, [], `${viewport.name}: no browser errors`);
      console.log(`PASS ${viewport.name}: display:contents and semantic inline Range fragments match (${result.narrowSemantic.softHyphen.length} forced-wrap fragments)`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
