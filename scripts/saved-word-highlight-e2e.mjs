// Full-height saved word marks, real save/remove actions and unchanged reading layout.
// node scripts/saved-word-highlight-e2e.mjs [baseUrl]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BOOK, seed, installRecorders, anchor, position, tap, settle } from './lib/word-ipa-fixture.mjs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8098/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
let failures = 0;
try {
  for (const width of [320, 1280]) {
    for (const theme of ['light', 'sepia', 'dark', 'eink']) {
      const context = await browser.newContext({ viewport: { width, height: 844 },
        isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return route.continue();
      });
      await installRecorders(context);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          for (const key of ['cibian-tutorial-v1', 'cibian-feedback-tip-v1', 'cibian-quote-tip-v1']) localStorage.setItem(key, 'seen');
        });
        await page.goto(base + 'shelf');
        await page.waitForSelector('header');
        // App boot persists an empty notebook even in this brand-new context.
        await page.evaluate(() => {
          const notebook = JSON.parse(localStorage.getItem('cibian-notebook-v1'));
          if (notebook?.state?.books?.length || notebook?.state?.words?.length) throw new Error('Expected an empty isolated notebook');
          localStorage.removeItem('cibian-notebook-v1');
        });
        await seed(page, { locale: 'en', theme });
        await page.goto(base + 'read/' + BOOK);
        await page.locator('article p').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2800);
        const word = anchor(page, 'bath');
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')));
        await position(page, word);
        await page.waitForTimeout(850);
        const geometry = () => page.evaluate(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height]; };
          const p = document.querySelectorAll('article p')[10];
          return { article: rect(document.querySelector('article')), paragraph: rect(p),
            words: [...p.querySelectorAll('.book-tap')].map(rect), height: document.documentElement.scrollHeight };
        });
        const before = await geometry();
        await tap(page, word);
        const card = page.locator('[data-word-card]');
        await card.waitFor();
        await card.locator('[data-word-save]').click();
        await card.locator('[data-panel-close]').click();
        await card.waitFor({ state: 'detached' });
        await page.waitForTimeout(900);
        assert.equal(await word.evaluate(el => el.parentElement.classList.contains('book-saved')), true);
        assert.deepEqual(await geometry(), before, 'saving does not change word boxes, wrapping or article geometry');
        async function mark() {
          return word.evaluate(el => {
            const s = getComputedStyle(el);
            const probe = document.createElement('span');
            probe.style.color = 'var(--mark)';
            document.body.appendChild(probe);
            const expected = getComputedStyle(probe).color;
            probe.remove();
            return { background: s.backgroundColor, image: s.backgroundImage,
              decoration: s.textDecorationLine, style: s.textDecorationStyle, expected };
          });
        }
        function check(style) {
          assert.equal(style.image, 'none', 'no half-height gradient');
          if (theme === 'eink') {
            assert.equal(style.background, 'rgba(0, 0, 0, 0)');
            assert.equal(style.decoration, 'underline');
            assert.equal(style.style, 'double');
          } else assert.equal(style.background, style.expected, 'full inline background uses theme mark color');
        }
        check(await mark());
        await word.hover();
        await page.waitForTimeout(200);
        check(await mark());
        await page.mouse.move(0, 0);
        await page.waitForTimeout(200);
        check(await mark());
        await word.locator('..').focus();
        await page.waitForTimeout(200);
        check(await mark());
        assert.deepEqual(await geometry(), before, 'hover/focus do not change reading geometry');
        await tap(page, word);
        await card.waitFor();
        await card.locator('[data-word-save]').click();
        await card.locator('[data-panel-close]').click();
        await card.waitFor({ state: 'detached' });
        await settle(page);
        assert.equal(await word.evaluate(el => el.parentElement.classList.contains('book-saved')), false);
        assert.deepEqual(await geometry(), before, 'removing a saved word does not change reading geometry');
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px ${theme}: full-height mark, hover/focus, real save/remove, unchanged reader geometry`);
      } catch (error) {
        failures++;
        console.error(`FAIL ${width}px ${theme}: ${error.stack}`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
process.exitCode = failures ? 1 : 0;
