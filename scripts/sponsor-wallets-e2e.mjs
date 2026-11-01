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
      assert.equal(await page.getByRole('heading', { name: 'BUY ME A COFFEE', exact: true }).count(), 1);
      const pick = page.locator('[data-sponsor-network-pick]');
      assert.equal(await pick.getByRole('button').count(), 4);
      await pick.getByRole('button', { name: 'WeChat', exact: true }).click();
      const wechat = page.locator('[data-sponsor-qr="wechat"]');
      await wechat.evaluate(el => el.decode());
      assert.equal(await page.locator('[data-sponsor-qr]').count(), 1);
      assert.equal(await page.locator('[data-sponsor-address], [data-sponsor-copy], [data-sponsor-warning]').count(), 0);
      assert.equal(await page.locator('[data-sponsor-wechat-save]').getAttribute('href'), await wechat.getAttribute('src'));
      const buttons = await pick.getByRole('button').evaluateAll(els => els.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
      if (width === 320) {
        assert.equal(buttons[0].y, buttons[1].y);
        assert.ok(buttons[2].y > buttons[0].y);
      }
      await page.locator('[data-sponsor-dialog]').screenshot({ path: join(output, `${width}-wechat-dialog.png`) });
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
  for (const locale of ['en', 'zh']) {
    for (const width of [320, 1280]) {
      for (const scenario of ['wechat', 'evm', 'solana', 'tron', 'existing-wechat', 'existing-crypto', 'existing-alipay']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
        try {
          let submitted = null;
          const existing = scenario.startsWith('existing-') ? scenario.slice(9) : null;
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== base.origin) return route.abort();
            if (!url.pathname.startsWith('/api/')) return route.continue();
            let body = {};
            if (url.pathname === '/api/auth/me') body = { user: { email: 'test@example.com', nickname: 'Reader', role: 'user' } };
            if (url.pathname === '/api/sponsorship-request') body = { open: existing ? { method: existing, displayName: 'Reader', emailSent: false } : null };
            if (url.pathname === '/api/sponsorships' && route.request().method() === 'POST') {
              submitted = route.request().postDataJSON();
              body = { id: 'mock-gift', method: submitted.method };
            }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
          });
          await context.addInitScript(locale => {
            localStorage.setItem('cibian-tutorial-v1', 'seen');
            localStorage.setItem('cibian-locale-v1', locale);
          }, locale);
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(new URL('dashboard', base).href);
          await page.locator('[data-sponsor-link]').click();
          await page.locator('[data-sponsor-name], [data-sponsor-pending]').waitFor();
          assert.equal(await page.getByRole('heading', { name: 'BUY ME A COFFEE', exact: true }).count(), 1);
          const pick = page.locator('[data-sponsor-network-pick]');
          const choose = id => pick.getByRole('button').nth({ wechat: 0, evm: 1, solana: 2, tron: 3 }[id]).click();
          const checkProof = async (selector, method) => {
            const message = await page.locator(selector).innerText();
            assert.equal(/tx/.test(message), method === 'crypto');
          };
          if (existing) {
            await choose('wechat');
            await checkProof('[data-sponsor-pending]', existing);
            await choose('evm');
            await checkProof('[data-sponsor-pending]', existing);
            assert.equal(submitted, null);
          } else {
            await choose(scenario);
            if (scenario === 'wechat') {
              await page.locator('[data-sponsor-qr="wechat"]').evaluate(el => el.decode());
              const image = await page.locator('[data-sponsor-qr="wechat"]').evaluate(el => ({ w: el.clientWidth, h: el.clientHeight, nw: el.naturalWidth, nh: el.naturalHeight }));
              assert.ok(Math.abs(image.w / image.h - image.nw / image.nh) < 0.01, 'original image keeps its proportions');
              assert.equal(await page.locator('[data-sponsor-copy]').count(), 0);
              await page.locator('[data-sponsor-dialog]').screenshot({ path: join(output, `${locale}-${width}-wechat.png`) });
            }
            await page.locator('[data-sponsor-submit]').click();
            await page.locator('[data-sponsor-sent]').waitFor();
            const method = scenario === 'wechat' ? 'wechat' : 'crypto';
            assert.deepEqual(submitted, { method });
            await choose(scenario === 'wechat' ? 'evm' : 'wechat');
            await checkProof('[data-sponsor-sent]', method);
          }
          assert.equal(await page.locator('[data-sponsor-qr]').count(), 1);
          const dialog = await page.locator('[data-sponsor-dialog]').evaluate(el => ({ w: el.clientWidth, sw: el.scrollWidth }));
          assert.ok(dialog.sw <= dialog.w + 1, `${locale} ${width}px ${scenario}: dialog does not overflow horizontally (${dialog.sw}/${dialog.w})`);
          assert.deepEqual(errors, []);
          console.log(`PASS ${locale} ${width}px ${scenario}: method and proof text`);
        } finally { await context.close(); }
      }
    }
  }
} finally { await browser.close(); }
