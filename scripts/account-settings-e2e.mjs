// Local synthetic accounts only. No real credentials, uploads, speech or external traffic.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8098/');
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const out = new URL('../../local-exports/', import.meta.url);
await mkdir(out, { recursive: true });
const labels = Object.fromEntries(await Promise.all(['en', 'zh'].map(async locale => {
  const src = await readFile(new URL(`../src/lib/i18n-${locale}.ts`, import.meta.url), 'utf8');
  return [locale, key => JSON.parse(src.match(new RegExp(`"${key.replaceAll('.', '\\.')}":\\s*("(?:[^"\\\\]|\\\\.)*")`))[1])];
})));
try {
for (const locale of ['en', 'zh']) for (const width of [320, 1280]) for (const signedIn of [false, true]) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(locale => {
    for (const key of ['tutorial', 'feedback-tip', 'quote-tip']) localStorage.setItem('cibian-' + key + '-v1', 'seen');
    localStorage.setItem('cibian-locale-v1', locale);
    HTMLMediaElement.prototype.play = async () => {};
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
  }, locale);
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname.includes('/avatars/')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#395b4b"/></svg>' });
    if (u.origin !== base.origin) return r.abort();
    if (u.pathname.startsWith('/api/')) return r.fulfill({ contentType: 'application/json', body: '{}' });
    return r.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(new URL('shelf', base).href);
    const trigger = page.locator('[data-account-button]'); await trigger.waitFor();
    await page.waitForFunction(async () => { const {useAccount} = await import('/src/lib/account-store.ts'); return useAccount.getState().phase !== 'unknown'; });
    const patch = async fields => page.evaluate(async fields => { const {useAccount} = await import('/src/lib/account-store.ts'); useAccount.getState().patch(fields); }, fields);
    await patch(signedIn ? { phase: 'in', email: 'fixture@example.test', nickname: 'River', publicId: 'abc123def456', avatar: 1 } : { phase: 'out', email: null, nickname: null, publicId: null, avatar: 0 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('[data-settings-button]').count(), 0);
    await page.waitForFunction(expected => document.querySelectorAll('[data-account-button] [data-avatar]').length === expected, signedIn ? 1 : 0);
    assert.equal(await trigger.locator('[data-avatar]').count(), signedIn ? 1 : 0);
    if (!signedIn) assert.equal(await trigger.locator('svg.lucide-user-round').count(), 1);
    if (signedIn) { await trigger.locator('img').waitFor(); await page.waitForFunction(() => document.querySelector('[data-account-button] img')?.naturalWidth > 0); }
    const geometry = () => page.locator('header').evaluate(el => { const r = el.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height, scrollY]; });
    const before = await geometry();
    await trigger.click();
    await page.locator('[data-account-settings]').click();
    const settings = page.locator('[data-settings-panel]'); await settings.waitFor();
    assert.equal(await page.locator('[role=dialog]:visible').count(), 1);
    assert.equal(await page.locator('[data-account-home]').isVisible(), false);
    assert.equal(await settings.locator('[data-settings-theme]').count(), 1);
    assert.equal(await settings.locator('[data-settings-language]').count(), 1);
    assert.equal(await settings.locator('[data-settings-pronunciation]').count(), 1);
    assert.equal(await settings.locator('[data-settings-tutorial]').count(), 1);
    assert.equal(await settings.locator('[data-guide-link]').count(), 1);
    const t = labels[locale];
    for (const theme of ['dark', 'eink', 'light']) {
      await settings.locator(`[data-theme-tile="${theme}"]`).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.deepEqual(await geometry(), before);
      assert.ok(await page.locator('[data-account-dialog]').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    }
    await settings.locator('[data-settings-pronunciation]').getByRole('button', { name: t('ipa.uk'), exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.pronunciationAccent), 'UK');
    await settings.locator('[data-settings-language] button[aria-pressed=false]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('cibian-locale-v1')), locale === 'en' ? 'zh' : 'en');
    await settings.locator('[data-settings-language] button[aria-pressed=false]').click();
    await page.screenshot({ path: new URL(`account-settings-${locale}-${width}-${signedIn ? 'in' : 'guest'}.png`, out).pathname.replace(/^\/(\w:)/, '$1') });
    await page.locator('[data-account-back]').click();
    assert.equal(await page.locator('[data-account-home]').isVisible(), true);
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-account-settings'));
    if (!signedIn) {
      await page.locator('[data-account-email]').fill('draft@example.test');
      await page.locator('[data-account-settings]').click(); await page.locator('[data-account-back]').click();
      assert.equal(await page.locator('[data-account-email]').inputValue(), 'draft@example.test');
    }
    await page.keyboard.press('Escape'); await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-account-button'));
    assert.deepEqual(await geometry(), before);
    // A failed source falls back, then a new version remounts and can load again.
    await patch({ phase: 'in', email: 'fixture@example.test', nickname: 'River', publicId: 'abc123def456', avatar: 2 });
    await trigger.locator('img').waitFor();
    await trigger.locator('img').evaluate(el => el.dispatchEvent(new Event('error')));
    await trigger.locator('span[data-avatar]').waitFor();
    await patch({ avatar: 3 }); await trigger.locator('img').waitFor();
    await patch({ phase: 'out', email: null, nickname: null, publicId: null, avatar: 0 });
    assert.equal(await trigger.locator('img').count(), 0);
    // Settings stay available for incomplete/offline sessions, without destroying auth state.
    for (const fields of [
      { phase: 'unknown', email: null, nickname: null, sync: 'offline' },
      { phase: 'in', email: 'fixture@example.test', emailVerified: false },
      { phase: 'in', emailVerified: true, nicknamePrompt: true },
    ]) {
      await patch(fields); await trigger.click();
      await page.locator('[data-account-settings]').click(); await settings.waitFor();
      await page.locator('[data-account-back]').click(); await page.keyboard.press('Escape');
      await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    }
    await patch({ phase: 'in', email: 'fixture@example.test', role: 'admin', emailVerified: true, nicknamePrompt: false });
    await trigger.click(); await page.locator('[data-account-settings]').click();
    assert.equal(await settings.locator('[data-settings-admin]').count(), 1);
    await settings.locator('[data-settings-admin]').click();
    await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    await page.waitForURL(/\/admin\/?$/);
    await page.goto(new URL('shelf', base).href); await trigger.waitFor();
    await page.waitForFunction(async () => { const {useAccount} = await import('/src/lib/account-store.ts'); return useAccount.getState().phase !== 'unknown'; });
    await trigger.click(); await page.locator('[data-account-settings]').click();
    assert.equal(await settings.locator('[data-settings-admin]').count(), 0);
    await settings.locator('[data-settings-tutorial]').click();
    await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    await page.locator('[data-tutorial-row]').first().waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${locale} ${width}px ${signedIn ? 'signed-in' : 'guest'}: avatar, account/settings, themes/language, drafts/focus, stable geometry`);
  } finally { await context.close(); }
}
} finally { await browser.close(); }
