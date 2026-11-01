// Local mocked mail/auth/challenge only. No credentials or messages reach an external service.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8098/');
const out = new URL('../../local-exports/', import.meta.url);
await mkdir(out, { recursive: true });
const dict = Object.fromEntries(await Promise.all(['en', 'zh'].map(async locale => {
  const text = await readFile(new URL(`../src/lib/i18n-${locale}.ts`, import.meta.url), 'utf8');
  return [locale, key => JSON.parse(text.match(new RegExp(`"${key.replaceAll('.', '\\.')}":\\s*("(?:[^"\\\\]|\\\\.)*")`))[1])];
})));
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
for (const locale of ['en', 'zh']) for (const width of [320, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(locale => {
    localStorage.setItem('cibian-locale-v1', locale);
    for (const key of ['tutorial', 'feedback-tip', 'quote-tip']) localStorage.setItem('cibian-' + key + '-v1', 'seen');
    HTMLMediaElement.prototype.play = async () => {};
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
    window.__challenge = { renders: 0, resets: 0, options: null };
    window.turnstile = {
      render(_holder, options) { window.__challenge.renders++; window.__challenge.options = options; return 'mock-widget'; },
      reset() { window.__challenge.resets++; window.__challenge.options?.['expired-callback']?.(); },
      remove() {},
    };
  }, locale);
  let starts = 0, confirms = 0, resends = 0, resendError = 'code-expired', confirmError = 'code-expired';
  const submitted = [], forbidden = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base.origin) { forbidden.push(url.origin); return route.abort(); }
    if (url.pathname === '/src/components/account-dialog.tsx') {
      const response = await route.fetch();
      let source = await response.text();
      assert.ok(source.includes('(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim()'), 'dev module challenge gate available');
      // Enable a synthetic site key in this isolated browser response, never in application source.
      source = source.replace('(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim()', '"mock-site-key"');
      return route.fulfill({ response, body: source });
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/register') {
      const body = request.postDataJSON(); starts++; submitted.push(body);
      assert.equal(body.turnstileToken, `challenge-${starts}`, 'each registration has a new challenge token');
      return json({ pending: true, email: 'retry@example.test', ticket: `ticket-${starts}`, codeSent: true }, 202);
    }
    if (url.pathname === '/api/auth/register/confirm') {
      const body = request.postDataJSON(); confirms++;
      if (confirmError) return json({ error: confirmError }, 400);
      assert.equal(body.ticket, `ticket-${starts}`, 'confirmation uses the fresh ticket');
      return json({ user: { email: 'retry@example.test', nickname: 'Fixture', role: 'user', emailVerified: true, publicId: 'abc123def456', avatar: 0 } }, 201);
    }
    if (url.pathname === '/api/auth/register/resend') {
      resends++;
      return resendError ? json({ error: resendError }, resendError === 'rate' || resendError === 'code-wait' ? 429 : 400) : json({ pending: true, codeSent: true });
    }
    if (url.pathname === '/api/auth/email-code/send') return json({ codeSent: true });
    if (url.pathname.startsWith('/api/')) return json({});
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(new URL('shelf', base).href); await page.locator('[data-account-button]').waitFor();
    await page.waitForFunction(async () => (await import('/src/lib/account-store.ts')).useAccount.getState().phase === 'out');
    await page.locator('[data-account-button]').click();
    await page.locator('[data-account-home]').getByRole('button', { name: dict[locale]('account.register'), exact: true }).click();
    const submit = page.locator('[data-account-submit]');
    const fill = async () => {
      await page.locator('[data-account-email]').fill('retry@example.test');
      await page.locator('#account-password').fill('synthetic password');
      await page.locator('#account-password-again').fill('synthetic password');
    };
    const challenge = async n => page.evaluate(n => window.__challenge.options.callback(`challenge-${n}`), n);
    await page.waitForFunction(() => window.__challenge.renders >= 1);
    await fill(); await challenge(1); await submit.click(); await page.locator('[data-email-code-input]').waitFor();
    await page.locator('[data-email-code-input]').fill('123456'); await page.locator('[data-email-code-confirm]').click();
    await page.getByText(dict[locale]('account.signupCodeExpired'), { exact: true }).waitFor();
    assert.equal(await page.locator('[data-signup-restart]').count(), 0, 'confirm expiry alone can still resend');
    // Retryable failures must not throw away the pending ticket or force a new registration.
    for (const error of ['code-wait', 'rate', 'code-send', 'network']) {
      resendError = error; await page.locator('[data-email-code-resend]').click();
      await page.locator('[data-account-error]').waitFor();
      assert.equal(await page.locator('[data-signup-restart]').count(), 0);
      assert.equal(starts, 1);
    }
    resendError = 'code-expired'; await page.locator('[data-email-code-resend]').click();
    await page.locator('[data-signup-restart]').waitFor();
    assert.equal(await page.locator('[data-email-code-confirm]').count(), 0);
    assert.equal(await page.locator('[data-email-code-resend]').count(), 0);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.locator('[data-account-dialog]').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: new URL(`signup-expired-${locale}-${width}.png`, out).pathname.replace(/^\/(\w:)/, '$1') });
    await page.keyboard.press('Escape'); await page.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
    await page.locator('[data-account-button]').click();
    await page.locator('[data-account-home]').getByRole('button', { name: dict[locale]('account.register'), exact: true }).click();
    await page.locator('[data-signup-restart]').waitFor();
    const before = await page.evaluate(() => window.__challenge.renders);
    await page.locator('[data-signup-restart]').click(); await submit.waitFor();
    assert.equal(await page.locator('[data-account-email]').inputValue(), 'retry@example.test');
    await page.waitForFunction(n => window.__challenge.renders > n, before);
    await fill(); await submit.click();
    await page.getByText(dict[locale]('account.err.turnstile'), { exact: true }).waitFor();
    assert.equal(starts, 1, 'expired challenge cannot start registration');
    await challenge(2); await submit.click(); await page.locator('[data-email-code-input]').waitFor();
    assert.equal(starts, 2); assert.equal(await page.locator('[data-signup-restart]').count(), 0);
    assert.equal(await page.locator('[data-email-code-input]').inputValue(), '');
    resendError = ''; await page.locator('[data-email-code-resend]').click();
    await page.locator('[data-email-code-note]').waitFor();
    confirmError = ''; await page.locator('[data-email-code-input]').fill('654321');
    await page.locator('[data-email-code-confirm]').click();
    await page.waitForFunction(async () => (await import('/src/lib/account-store.ts')).useAccount.getState().email === 'retry@example.test');
    // Existing-account verification must keep the non-signup resend flow.
    await page.evaluate(async () => { const {useAccount} = await import('/src/lib/account-store.ts'); useAccount.getState().patch({ nicknamePrompt: false, emailVerified: false, dialogOpen: true }); });
    await page.locator('[data-email-code-resend]').click(); await page.locator('[data-email-code-note]').waitFor();
    assert.equal(await page.locator('[data-signup-restart]').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
    console.log(`PASS ${locale} ${width}px: expiry/restart, close/reopen, fresh challenge/ticket, retryable errors, live resend and existing-account verification; no mail or live writes`);
  } finally { await context.close(); }
}
} finally { await browser.close(); }
