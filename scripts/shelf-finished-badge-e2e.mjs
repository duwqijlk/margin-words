// Finished shelf badges stay inside the bottom-right corner without covering hover progress.
// node scripts/shelf-finished-badge-e2e.mjs [baseUrl]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8098/');
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
let cases = 0;
try {
  for (const width of [320, 1280]) for (const locale of ['en', 'zh']) for (const theme of ['light', 'sepia', 'dark', 'eink']) {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base.origin) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        return route.continue();
      });
      await context.addInitScript(({ locale, theme }) => {
        localStorage.setItem('cibian-tutorial-v1', 'seen');
        localStorage.setItem('cibian-locale-v1', locale);
        localStorage.setItem('cibian-prefs-v1', JSON.stringify({ version: 0, state: { theme } }));
        const book = (id, title, finishedAt) => ({ id, title, author: 'Synthetic fixture', source: 'epub', cloth: 'sage', createdAt: 1, ...(finishedAt ? { finishedAt } : {}) });
        localStorage.setItem('cibian-notebook-v1', JSON.stringify({ version: 0, state: {
          books: [book('finished-badge-fixture', 'A Quiet Evening', 1793400000000), book('unfinished-badge-fixture', 'A New Morning')], words: [], log: {},
        } }));
      }, { locale, theme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('shelf/', base).href);
      const badge = page.locator('[data-shelf-finished]');
      await badge.waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await badge.count(), 1, 'unfinished cards have no badge');
      assert.equal((await badge.innerText()).trim(), locale === 'en' ? 'Finished' : '\u5df2\u8bfb\u5b8c');
      const measure = () => badge.evaluate(el => {
        const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const card = el.closest('li');
        const detail = card.querySelector('.cover-progress-detail');
        return { badge: box(el), cover: box(el.parentElement), card: box(card),
          detailVisible: getComputedStyle(detail).display !== 'none', detail: box(detail),
          progressText: [...detail.children].map(box), pointerEvents: getComputedStyle(el).pointerEvents };
      });
      const before = await measure();
      assert.ok(Math.abs(before.cover.right - before.badge.right - 6) < 0.6, 'right inset is 6px');
      assert.ok(Math.abs(before.cover.bottom - before.badge.bottom - 6) < 0.6, 'bottom inset is 6px');
      assert.ok(before.badge.y > before.cover.y + before.cover.height / 2, 'badge is in lower half');
      assert.equal(before.pointerEvents, 'none', 'badge cannot block opening the cover');
      assert.equal(await badge.locator('..').locator('button').count(), 1);
      if (width >= 768) {
        await badge.locator('..').locator('button').hover();
        const hovered = await measure();
        assert.equal(hovered.detailVisible, true, 'hover still shows reading progress');
        for (const text of hovered.progressText) assert.ok(text.bottom <= hovered.badge.y, 'progress text stays above badge');
        assert.deepEqual(hovered.card, before.card, 'hover does not move shelf layout');
        await badge.locator('..').locator('button').focus();
        const focused = await measure();
        for (const text of focused.progressText) assert.ok(text.bottom <= focused.badge.y, 'focused progress stays above badge');
      } else assert.equal(before.detailVisible, false, 'touch keeps existing progress behavior');
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px ${locale} ${theme}`);
      cases++;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(`${cases} shelf finished badge cases passed`);
