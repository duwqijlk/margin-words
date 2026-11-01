// Local synthetic accounts only. No real credentials, uploads, speech or external traffic.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BOOK, seed, installRecorders, settle, stability } from './lib/word-ipa-fixture.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8098/');
const out = new URL('../../local-exports/', import.meta.url);
await mkdir(out, { recursive: true });
const labels = Object.fromEntries(await Promise.all(['en', 'zh'].map(async locale => {
  const src = await readFile(new URL(`../src/lib/i18n-${locale}.ts`, import.meta.url), 'utf8');
  return [locale, key => {
    const match = src.match(new RegExp(`"${key.replaceAll('.', '\\.')}":\\s*("(?:[^"\\\\]|\\\\.)*")`));
    assert.ok(match, `Missing ${locale} dictionary label: ${key}`);
    return JSON.parse(match[1]);
  }];
})));
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const guest = { phase: 'out', email: null, nickname: null, publicId: null, avatar: 0, role: 'user', emailVerified: true, nicknamePrompt: false, sync: 'idle' };
const member = { ...guest, phase: 'in', email: 'fixture@example.test', nickname: 'River', publicId: 'abc123def456', avatar: 1 };

async function isolate(context, locale) {
  await context.addInitScript(locale => {
    for (const key of ['tutorial', 'feedback-tip', 'quote-tip']) localStorage.setItem('cibian-' + key + '-v1', 'seen');
    // Do not overwrite a language selected in the UI when checking reload persistence.
    if (!localStorage.getItem('cibian-locale-v1')) localStorage.setItem('cibian-locale-v1', locale);
  }, locale);
  await installRecorders(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) return route.abort();
    if (url.pathname.includes('/avatars/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#395b4b"/></svg>' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.pathname === '/api/auth/me'
      ? { glossary: { used: 1, limit: 3, resetAt: 0, speech: { used: 0, limit: 3, resetAt: 0 } } }
      : {}) });
    return route.continue();
  });
}

async function waitForAccount(page) {
  await page.locator('[data-account-button]').waitFor();
  await page.waitForFunction(async () => {
    const { useAccount } = await import('/src/lib/account-store.ts');
    return useAccount.getState().phase !== 'unknown';
  });
}

async function patchAccount(page, fields) {
  await page.evaluate(async fields => {
    const { useAccount } = await import('/src/lib/account-store.ts');
    useAccount.getState().patch(fields);
  }, fields);
}

async function accountState(page) {
  return page.evaluate(async () => {
    const { useAccount } = await import('/src/lib/account-store.ts');
    return JSON.parse(JSON.stringify(useAccount.getState()));
  });
}

async function assertFlatPreferences(page, locale) {
  const dialog = page.locator('[data-account-dialog]');
  const prefs = dialog.locator('[data-account-preferences]');
  await prefs.waitFor({ state: 'attached' });
  assert.equal(await prefs.count(), 1, 'one direct preferences block');
  assert.equal(await page.locator('[role=dialog]:visible').count(), 1, 'Account is the only dialog');
  assert.equal(await page.locator('[data-settings-button], [data-settings-panel], [data-account-settings], [data-account-back], [data-settings-admin]').count(), 0, 'no secondary Settings entry, page, back control or old admin entry');
  assert.equal(await dialog.locator('[data-settings-theme], [data-theme-tiles], [data-theme-tile]').count(), 0, 'themes belong to reader Aa, never Account');
  assert.equal(await prefs.evaluate(el => !el.closest('form') && !el.querySelector('form')), true, 'preferences remain outside authentication forms');
  for (const hook of ['data-settings-language', 'data-settings-pronunciation', 'data-settings-tutorial', 'data-guide-link']) {
    assert.equal(await prefs.locator(`[${hook}]`).count(), 1, `direct ${hook} available`);
  }
  assert.deepEqual(await prefs.locator('section').evaluateAll(els => els.map(el => el.getAttribute('aria-label'))),
    [labels[locale]('settings.general'), labels[locale]('settings.help')], 'general preferences then help');
  const guide = prefs.locator('[data-guide-link]');
  assert.ok(await guide.getAttribute('href'), 'guide has a real destination');
  assert.equal(await guide.getAttribute('target'), '_blank');
  assert.ok((await guide.getAttribute('rel')).split(/\s+/).includes('noopener'));
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal Account overflow');
  return prefs;
}

async function assertBefore(first, second, message) {
  const firstElement = await first.elementHandle();
  try {
    assert.ok(await second.evaluate((el, previous) => Boolean(previous.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), firstElement), message);
  } finally { await firstElement.dispose(); }
}

async function closeAccount(page) {
  await page.keyboard.press('Escape');
  await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-account-button'));
}

async function screenshot(page, suffix) {
  await page.screenshot({ path: fileURLToPath(new URL(`account-flat-${suffix}.png`, out)) });
}

async function accountCase(locale, width, signedIn) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await isolate(context, locale);
  const page = await context.newPage(), errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  const identity = signedIn ? member : guest;
  try {
    await page.goto(new URL('shelf', base).href);
    await waitForAccount(page);
    await patchAccount(page, identity);
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.locator('[data-account-button]');
    await page.waitForFunction(expected => document.querySelectorAll('[data-account-button] [data-avatar]').length === expected, signedIn ? 1 : 0);
    if (!signedIn) assert.equal(await trigger.locator('svg.lucide-user-round').count(), 1);
    if (signedIn) await page.waitForFunction(() => document.querySelector('[data-account-button] img')?.naturalWidth > 0);
    const geometry = () => page.locator('header').evaluate(el => { const r = el.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height, scrollY]; });
    const before = await geometry();
    await trigger.click();
    let prefs = await assertFlatPreferences(page, locale);
    assert.equal(await page.locator('[data-account-admin]').count(), 0, 'ordinary member/guest has no admin row');
    if (signedIn) {
      const profile = page.locator('[data-account-avatar]'), reading = page.locator('[data-reading-overview]');
      const quota = page.locator('[data-account-glossary]'), management = page.locator('[data-account-more]');
      await assertBefore(profile, reading, 'profile precedes reading');
      await assertBefore(reading, quota, 'reading precedes quota');
      await assertBefore(quota, prefs, 'quota precedes general/help preferences');
      await assertBefore(prefs, management, 'preferences precede account management');
      assert.deepEqual(await management.locator('[data-account-export], [data-account-logout], [data-account-delete]').evaluateAll(els => els.map(el =>
        ['export', 'logout', 'delete'].find(key => el.hasAttribute('data-account-' + key)))), ['export', 'logout', 'delete']);
      await page.locator('[data-account-nickname-edit]').click();
      await page.locator('[data-account-nickname]').fill('Unsaved River');
    } else {
      await assertBefore(page.locator('[data-account-submit]').locator('xpath=ancestor::form'), prefs, 'guest form precedes direct preferences');
      await page.locator('[data-account-email]').fill('draft@example.test');
      await page.locator('[data-account-password="account-password"]').fill('Synthetic draft 42!');
    }
    const drafts = async () => page.locator('[data-account-email], [data-account-password], [data-account-nickname]').evaluateAll(els => els.map(el => [el.getAttribute('data-account-password') || el.id, el.value]));
    const draftBefore = await drafts(), authBefore = await accountState(page), requestsBefore = apiRequests.length;
    await prefs.locator('[data-settings-pronunciation]').getByRole('button', { name: labels[locale]('ipa.uk'), exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.pronunciationAccent), 'UK');
    assert.deepEqual(await drafts(), draftBefore, 'accent change preserves every auth/profile draft');
    const otherLocale = locale === 'en' ? 'zh' : 'en';
    await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('cibian-locale-v1')), otherLocale);
    prefs = await assertFlatPreferences(page, otherLocale);
    assert.deepEqual(await drafts(), draftBefore, 'language change preserves every auth/profile draft');
    assert.deepEqual(await accountState(page), authBefore, 'preferences never change account state');
    assert.equal(apiRequests.length, requestsBefore, 'preferences never submit an auth form or request account APIs');
    await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
    await prefs.locator('[data-settings-pronunciation]').scrollIntoViewIfNeeded();
    await screenshot(page, `${locale}-${width}-${signedIn ? 'in' : 'guest'}`);
    assert.deepEqual(await drafts(), draftBefore, 'roundtrip language still preserves drafts');
    await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
    await closeAccount(page);
    assert.deepEqual(await geometry(), before, 'Account leaves shelf geometry and scroll untouched');

    // Real reload, not re-seeding storage: both preferences must survive reopening.
    await page.reload(); await waitForAccount(page); await patchAccount(page, identity);
    await trigger.click(); prefs = await assertFlatPreferences(page, otherLocale);
    assert.equal(await page.evaluate(() => localStorage.getItem('cibian-locale-v1')), otherLocale);
    assert.equal(await prefs.locator('[data-settings-pronunciation]').getByRole('button', { name: labels[otherLocale]('ipa.uk'), exact: true }).getAttribute('aria-pressed'), 'true');
    await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
    await prefs.locator('[data-settings-pronunciation]').getByRole('button', { name: labels[locale]('ipa.us'), exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.pronunciationAccent), 'US');
    await closeAccount(page);

    // A failed avatar falls back, then a new version remounts and loads again.
    await patchAccount(page, { ...member, avatar: 2 }); await trigger.locator('img').waitFor();
    await trigger.locator('img').evaluate(el => el.dispatchEvent(new Event('error')));
    await trigger.locator('span[data-avatar]').waitFor();
    await patchAccount(page, { avatar: 3 }); await trigger.locator('img').waitFor();
    await patchAccount(page, guest); assert.equal(await trigger.locator('img').count(), 0);

    // Incomplete guests, offline sessions, verification and nickname prompts all retain preferences.
    for (const [state, fields] of [
      ['incomplete-guest', { ...guest, phase: 'unknown', sync: 'offline' }],
      ['offline-member', { ...member, sync: 'offline' }],
      ['unverified', { ...member, emailVerified: false }],
      ['nickname', { ...member, nickname: null, nicknamePrompt: true }],
    ]) {
      await patchAccount(page, fields); await trigger.click();
      prefs = await assertFlatPreferences(page, locale);
      if (state === 'unverified') await page.locator('[data-email-code-input]').fill('123');
      if (state === 'nickname') await page.locator('[data-account-nickname]').fill('Draft Nickname');
      if (state === 'incomplete-guest') await page.locator('[data-account-email]').fill('offline-draft@example.test');
      const incompleteDrafts = () => page.locator('[data-account-dialog] input').evaluateAll(els => els.map(el => [el.id, el.value]));
      const stateBefore = await accountState(page), incompleteBefore = await incompleteDrafts();
      await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
      await assertFlatPreferences(page, otherLocale);
      await prefs.locator('[data-settings-pronunciation]').getByRole('button', { name: labels[otherLocale]('ipa.uk'), exact: true }).click();
      await prefs.locator('[data-settings-language] button[aria-pressed=false]').click();
      assert.deepEqual(await accountState(page), stateBefore, `${state}: preferences preserve auth state`);
      assert.deepEqual(await incompleteDrafts(), incompleteBefore, `${state}: language/accent preserve incomplete form drafts`);
      if (state === 'unverified') await page.locator('[data-email-code]').waitFor({ state: 'attached' });
      if (state === 'nickname') await page.locator('[data-nickname-prompt]').waitFor({ state: 'attached' });
      await closeAccount(page);
    }

    // Both gates expose the direct management row, and clicking dismisses before navigation.
    const sponsorEmail = await page.evaluate(async () => (await import('/src/lib/sponsor.ts')).SPONSOR_EMAIL);
    for (const fields of [{ ...member, role: 'admin' }, { ...member, email: sponsorEmail }]) {
      await patchAccount(page, fields); await trigger.click();
      prefs = await assertFlatPreferences(page, locale);
      const management = page.locator('[data-account-more]'), admin = management.locator('[data-account-admin]');
      assert.equal(await admin.count(), 1, 'role admin or sponsor admin has exactly one management entry');
      assert.equal(await prefs.locator('[data-account-admin]').count(), 0, 'admin never belongs to general/help');
      assert.deepEqual(await management.locator('[data-account-admin], [data-account-export], [data-account-logout], [data-account-delete]').evaluateAll(els => els.map(el =>
        ['admin', 'export', 'logout', 'delete'].find(key => el.hasAttribute('data-account-' + key)))), ['admin', 'export', 'logout', 'delete']);
      await admin.click(); await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
      await page.waitForURL(/\/admin\/?$/);
      assert.equal((await accountState(page)).dialogOpen, false, 'navigation dismisses Account');
      await page.goto(new URL('shelf', base).href); await waitForAccount(page);
    }
    await patchAccount(page, identity); await trigger.click();
    prefs = await assertFlatPreferences(page, locale);
    assert.equal(await page.locator('[data-account-admin]').count(), 0);
    await prefs.locator('[data-settings-tutorial]').click();
    await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    await page.locator('[data-tutorial-row]').first().waitFor();
    assert.equal((await accountState(page)).dialogOpen, false, 'tutorial navigation dismisses Account');
    assert.deepEqual(errors, []);
    console.log(`PASS ${locale} ${width}px ${signedIn ? 'signed-in' : 'guest'}: flat Account order, preferences/persistence, drafts, focus, auth states, admin/tutorial`);
  } finally { await context.close(); }
}

async function readerThemes() {
  // Independent fresh notebook/context: never reuses any account case or user books.
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await isolate(context, 'en');
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let probe;
  try {
    await page.goto(new URL('shelf', base).href); await waitForAccount(page);
    await page.evaluate(() => {
      const notebook = JSON.parse(localStorage.getItem('cibian-notebook-v1'));
      assertEmpty();
      function assertEmpty() {
        if (notebook?.state?.books?.length || notebook?.state?.words?.length) throw new Error('Expected an empty isolated synthetic notebook');
      }
      localStorage.removeItem('cibian-notebook-v1');
    });
    await seed(page, { locale: 'en', theme: 'light' });
    await page.goto(new URL(`read/${BOOK}`, base).href);
    await page.locator('article p').first().waitFor();
    await page.evaluate(() => document.fonts.ready); await settle(page);
    for (const theme of ['sepia', 'dark', 'eink', 'light']) {
      probe = await stability(page);
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')));
      await page.getByRole('button', { name: labels.en('rs.aria'), exact: true }).click();
      const settings = page.locator('[data-reader-settings]'); await settings.waitFor();
      assert.equal(await settings.locator('[data-theme-tile]').count(), 4, 'Aa retains all four reader themes');
      await probe.check(`${theme}: Aa opened`);
      await settings.locator(`[data-theme-tile="${theme}"]`).click(); await settle(page);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.theme), theme);
      assert.equal(await settings.locator(`[data-theme-tile="${theme}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await settings.locator('[data-theme-tile][aria-pressed=true]').count(), 1);
      await probe.check(`${theme}: theme selected`);
      if (theme === 'dark') await screenshot(page, 'reader-aa-themes');
      await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' }); await settle(page);
      await probe.check(`${theme}: Aa closed`); await probe.stop(); probe = null;
      await page.reload(); await page.locator('article p').first().waitFor();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cibian-prefs-v1')).state.theme), theme, 'theme persists through a real reload');
    }
    assert.deepEqual(errors, []);
    console.log('PASS isolated synthetic reader: Aa four themes persist after reload, no article/paragraph/word/scroll geometry shifts');
  } finally { if (probe) await probe.stop(); await context.close(); }
}

try {
  for (const locale of ['en', 'zh']) for (const width of [320, 1280]) for (const signedIn of [false, true]) {
    await accountCase(locale, width, signedIn);
  }
  await readerThemes();
} finally { await browser.close(); }
