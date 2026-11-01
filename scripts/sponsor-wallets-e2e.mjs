// Verify displayed, copied and rendered QR addresses. Decode output PNGs before release.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8098/');
const output = process.argv[3];
assert.ok(output, 'Pass an output directory for QR decode checks');
await mkdir(output, { recursive: true });
const expected = {
  evm: '0xedc2cf33eff4a303ddac8c2f28835a3de1206054',
  solana: 'GFbfgAkccBzqfAZX9Edtpm7xuoQrniTUKnnxANegDSD2',
  tron: 'TN6mPkPgWH1pvJYiWXX7pwBVbUPSRvnXFy',
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const width of [320, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base.origin) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        return route.continue();
      });
      await context.addInitScript(() => {
        localStorage.setItem('cibian-tutorial-v1', 'seen');
        localStorage.setItem('cibian-locale-v1', 'en');
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text; } } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('dashboard', base).href);
      const link = page.locator('[data-sponsor-link]');
      assert.equal((await link.innerText()).trim(), 'BUY ME A COFFEE');
      assert.equal(await link.locator('.lucide-coffee').count(), 1);
      assert.equal(await link.locator('.lucide-heart').count(), 0);
      assert.equal(await page.locator('[data-tutorial-tab]').count(), 0);
      const dock = page.locator('[data-sponsor-tab]');
      if (width >= 1185) {
        assert.equal(await dock.isVisible(), true);
        const geometry = () => page.locator('[data-overview-tabs]').evaluate(el => {
          const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        });
        const before = await geometry();
        await dock.click();
        await page.locator('[data-sponsor-dialog]').waitFor();
        assert.deepEqual(await geometry(), before, 'coffee dialog does not shift the page');
        await page.locator('[data-sponsor-dialog]').getByRole('button', { name: 'Close', exact: true }).click();
      } else assert.equal(await dock.isVisible(), false, 'desktop dock stays hidden on phones');
      await link.click();
      for (const [id, address] of Object.entries(expected)) {
        const label = { evm: 'EVM', solana: 'Solana', tron: 'Tron' }[id];
        const group = page.locator('[data-sponsor-network-pick]');
        const options = group.getByRole('radio');
        if (await options.count()) await options.filter({ hasText: label }).click();
        else await group.getByRole('button', { name: label, exact: true }).click();
        assert.equal((await page.locator(`[data-sponsor-address="${id}"]`).innerText()).trim(), address);
        await page.locator(`[data-sponsor-copy="${id}"]`).click();
        assert.equal(await page.evaluate(() => window.__copied), address);
        const image = page.locator(`[data-sponsor-qr="${id}"]`);
        await image.evaluate(el => el.decode());
        await image.screenshot({ path: join(output, `${width}-${id}.png`) });
        assert.equal(await page.locator('[data-sponsor-qr]').count(), 1, 'only one network QR is shown');
        console.log(`PASS ${width}px ${id}: display and copy match`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
