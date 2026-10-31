// Current-target POS rendering in an isolated synthetic book; never contacts live services.
// node scripts/word-pos-e2e.mjs [baseUrl]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installRecorders, settle, position, tap } from './lib/word-ipa-fixture.mjs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8098/').replace(/\/?$/, '/');
const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
let failures = 0;
try {
  for (const [width, locale, phrasePos] of [[320, 'en', 'idiom'], [390, 'zh', undefined], [1280, 'en', 'idiom'], [1280, 'zh', undefined]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 },
      isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200,
        contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await installRecorders(context);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(locale => {
        for (const key of ['cibian-tutorial-v1', 'cibian-feedback-tip-v1', 'cibian-quote-tip-v1']) localStorage.setItem(key, 'seen');
        localStorage.setItem('cibian-locale-v1', locale);
      }, locale);
      await page.goto(base + 'shelf');
      await page.waitForSelector('header');
      await page.evaluate(async ({ phrasePos }) => {
        const id = 'word-pos-regression';
        const sentence = 'The lantern lights glow against all odds beside fragile glass and quiet quuxstone.';
        const paragraphs = Array.from({ length: 34 }, () => sentence);
        const glossary = {
          lantern: { pos: 'noun', meaning: 'A portable light.' },
          lights: { pos: 'noun', meaning: 'Things that make a place bright.' },
          glow: { pos: 'noun', meaning: 'A soft light.', senses: [{ pos: 'verb', meaning: 'To shine softly.', anchors: [{ chapter: 0, occurrence: 11 }] }] },
          odds: { pos: 'noun', meaning: 'The chances of something happening.' },
          fragile: { pos: 'adjective', meaning: '', senseOnly: true,
            senses: [{ pos: 'adjective', meaning: 'Easily broken.', anchors: [{ chapter: 0, occurrence: 11 }] }] },
          quiet: { pos: '   ', meaning: 'Making little noise.' },
          glass: { pos: 'noun with a deliberately long descriptive label that must wrap within the word card', meaning: 'A hard clear material.' },
        };
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('cibian-books', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['books', 'notes'], 'readwrite');
          const meta = { id, title: 'Word POS regression', author: 'Synthetic fixture', glossary, pending: [], totalHard: 7 };
          tx.objectStore('books').put({ ...meta, chapters: [{ title: 'Chapter', paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join('') }] }, id);
          tx.objectStore('notes').put(meta, `gloss:${id}`);
          tx.objectStore('notes').put({ source: 'custom', paragraphs: [], sentences: [],
            phrases: { 'against all odds': { ...(phrasePos ? { pos: phrasePos } : {}), meaning: 'Despite difficulties.' } } }, `extras:${id}`);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem('cibian-notebook-v1', JSON.stringify({ version: 0, state: {
          books: [{ id, title: 'Word POS regression', author: 'Synthetic fixture', source: 'epub', cloth: 'cloth', createdAt: 1 }], words: [], log: {},
        } }));
      }, { phrasePos });
      await page.goto(base + 'read/word-pos-regression');
      await page.locator('article p').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2800);
      const card = page.locator('[data-word-card]');
      const pos = card.locator('[data-word-pos]');
      async function close() {
        await card.locator('[data-panel-close]').click();
        await card.waitFor({ state: 'detached' });
      }
      async function open(word, paragraph = 10) {
        const anchor = page.locator('article p').nth(paragraph).locator(`[role="button"][data-word="${word}"] .book-tap`);
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')));
        await position(page, anchor);
        await page.waitForTimeout(250);
        const before = await page.locator('article').boundingBox();
        const scroll = await page.evaluate(() => scrollY);
        await tap(page, anchor);
        await card.waitFor();
        await settle(page);
        assert.deepEqual(await page.locator('article').boundingBox(), before, 'word card leaves article geometry unchanged');
        assert.equal(await page.evaluate(() => scrollY), scroll, 'word card leaves reading position unchanged');
      }
      await open('lantern');
      assert.equal(await pos.innerText(), 'noun');
      assert.equal(await pos.getAttribute('lang'), 'en');
      assert.ok(await pos.evaluate(el => el.nextElementSibling?.matches('[data-part="word-meaning"]')), 'POS is above the matching meaning');
      await close();
      await open('glow');
      assert.equal(await pos.innerText(), 'verb', 'anchored sense supplies POS, not base entry');
      assert.match(await card.locator('[data-part="word-meaning"]').innerText(), /To shine softly/);
      await close();
      await open('glow', 9);
      assert.equal(await pos.innerText(), 'noun', 'another occurrence uses base POS');
      await close();
      await open('fragile');
      assert.equal(await pos.innerText(), 'adjective');
      await close();
      await open('fragile', 9);
      assert.equal(await pos.count(), 0, 'unmatched senseOnly entry must not leak its POS');
      await close();
      await open('quiet');
      assert.equal(await pos.count(), 0, 'whitespace POS does not mount an empty line');
      await close();
      await open('quuxstone');
      assert.equal(await pos.count(), 0, 'unknown word has no invented POS');
      await close();
      await open('glass');
      assert.ok((await pos.innerText()).includes('deliberately long'));
      assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long POS never overflows the card');
      await close();
      await open('odds');
      const phraseButton = card.locator('[data-look-target="phrase"]');
      await phraseButton.waitFor();
      for (let repeat = 0; repeat < 2; repeat++) {
        await phraseButton.click();
        if (phrasePos) assert.equal(await pos.innerText(), phrasePos);
        else assert.equal(await pos.count(), 0, 'phrase without POS must not borrow the constituent POS');
        assert.match(await card.locator('[data-part="phrase-meaning"]').innerText(), /Despite difficulties/);
        await card.locator('[data-look-target="word"]').click();
        assert.equal(await pos.innerText(), 'plural noun', 'switch back restores contextual word POS');
      }
      await close();
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px ${locale}: word, contextual sense, sparse/unknown/blank, long POS, phrase round trips, reader geometry`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${width}px ${locale}: ${error.stack}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
process.exitCode = failures ? 1 : 0;
