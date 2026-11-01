// Real save/remove plus computed-style probes; never changes source CSS or fixture data.
// node scripts/saved-word-highlight-e2e.mjs [baseUrl]
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BOOK, seed, installRecorders, anchor, position, tap, settle } from './lib/word-ipa-fixture.mjs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8098/').replace(/\/?$/, '/');
const exportsDir = fileURLToPath(new URL('../../local-exports/', import.meta.url));
const palettes = {
  light: { marks: ['#f5e9cf', '#efddb7', '#e8d09b'], hint: '#395b4b' },
  sepia: { marks: ['#eadbbf', '#e2cca5', '#d8bc8a'], hint: '#435b45' },
  dark: { marks: ['#383022', '#483b27', '#5a482d'], hint: '#bdd1c4' },
  eink: { marks: ['#d9d9d9', '#cccccc', '#bbbbbb'], hint: '#000000' },
};
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;
const transparent = 'rgba(0, 0, 0, 0)';
const settingsNames = Object.fromEntries(await Promise.all(['en', 'zh'].map(async locale => {
  const source = await readFile(new URL(`../src/lib/i18n-${locale}.ts`, import.meta.url), 'utf8');
  const match = source.match(/"rs\.aria":\s*("(?:[^"\\]|\\.)*")/);
  assert.ok(match, `Missing ${locale} reading settings label`);
  return [locale, JSON.parse(match[1])];
})));
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
let failures = 0, passed = 0;
const mediaCoverage = new Set();
await mkdir(exportsDir, { recursive: true });

async function geometry(page) {
  return page.evaluate(() => {
    const rect = el => [...el.getClientRects()].map(r => [r.x + scrollX, r.y + scrollY, r.width, r.height]);
    const p = document.querySelectorAll('article p')[10];
    return { article: rect(document.querySelector('article')), paragraph: rect(p),
      words: [...p.querySelectorAll('[data-word], .book-tap')].map(rect), height: document.documentElement.scrollHeight };
  });
}

async function styleOf(word) {
  return word.evaluate(el => {
    const s = getComputedStyle(el), outer = getComputedStyle(el.parentElement);
    const resolve = name => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      el.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    return { background: s.backgroundColor, image: s.backgroundImage, color: s.color,
      decoration: s.textDecorationLine, outerDecoration: outer.textDecorationLine,
      shadow: s.boxShadow, outerShadow: outer.boxShadow,
      outline: s.outlineStyle, outerOutline: outer.outlineStyle,
      display: s.display, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
      tokens: Object.fromEntries(['--mark', '--mark-hover', '--mark-active', '--word-hint', '--ink', '--accent-soft']
        .map(name => [name, resolve(name)])) };
  });
}

function check(style, { background, color, current = false }, label) {
  assert.equal(style.background, background, `${label}: exact full-height background`);
  assert.equal(style.image, 'none', `${label}: no partial-height gradient`);
  assert.equal(style.color, color, `${label}: exact ink token`);
  assert.equal(style.decoration, 'none', `${label}: no underline`);
  assert.equal(style.outerDecoration, 'none', `${label}: no ancestor underline`);
  assert.equal(style.shadow, 'none', `${label}: no text shadow box`);
  assert.equal(style.display, 'inline', `${label}: full inline background, not a layout-changing block`);
  assert.deepEqual(style.padding, ['0px', '0px', '0px', '0px'], `${label}: no added inline padding`);
  if (current) {
    assert.equal(style.outline, 'none', `${label}: current ink has no outline`);
    assert.equal(style.outerOutline, 'none', `${label}: actual current word has no outline`);
    assert.equal(style.outerShadow, 'none', `${label}: current word has no shadow`);
  }
}

async function closeCard(page) {
  const card = page.locator('[data-word-card]');
  await card.locator('[data-panel-close]').click();
  await card.waitFor({ state: 'detached' });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(550);
  await settle(page);
}

async function toggleHints(page, locale, quiet) {
  // Real React settings switch: checked is the inverse of persisted quietMarks.
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')));
  const trigger = page.getByRole('button', { name: settingsNames[locale], exact: true });
  await trigger.click();
  const toggle = page.locator('[data-reader-quiet-marks]');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), String(quiet), 'pre-toggle checked=!quietMarks');
  await toggle.click();
  await page.waitForFunction(value => {
    const prefs = JSON.parse(localStorage.getItem('cibian-prefs-v1'));
    return prefs.state.quietMarks === value
      && document.querySelector('article').hasAttribute('data-quiet-marks') === value;
  }, quiet);
  assert.equal(await toggle.getAttribute('aria-checked'), String(!quiet), 'post-toggle checked=!quietMarks');
  await page.keyboard.press('Escape');
  await page.locator('[data-reader-settings]').waitFor({ state: 'detached' });
  await page.mouse.move(0, 0);
  await settle(page);
}

async function matrix(page, word, theme, quiet, baseline, monochrome = false) {
  const original = await word.evaluate(el => el.parentElement.className);
  const hint = monochrome ? (await styleOf(word)).tokens['--ink'] : rgb(palettes[theme].hint);
  const grayHint = theme === 'eink' || monochrome;
  const marks = (monochrome ? palettes.eink : palettes[theme]).marks.map(rgb);
  try {
    // Probe states independently of lexicon availability; real saving and quiet settings are tested separately.
    for (const classes of ['book-hard', 'book-phrase', 'book-tricky', 'book-wait',
      'book-hard book-wait', 'book-hard book-saved', 'book-phrase book-saved',
      'book-tricky book-saved', 'book-wait book-saved', 'book-hard book-on',
      'book-phrase book-saved book-on', 'book-tricky book-saved book-on', 'book-wait book-saved book-on']) {
      await word.evaluate((el, value) => { el.parentElement.className = value; }, classes);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(120);
      const s = await styleOf(word);
      const saved = classes.includes('book-saved'), current = classes.includes('book-on');
      const waiting = classes.includes('book-wait');
      const hidden = quiet && !saved && !current;
      check(s, { color: saved || current || waiting || hidden ? s.tokens['--ink'] : hint,
        background: saved ? marks[current ? 2 : 0] : current ? s.tokens['--accent-soft']
          : hidden || waiting || !grayHint ? transparent : rgb('#eeeeee'), current },
      `${quiet ? 'quiet' : 'hints'} ${classes}`);
      assert.deepEqual(await geometry(page), baseline, `${classes}: state precedence never shifts reader geometry`);
      await word.hover();
      await page.waitForTimeout(140);
      const hover = await styleOf(word);
      check(hover, { color: s.color, background: saved ? marks[current ? 2 : 1]
        : current ? s.tokens['--accent-soft'] : hidden || waiting ? transparent
          : grayHint ? rgb('#eeeeee') : s.tokens['--accent-soft'], current }, `${classes} hover`);
      assert.deepEqual(await geometry(page), baseline, `${classes}: hover geometry stable`);
    }
  } finally {
    await word.evaluate((el, value) => { el.parentElement.className = value; }, original);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(140);
  }
}

try {
  for (const locale of ['en', 'zh']) for (const width of [320, 1280]) for (const theme of Object.keys(palettes)) {
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
    const label = `${locale} ${width}px ${theme}`;
    try {
      await page.addInitScript(() => {
        for (const key of ['cibian-tutorial-v1', 'cibian-feedback-tip-v1', 'cibian-quote-tip-v1']) localStorage.setItem(key, 'seen');
      });
      await page.goto(base + 'shelf');
      await page.waitForSelector('header');
      await page.evaluate(() => {
        const notebook = JSON.parse(localStorage.getItem('cibian-notebook-v1'));
        if (notebook?.state?.books?.length || notebook?.state?.words?.length) throw new Error('Expected an empty isolated notebook');
        localStorage.removeItem('cibian-notebook-v1');
      });
      await seed(page, { locale, theme, phrases: true });
      await page.goto(base + 'read/' + BOOK);
      await page.locator('article p').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2800);
      const word = anchor(page, 'bath');
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')));
      await position(page, word);
      await page.waitForTimeout(850);
      const before = await geometry(page), marks = palettes[theme].marks.map(rgb);
      const initial = await styleOf(word);
      for (const [i, token] of ['--mark', '--mark-hover', '--mark-active'].entries()) {
        assert.equal(initial.tokens[token], marks[i], `${label}: ${token} exact palette`);
      }
      assert.equal(initial.tokens['--word-hint'], rgb(palettes[theme].hint), 'exact hint theme token');
      assert.equal(await word.evaluate(el => el.parentElement.hasAttribute('tabindex')), false,
        'native-selection word span is not made keyboard-focusable');
      await tap(page, word);
      const card = page.locator('[data-word-card]');
      await card.waitFor();
      await card.locator('[data-word-save]').click();
      await page.waitForTimeout(600);
      assert.equal(await word.evaluate(el => el.parentElement.classList.contains('book-saved') && el.parentElement.classList.contains('book-on')), true);
      let s = await styleOf(word);
      check(s, { background: marks[2], color: s.tokens['--ink'], current: true }, 'real saved/current');
      assert.deepEqual(await geometry(page), before, 'real save/current has no geometry shifts');
      await closeCard(page);
      s = await styleOf(word);
      check(s, { background: marks[0], color: s.tokens['--ink'] }, 'real saved/normal');
      await word.hover();
      await page.waitForTimeout(150);
      s = await styleOf(word);
      check(s, { background: marks[1], color: s.tokens['--ink'] }, 'real saved/hover');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);

      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      await word.evaluate(el => el.parentElement.setAttribute('data-amber-focus-probe', ''));
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-amber-focus-probe]' });
      // Synthetic CSS pseudo-state only, NOT a claim of a native keyboard focus path.
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
      await page.waitForTimeout(150);
      s = await styleOf(word);
      check(s, { background: marks[1], color: s.tokens['--ink'] }, 'CDP synthetic focus-visible (not keyboard)');
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      await word.evaluate(el => el.parentElement.removeAttribute('data-amber-focus-probe'));
      await page.waitForTimeout(150);
      assert.deepEqual(await geometry(page), before, 'normal/hover/synthetic focus geometry stable');
      await matrix(page, word, theme, false, before);
      await toggleHints(page, locale, true);
      await matrix(page, word, theme, true, before);
      await toggleHints(page, locale, false);
      assert.deepEqual(await geometry(page), before, 'real quiet switch preserves document geometry');

      // Chrome can accept unsupported feature names silently. A successful CDP call alone proves nothing.
      if (locale === 'en' && width === 1280 && theme === 'light') {
        for (const [name, value, query] of [['monochrome', '1', '(monochrome)'], ['update', 'slow', '(update: slow)']]) {
          try {
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
            if (!await page.evaluate(q => matchMedia(q).matches, query)) {
              mediaCoverage.add(`${query}: SKIPPED, CDP accepted feature but matchMedia stayed false`);
              continue;
            }
            await page.waitForTimeout(150);
            const mediaStyle = await styleOf(word);
            for (const [i, token] of ['--mark', '--mark-hover', '--mark-active'].entries()) {
              assert.equal(mediaStyle.tokens[token], palettes.eink.marks.map(rgb)[i], `${query}: grayscale token`);
            }
            await matrix(page, word, theme, false, before, true);
            await toggleHints(page, locale, true);
            await matrix(page, word, theme, true, before, true);
            await toggleHints(page, locale, false);
            mediaCoverage.add(`${query}: VERIFIED by matchMedia and complete hint/saved/current matrix`);
          } catch (error) {
            if (!/Emulation\.setEmulatedMedia|wasn't found|Unknown method|Invalid parameters/.test(error.message)) throw error;
            mediaCoverage.add(`${query}: SKIPPED, unsupported CDP emulation: ${error.message}`);
          } finally { await cdp.send('Emulation.setEmulatedMedia', { features: [] }); }
        }
      }
      await cdp.detach();
      await position(page, word);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${exportsDir}/amber-reader-${locale}-${width}-${theme}.png` });
      await tap(page, word);
      await card.waitFor();
      await page.waitForTimeout(150);
      s = await styleOf(word);
      check(s, { background: marks[2], color: s.tokens['--ink'], current: true }, 'reopen saved/current');
      await card.locator('[data-word-save]').click();
      await page.waitForTimeout(550);
      assert.equal(await word.evaluate(el => el.parentElement.classList.contains('book-saved')), false);
      s = await styleOf(word);
      check(s, { background: s.tokens['--accent-soft'], color: s.tokens['--ink'], current: true }, 'real remove/current');
      await closeCard(page);
      assert.deepEqual(await geometry(page), before, 'real removal preserves word fragments, wrapping and article geometry');
      assert.deepEqual(errors, [], 'no page errors');
      passed++;
      console.log(`PASS ${label}: exact normal/hover/current amber, non-underlined hints, quiet switch inverse, class precedence, real save/remove, zero geometry changes; screenshot saved`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${label}: ${error.stack}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
for (const result of mediaCoverage) console.log(`MEDIA ${result}`);
console.log(`SUMMARY ${passed}/16 passed, ${failures} failed. Native keyboard span focus intentionally NOT tested; CDP focus-visible styling probe only. 375px optional coverage skipped. Screenshots: ${exportsDir}`);
process.exitCode = failures ? 1 : 0;
