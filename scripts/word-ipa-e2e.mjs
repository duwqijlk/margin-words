#!/usr/bin/env node
/**
 * Independent local-IPA browser regression; NEVER starts or builds a server.
 *
 *   node scripts/word-ipa-e2e.mjs [http://127.0.0.1:8099/]
 *
 * Requires existing Playwright/Chrome and an already-running build server. Ordinary production
 * builds use the committed runtime snapshot; local-ipa preview builds use the isolated research
 * snapshot. Oracle: src/data/ipa/manifest.json + its hash-checked shards (IPA_DATA_DIR override).
 * Optional env: CHROME, IPA_DATA_DIR, IPA_VIEWPORT=320x568, IPA_LOCALE=en|zh,
 * IPA_FULL_MATRIX=1 (all theme/font combinations), IPA_SCREENSHOTS=1,
 * SHOT_DIR (default local-exports/ipa-word-card/proof), IPA_SKIP_RACES=1,
 * IPA_CONTINUE=1 (record every failure before nonzero exit; never masks failures),
 * IPA_ONLY_RACES=1 (skip viewport matrix; explicitly filtered proof),
 * IPA_ONLY_LAYOUT=1 (only measured inline/wrap cases; explicitly filtered proof),
 * IPA_ONLY_PLAYBACK=1 (four component playback/touch cases; filtered proof).
 * Runtime and UI both expose at most one accepted UK and one US reading;
 * alternatives/disclosures are forbidden. Only intended per-accent playback
 * controls are allowed: no redundant generic header speak in enabled word mode.
 * Accent icons match IPA text with transparent44px hit areas. Explicit UK/US
 * buttons use one direct uapis audio request for the requested accent, never
 * another accent or SpeechSynthesis; failures show visible retry feedback.
 * Generic reader auto speech and phrase/header callers use the uapis American
 * recording (accent=us) first, then the British one (accent=uk). Four extra
 * playback/touch cases bring default total48.
 * Positive coverage includes an easy word with no glossary entry (the) and a
 * real single-accent, no-glossary hit (takin). Negative faults must recover by
 * closing/reopening, and no optional-data failure may reload the reader.
 * Eight extra real-data layout cases measure short bath inline when all controls
 * fit and real university IPA wrapping into two locale rows (actual Range text
 * geometry includes buttons; no DOM/CSS edits).
 * Default matrix: every viewport + both languages + each theme, with rotated
 * 100/125/150% root fonts. FULL_MATRIX crosses all three fonts with each theme.
 * A filtered run is labeled as such; skipped races are never reported as passed.
 *
 * Every case uses a fresh, nonpersistent context and a synthetic IndexedDB book.
 * All /api requests are mocked; remote requests, catalogs, book files and real
 * external lookups are blocked. Audio and SpeechSynthesis are recorded, never
 * downloaded or played; explicit uapis media URLs are also synthetic.
 * Successful IPA is NEVER mocked: delayed requests continue to the real shard.
 * Only dedicated negative cases replace a shard with malformed schema or HTTP 503.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  BOOK, PHRASE, UNKNOWN, LONG_IPA, cardSelector, ipaSelector, settle, installRecorders,
  seed, anchor, position, tap, effects, assertOneAudio, finishAnimations,
  close, exposeBody, chromeGeometry, stability,
} from './lib/word-ipa-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = new URL((process.argv[2] ?? 'http://127.0.0.1:8099/').replace(/\/?$/, '/'));
assert.ok(['http:', 'https:'].includes(BASE.protocol), 'Base URL must use HTTP(S)');
const DATA = resolve(process.env.IPA_DATA_DIR ?? resolve(ROOT, 'src/data/ipa'));
const SHOT_DIR = resolve(process.env.SHOT_DIR ?? resolve(ROOT, 'local-exports/ipa-word-card/proof'));
const screenshots = process.env.IPA_SCREENSHOTS === '1';
const TIMEOUT = 12000;
const NAV_TIMEOUT = 45000; // Other independent browser suites may share the same preview.
const results = [];
const sourceHashes = Object.fromEntries(await Promise.all(
  ['scripts/word-ipa-e2e.mjs', 'scripts/lib/word-ipa-fixture.mjs'].map(async file =>
    [file, createHash('sha256').update(await readFile(resolve(ROOT, file))).digest('hex')]),
));

async function loadOracle() {
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(DATA, 'manifest.json'), 'utf8')); }
  catch (error) { throw new Error(`Generated IPA manifest required at ${DATA}/manifest.json. Ask the parent to finish the real data build first. ${error.message}`); }
  assert.equal(manifest.schemaVersion, 1, 'real manifest schema');
  assert.ok(typeof manifest.version === 'string' && manifest.version, 'versioned real IPA data');
  assert.ok(manifest.shards && typeof manifest.shards === 'object', 'manifest has shard descriptors');
  const words = new Map();
  const hashes = {};
  for (const [letter, descriptor] of Object.entries(manifest.shards)) {
    assert.match(letter, /^[a-z]$/);
    assert.equal(descriptor.file, `${letter}.json`, 'manifest cannot escape oracle directory');
    const bytes = await readFile(resolve(DATA, descriptor.file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, descriptor.sha256, `actual ${letter} shard matches manifest SHA-256`);
    hashes[letter] = hash;
    const shard = JSON.parse(bytes);
    assert.equal(shard.schemaVersion, 1);
    assert.equal(shard.version, manifest.version);
    for (const [key, value] of Object.entries(shard.words)) {
      assert.equal(key[0].toLowerCase(), letter);
      assert.ok(!words.has(key), 'word appears in exactly one shard');
      for (const locale of ['UK', 'US']) {
        assert.ok(Array.isArray(value[locale]), `${key} has ${locale} array`);
        assert.ok(value[locale].length <= 1, `${key} ${locale}: runtime data exposes at most one accepted reading`);
        for (const reading of value[locale]) assert.ok(typeof reading.ipa === 'string' && reading.ipa.trim(), `${key} has real IPA text`);
      }
      words.set(key, value);
    }
  }
  for (const [word, UK, US] of [['bath', 'bɑːθ', 'bæθ'], ['does', 'dʌz', 'dʌz'], ['book', 'bʊk', 'bʊk']]) {
    assert.ok(words.has(word), `real oracle contains ${word}`);
    assert.equal(words.get(word).UK[0]?.ipa, UK, `${word}: approved first British pronunciation`);
    assert.equal(words.get(word).US[0]?.ipa, US, `${word}: approved first American pronunciation`);
  }
  for (const word of ['bow', 'use']) {
    assert.ok(words.has(word), `real oracle contains ${word}`);
    assert.equal(words.get(word).UK.length, 1, `${word} has exactly one accepted British reading`);
    assert.equal(words.get(word).US.length, 1, `${word} has exactly one accepted American reading`);
  }
  for (const word of [LONG_IPA, 'university']) {
    assert.ok(words.get(word)?.UK.length === 1 && words.get(word)?.US.length === 1,
      `${word}: long layout fixture has real single UK and US readings`);
  }
  assert.ok(words.has('the'), 'easy word has real IPA without a glossary definition');
  assert.ok(words.get('takin')?.UK.length && words.get('takin')?.US.length === 0, 'takin exercises a real UK-only entry');
  assert.ok(!words.has(UNKNOWN), 'synthetic unknown is absent from the real oracle');
  return { manifest, hashes, words };
}

// Works in local-ipa dev and modern Vite preview (/assets/b-HASH.json).
// The former import-module .js pattern is retained for diagnosis of older local
// builds only. Do not gate the loader or unrelated book assets.
function isShard(url, letter) {
  const pathname = decodeURIComponent(new URL(url).pathname).replaceAll('\\', '/');
  return new RegExp(`/assets/${letter}-(?!legacy-)[A-Za-z0-9_-]+\\.(?:js|json)$`).test(pathname)
    || pathname.endsWith(`/ipa-word-card/data/${letter}.json`)
    || pathname.endsWith(`/data/${letter}.json`) && pathname.includes('/local-exports/');
}
function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function shardGate(letter = 'b', fault) {
  const seen = deferred(), released = deferred();
  const gate = { requests: [], seen: seen.promise, release: released.release, recover() { fault = undefined; },
    async handle(route) {
      gate.requests.push(route.request().url());
      seen.release();
      await released.promise;
      if (fault === 'malformed') {
        const isJSON = new URL(route.request().url()).pathname.endsWith('.json') && !new URL(route.request().url()).searchParams.has('import');
        const value = '{"schemaVersion":999,"version":"invalid-negative-test","words":{}}';
        return route.fulfill({ status: 200, contentType: isJSON ? 'application/json' : 'text/javascript',
          body: isJSON ? value : `export default ${value};` });
      }
      if (fault === 'failed') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic unavailable shard' });
      return route.continue();
    }, matches: url => isShard(url, letter) };
  return gate;
}
async function waitGate(page, gate) {
  let timer;
  try {
    await Promise.race([gate.seen, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('No actual lazy shard request intercepted; check local-ipa build mode and resource names')), TIMEOUT);
    })]);
  } finally { clearTimeout(timer); }
  await page.locator(`${ipaSelector}[data-ipa-status="loading"]`).waitFor();
}

const oracle = await loadOracle();
const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

async function fresh(spec, { gate, phrases = false, layoutWord = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
    locale: spec.locale === 'zh' ? 'zh-CN' : 'en-US', isMobile: spec.width < 768,
    hasTouch: spec.width < 768, serviceWorkers: 'block' });
  const remote = [], api = [], blockedBooks = [], pageErrors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (/\/(?:packs|public-books|word-lists)\//.test(url.pathname) || /\.(?:epub|pack\.zip)$/i.test(url.pathname)) {
      blockedBooks.push(url.pathname);
      // Normal boot may ask the configured books host for its catalog. Supply
      // an empty synthetic catalog without ever contacting that host.
      if (url.pathname.endsWith('/catalog.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1,"books":[],"packs":[]}' });
      return route.abort('blockedbyclient');
    }
    if (url.origin !== BASE.origin) {
      if (url.hostname === 'uapis.cn' && url.pathname === '/api/v1/dictionary/audio') {
        return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('synthetic-uapis-audio') });
      }
      remote.push(url.href);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      api.push({ method: route.request().method(), path: url.pathname });
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Synthetic fixture: services disabled"}' });
    }
    if (gate?.matches(url.href)) return gate.handle(route);
    return route.continue();
  });
  await installRecorders(context);
  const page = await context.newPage();
  let readerNavigations = 0;
  const navigationEvents = [], navigationRequests = [], documentEvents = [], sameDocumentEvents = [];
  const navigationSession = await context.newCDPSession(page);
  await navigationSession.send('Page.enable');
  navigationSession.on('Page.frameNavigated', ({ frame }) => {
    if (!frame.parentId) documentEvents.push({ url: frame.url, loaderId: frame.loaderId });
  });
  navigationSession.on('Page.navigatedWithinDocument', event => sameDocumentEvents.push(event));
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationRequests.push(request.url());
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const event = { url: frame.url(), origin: null };
    navigationEvents.push(event);
    void frame.evaluate(() => ({ timeOrigin: performance.timeOrigin,
      navigation: performance.getEntriesByType('navigation').map(entry => ({ name: entry.name, type: entry.type })) }))
      .then(origin => { event.origin = origin; }).catch(error => { event.error = error.message; });
    try {
      if (new URL(frame.url()).pathname === new URL(`read/${BOOK}`, BASE).pathname) readerNavigations++;
    } catch { /* about:blank during page initialization is not a reader navigation. */ }
  });
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    // Run no app code until synthetic storage is seeded. This same-origin blank
    // route is fulfilled in memory, never fetched from the preview server.
    const blank = new URL('__ipa-fixture-seed__', BASE).href;
    await page.route(blank, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic IPA seed</title>' }));
    await page.goto(blank);
    await seed(page, { ...spec, phrases, layoutWord });
    await page.goto(new URL(`read/${BOOK}`, BASE).href);
    await page.locator('article [data-word="bath"]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Match word-card-layout-e2e: release restored-position observer first.
    await page.keyboard.press('Escape');
    if (spec.scale !== 100) await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, spec.scale);
    await settle(page, 8);
    assert.equal(await page.locator('html').getAttribute('lang'), spec.locale === 'zh' ? 'zh-CN' : 'en');
    assert.equal(await page.locator('html').getAttribute('data-theme'), spec.theme);
    assert.equal(await page.locator('[data-word-save]').count(), 0);
    if (gate) assert.equal(gate.requests.length, 0, 'IPA shard is lazy: no request before a word card opens');
    return { context, page, remote, api, blockedBooks, pageErrors,
      async finish() {
        assert.deepEqual(pageErrors, [], 'no uncaught page errors');
        const navigation = { navigationEvents, navigationRequests, documentEvents, sameDocumentEvents };
        console.log(`NAVIGATION ${JSON.stringify({ spec, layoutWord, navigation })}`);
        assert.equal(readerNavigations, 1, `optional IPA never reloads or navigates away from the reader: ${JSON.stringify(navigation)}`);
        assert.deepEqual(remote.filter(value => {
          const url = new URL(value);
          return !(url.hostname === 'uapis.cn' && url.pathname === '/api/v1/dictionary/audio');
        }), [], 'no external lookup or book request attempted (uapis audio is synthetic)');
        assert.ok(!blockedBooks.some(path => !path.endsWith('/catalog.json')), 'synthetic reader requests no real book file');
        assert.ok(!api.some(request => /(?:feedback|book\/|sync|save)/.test(request.path)), 'IPA never submits feedback, fetches a protected book, or syncs/saves');
        assert.deepEqual((await effects(page)).words, [], 'IPA testing never saves a word');
      } };
  } catch (error) { gate?.release(); await context.close(); throw error; }
}

async function open(page, surface, { key = surface, phrase = false, reposition = true } = {}) {
  const target = anchor(page, surface, phrase);
  if (reposition) await position(page, target);
  const before = await effects(page);
  await tap(page, target);
  const card = page.locator(cardSelector);
  await card.waitFor({ state: 'visible' });
  await card.locator('h2').filter({ hasText: key }).waitFor();
  assert.equal(await card.locator('h2').innerText(), key, 'card title is exact displayed state.key or matched phrase');
  await assertOneAudio(page, before, key);
  return card;
}
async function status(page, expected, word) {
  const ipa = page.locator(ipaSelector);
  await ipa.locator(`xpath=self::*[@data-ipa-status="${expected}"]`).waitFor();
  assert.equal(await ipa.count(), 1, 'exactly one IPA component');
  assert.equal(await ipa.getAttribute('data-ipa-word'), word, 'IPA queries the exact displayed state.key');
  assert.ok((await ipa.getAttribute('aria-label'))?.trim(), 'IPA region has a localized accessible name');
  assert.equal(await page.locator(`${cardSelector} [data-word-header] [data-speak]`).count(), 0,
    'IPA-enabled word mode has no redundant generic header speak button');
  if (expected !== 'ready') {
    assert.equal(await ipa.locator('[data-ipa-reading]').count(), 0, 'pending/missing/error never retains stale readings');
    assert.equal(await ipa.locator('[data-speak-accent]').count(), 0, 'pending/missing/error has no accent playback controls');
    assert.ok((await ipa.innerText()).trim(), `${expected} status is readable`);
    assert.equal(await ipa.locator('[role="status"]').count(), 1, `${expected} is announced accessibly`);
  }
  return ipa;
}
async function checkReadings(page, word, { probe } = {}) {
  const ipa = await status(page, 'ready', word);
  // Target dimensions use the settled card, not its temporary entrance scale.
  // The independent RAF probe still observes every pre/post-open reader frame.
  await finishAnimations(page.locator(cardSelector));
  const actual = oracle.words.get(word);
  assert.ok(actual, `no invented positive data for ${word}`);
  assert.equal(await ipa.locator('[data-ipa-more], details, summary').count(), 0,
    'IPA never mounts alternative-reading controls, including hidden disclosures');
  assert.equal(await ipa.evaluate(el => {
    const primary = el.parentElement.querySelector('[data-word-primary]');
    const content = el.closest('[data-word-content]');
    const body = el.closest('[data-word-body]');
    return !!primary && !!body && !!content && content.firstElementChild === el
      && el.nextElementSibling === primary && !primary.contains(el);
  }), true, 'IPA is first in the body content, immediately before and outside the noninteractive primary meaning');
  for (const locale of ['UK', 'US']) {
    const row = ipa.locator(`[data-ipa-locale="${locale}"]`);
    assert.equal(await row.count(), 1, `${locale} is a distinct locale row`);
    const expected = actual[locale].slice(0, 1).map(reading => `/${reading.ipa}/`);
    const readings = row.locator('[data-ipa-reading]');
    assert.equal(await readings.count(), expected.length, `${word} ${locale}: exactly one source-priority reading when available`);
    assert.deepEqual(await readings.allTextContents(), expected,
      `${word} ${locale}: only the first audited source reading is mounted, not POS-selected alternatives`);
    if (!actual[locale].length) {
      assert.ok((await row.innerText()).trim(), `${word} ${locale}: missing accent has a readable localized placeholder`);
      assert.equal(await readings.count(), 0, 'an absent accent is not fabricated from the other accent');
    }
    const buttons = row.locator('[data-speak-accent]');
    assert.equal(await buttons.count(), expected.length, `${word} ${locale}: exactly one intended accent button when IPA exists`);
    assert.equal(await row.locator('button, a, input, select, textarea, [role="button"]').count(), expected.length,
      'IPA contains only the intended accent playback buttons, never alternative controls');
    if (expected.length) {
      assert.equal(await buttons.getAttribute('data-speak-accent'), locale);
      assert.equal(await buttons.evaluate(el => el.tagName), 'BUTTON', 'accent control is a native button');
      assert.ok((await buttons.getAttribute('aria-label'))?.includes(word), 'accent accessible name names exact displayed word');
      const box = await buttons.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `accent control keeps at least44px target: ${JSON.stringify({ word, locale, box })}`);
      const visual = await buttons.evaluate(el => {
        const style = getComputedStyle(el), icon = el.querySelector('svg');
        const iconBox = icon.getBoundingClientRect();
        return { font: parseFloat(getComputedStyle(el.closest('[data-ipa-locale]').querySelector('[data-ipa-reading]')).fontSize),
          icon: { width: iconBox.width, height: iconBox.height },
          borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
          radius: parseFloat(style.borderTopLeftRadius), shadow: style.boxShadow,
          background: style.backgroundColor, hover: el.matches(':hover') };
      });
      assert.ok(Math.abs(visual.icon.width - visual.font) <= 0.1 && Math.abs(visual.icon.height - visual.font) <= 0.1,
        `visible speaker icon matches IPA text size, not the44px hit area: ${JSON.stringify(visual)}`);
      assert.ok(visual.borders.every(value => parseFloat(value) === 0), 'accent hit area has no visible border');
      assert.equal(visual.shadow, 'none', 'accent hit area has no visible shadow');
      assert.ok(visual.radius < box.height / 2, 'accent control is not a large circle');
      if (!visual.hover) assert.ok(['rgba(0, 0, 0, 0)', 'transparent'].includes(visual.background),
        `unhovered accent hit area is transparent: ${visual.background}`);
    }
  }
  await chromeGeometry(page);
  await probe?.check(`${word} single UK/US display`);
  return ipa;
}
async function ipaArrangement(page, mode) {
  const ipa = page.locator(ipaSelector);
  const state = await ipa.evaluate(el => {
    const values = el.querySelector('.word-ipa-values');
    if (!values) throw new Error('IPA value wrapper missing');
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const rows = ['UK', 'US'].map(locale => {
      const node = el.querySelector(`[data-ipa-locale="${locale}"]`);
      const label = node.firstElementChild, reading = node.querySelector('[data-ipa-reading]');
      const text = document.createRange();
      text.selectNodeContents(reading);
      const fragments = [...text.getClientRects()].filter(r => r.width > 0).map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }));
      const style = getComputedStyle(node), labelStyle = getComputedStyle(label), valueStyle = getComputedStyle(values);
      const number = value => Number.parseFloat(value) || 0;
      // Range text width is the real font-shaped value, not character counts or
      // canvas estimates. Read-only geometry; never change DOM/CSS to force fit.
      // A React text span has separate slash/IPA/slash text nodes; a Range can
      // return three adjacent fragments on ONE row. Union them by vertical line.
      const lines = [];
      for (const fragment of fragments) {
        let line = lines.find(value => Math.abs(value.y - fragment.y) <= 1);
        if (!line) { line = { ...fragment }; lines.push(line); }
        else {
          line.x = Math.min(line.x, fragment.x); line.right = Math.max(line.right, fragment.right);
          line.bottom = Math.max(line.bottom, fragment.bottom); line.width = line.right - line.x;
        }
      }
      const button = node.querySelector('[data-speak-accent]');
      const buttonStyle = getComputedStyle(button);
      const naturalWidth = rect(label).width + Math.max(...lines.map(r => r.width)) + rect(button).width
        + number(labelStyle.marginRight) + number(style.columnGap) * 2
        + number(buttonStyle.marginLeft) + number(buttonStyle.marginRight)
        + number(style.paddingLeft) + number(style.paddingRight)
        + number(style.marginLeft) + number(style.marginRight);
      return { locale, ...rect(node), label: rect(label), reading: rect(reading), fragments, lines, naturalWidth,
        parentGap: number(valueStyle.columnGap) };
    });
    return { wrapper: rect(values), rows, width: innerWidth };
  });
  const [UK, US] = state.rows;
  const sameRow = Math.abs(UK.y - US.y) <= 1;
  const naturalTotal = UK.naturalWidth + US.naturalWidth + UK.parentGap;
  if (mode === 'inline') {
    assert.ok(naturalTotal <= state.wrapper.width + 1, `short real IPA fixture naturally fits one row: ${JSON.stringify(state)}`);
    assert.ok(sameRow, `short UK/US render side-by-side, never needlessly stacked: ${JSON.stringify(state)}`);
  } else if (mode === 'wrapped') {
    assert.ok(state.rows.every(row => row.naturalWidth <= state.wrapper.width + 1),
      `each real long locale fits individually without forced text breaking: ${JSON.stringify(state)}`);
    assert.ok(naturalTotal > state.wrapper.width + 1, `real long IPA fixture requires two rows: ${JSON.stringify(state)}`);
    assert.ok(!sameRow && US.y >= UK.bottom - 1, `long real IPA wraps UK/US into two ordered rows: ${JSON.stringify(state)}`);
  } else if (naturalTotal <= state.wrapper.width + 1) {
    assert.ok(sameRow, `available UK/US width is used inline: ${JSON.stringify(state)}`);
  } else {
    assert.ok(!sameRow && US.y >= UK.bottom - 1, `when buttons make the short pair too wide, intact locale groups wrap: ${JSON.stringify(state)}`);
  }
  for (const row of state.rows) {
    assert.ok(row.x >= state.wrapper.x - 1 && row.right <= state.wrapper.right + 1, 'locale stays inside IPA wrapper');
    assert.equal(row.lines.length, 1, `selected ${row.locale} value fits a single intact text row`);
    assert.ok(row.lines[0].x >= state.wrapper.x - 1 && row.lines[0].right <= state.wrapper.right + 1,
      'actual shaped IPA text never overflows horizontally');
  }
  return state;
}

async function capture(page, name) {
  if (!screenshots) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, `${name.replace(/[^a-z0-9_-]/gi, '-')}.png`), fullPage: false });
}
async function withCase(name, spec, options, test) {
  const fixture = await fresh(spec, options);
  try {
    await test(fixture);
    await fixture.finish();
    results.push({ name, ...spec, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    await capture(fixture.page, `FAIL-${name}`).catch(() => {});
    throw new Error(`${name}: ${error.message}`, { cause: error });
  } finally { options?.gate?.release(); await fixture.context.close(); }
}

async function ordinary(spec) {
  const name = `${spec.width}x${spec.height}-${spec.locale}-${spec.theme}-${spec.scale}`;
  await withCase(name, spec, {}, async ({ page }) => {
    for (const word of ['bath', 'does', 'book', 'bow', 'use', UNKNOWN, 'the', 'takin']) {
      await position(page, anchor(page, word));
      const probe = await stability(page);
      try {
        await open(page, word, { reposition: false });
        await probe.check(`${word} open`);
        const before = await effects(page);
        if (word === UNKNOWN) {
          await status(page, 'missing', word);
          assert.equal(await page.locator('[data-word-save]').isEnabled(), false, 'unknown remains unsaveable');
        } else {
          await checkReadings(page, word, { probe });
          if (word === 'bath') await ipaArrangement(page, 'auto');
          if (word === 'the') {
            assert.equal(await page.locator('[data-part="no-meaning"]').count(), 0, 'easy word retains its easy card state');
            assert.ok((await page.locator('[data-word-pos]').innerText()).trim(), 'easy status remains localized and visible');
          }
          if (word === 'takin') {
            assert.equal(await page.locator('[data-part="no-meaning"]').count(), 1, 'IPA is independent of a missing glossary meaning');
            assert.equal(await page.locator('[data-word-save]').isEnabled(), false, 'no-glossary IPA hit stays unsaveable');
          }
        }
        await probe.check(`${word} async completion`);
        assert.deepEqual(await effects(page), before, 'async IPA lookup adds no audio/save');
        if (word === 'bath') {
          await accentPlay(page, 'UK', word, 'pointer', { probe });
          await status(page, 'ready', word);
          await probe.check('word mode exposes only intended accent playback');
        }
        await chromeGeometry(page);
        if (word === 'bow') {
          // Pronunciation stays in the explanation scroller, never the outer
          // sheet. Scroll ONLY the body and recheck persistent chrome/reader.
          const body = page.locator('[data-word-body]');
          const scroll = await body.evaluate(el => {
            el.scrollTop = el.scrollHeight;
            return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
          });
          assert.ok(Math.abs(scroll.top - Math.max(0, scroll.max)) <= 1, 'all explanation content is reachable in the body scroller');
          await settle(page);
          await chromeGeometry(page);
          await probe.check('IPA explanation body scroll');
          await body.evaluate(el => { el.scrollTop = 0; });
          await capture(page, name);
        }
        await close(page);
        await probe.check(`${word} close`);
      } finally { await probe.stop(); }
    }
    // A surface form belongs to the BOOK card: IPA must not query "books".
    await position(page, anchor(page, 'books'));
    const probe = await stability(page);
    try {
      await open(page, 'books', { key: 'book', reposition: false });
      await checkReadings(page, 'book', { probe });
      await probe.check('surface books -> displayed book');
      await close(page);
      await probe.check('surface form close');
    } finally { await probe.stop(); }
    // Exact "does" is a stored glossary headword. IPA never stems it to do.
    await open(page, 'does');
    await checkReadings(page, 'does');
    await close(page);
  });
}

async function accentPlay(page, locale, word, activation = 'pointer', { failure = false, probe } = {}) {
  const button = page.locator(`${ipaSelector} [data-speak-accent="${locale}"]`);
  await exposeBody(page, button);
  const before = await effects(page);
  if (activation === 'pointer') await tap(page, button);
  else {
    await button.evaluate(el => el.focus({ preventScroll: true }));
    await page.keyboard.press(activation);
  }
  if (failure) {
    await button.locator('xpath=..').locator('[data-speak-error][role="status"]').filter({ hasText: /\S/ }).waitFor();
    assert.equal(await button.getAttribute('data-speak-status'), 'failed', 'failed accent request is exposed on its own button');
  } else {
    await page.waitForFunction(count => window.__ipaEffects.audios.length > count, before.audios.length);
    await page.waitForFunction(el => ['started', 'idle'].includes(el?.dataset.speakStatus), await button.elementHandle());
    assert.equal(await button.locator('xpath=..').locator('[data-speak-error]').count(), 0, 'successful request clears its own stale feedback');
  }
  await settle(page, 5);
  const after = await effects(page);
  const audio = after.audios.slice(before.audios.length);
  assert.equal(audio.length, 1, 'explicit accent makes exactly one direct audio attempt');
  const url = new URL(audio[0].src);
  assert.equal(url.hostname, 'uapis.cn');
  assert.equal(url.pathname, '/api/v1/dictionary/audio');
  assert.equal(url.searchParams.get('word'), word);
  assert.equal(url.searchParams.get('accent'), locale.toLowerCase());
  assert.deepEqual(after.voiceRecords, before.voiceRecords, 'explicit accent does not use SpeechSynthesis');
  assert.deepEqual(after.voices, before.voices, 'explicit accent does not queue browser speech');
  assert.deepEqual(after.words, before.words, 'accent controls never save words');
  assert.equal(await page.locator(`${cardSelector} h2`).innerText(), word, 'accent activation never switches the lookup target');
  await chromeGeometry(page);
  if (failure) {
    const error = page.locator(`${ipaSelector} [data-ipa-locale="${locale}"] [data-speak-error]`);
    await exposeBody(page, error);
    assert.ok(await error.isVisible(), 'failure feedback is visibly readable after internal body scroll');
    assert.ok((await error.innerText()).trim());
  }
  await probe?.check(`${locale} ${activation} playback${failure ? ' failure feedback' : ''}`);
}

async function playback(spec) {
  await withCase(`accent-playback-${spec.width}-${spec.locale}`, spec, {}, async ({ page }) => {
    await position(page, anchor(page, 'bath'));
    const probe = await stability(page);
    try {
      await open(page, 'bath', { reposition: false });
      await checkReadings(page, 'bath', { probe });
      for (const locale of ['UK', 'US']) for (const activation of ['pointer', 'Enter', 'Space']) {
        await accentPlay(page, locale, 'bath', activation, { probe });
      }
      await page.evaluate(() => { window.__ipaPlayback.audio = 'reject'; });
      for (const locale of ['UK', 'US']) await accentPlay(page, locale, 'bath', 'pointer', { failure: true, probe });
      await capture(page, `accent-error-${spec.width}-${spec.locale}`);
      await page.evaluate(() => { window.__ipaPlayback.audio = 'success'; });
      for (const locale of ['UK', 'US']) await accentPlay(page, locale, 'bath', 'pointer', { probe });
      await capture(page, `accent-playback-${spec.width}-${spec.locale}`);
      await close(page);
      await probe.check('accent playback close');
    } finally { await probe.stop(); }
    await open(page, 'takin');
    await checkReadings(page, 'takin');
    await accentPlay(page, 'UK', 'takin');
    assert.equal(await page.locator(`${ipaSelector} [data-speak-accent="US"]`).count(), 0, 'single-accent word has no fabricated US control');
    await close(page);
  });
}

async function buttonGestureExclusion() {
  const spec = { width: 375, height: 667, locale: 'en', theme: 'light', scale: 100 };
  await withCase('accent-button-trusted-touch-exclusion', spec, {}, async ({ page }) => {
    await position(page, anchor(page, 'bath'));
    const probe = await stability(page);
    const cdp = await page.context().newCDPSession(page);
    try {
      await open(page, 'bath', { reposition: false });
      await checkReadings(page, 'bath', { probe });
      for (const locale of ['UK', 'US']) {
        const button = page.locator(`${ipaSelector} [data-speak-accent="${locale}"]`);
        // The fixture's short primary lets both buttons be naturally exposed at
        // body scroll0; this tests interactive exclusion, not ancestor scrolllock.
        await page.locator('[data-word-body]').evaluate(el => { el.scrollTop = 0; });
        await settle(page);
        const box = await button.boundingBox();
        const origin = { x: box.x + box.width / 2, y: box.y + 5 };
        assert.ok(await button.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), origin));
        const before = await effects(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 1 }] });
        for (const dy of [2, 4, 6, 10, 25, 50, 75, 100]) {
          assert.ok(origin.y + dy < spec.height, 'trusted touch path stays in viewport');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x, y: origin.y + dy, id: 1 }] });
          await page.waitForTimeout(30);
          assert.ok(await page.locator(cardSelector).evaluate(el => Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42) < 1),
            'button-origin trusted drag never translates the sheet');
          await probe.check(`${locale} button-origin trusted move`);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(260);
        assert.equal(await page.locator(cardSelector).count(), 1, 'button-origin downward gesture never dismisses the sheet');
        assert.deepEqual(await effects(page), before, 'button drag is not a click and produces no audio/save');
        await chromeGeometry(page);
      }
      await close(page);
      await probe.check('button exclusion close');
    } finally { await cdp.detach(); await probe.stop(); }
  });
}

async function inlineAndWrap(spec) {
  // Buttons add88px to the pair. A medium real IPA now wraps in every target
  // card while each locale still fits individually; extreme words may wrap
  // within a locale and are not forced to be intact by this selected fixture.
  const longWord = 'university';
  await withCase(`ipa-inline-wrap-${spec.width}-${spec.locale}`, spec, { layoutWord: longWord }, async ({ page }) => {
    for (const [word, mode] of [['bath', 'inline'], [longWord, 'wrapped']]) {
      await position(page, anchor(page, word));
      const probe = await stability(page);
      try {
        await open(page, word, { reposition: false });
        const before = await effects(page);
        await checkReadings(page, word, { probe });
        await ipaArrangement(page, word === 'bath' ? 'auto' : mode);
        await exposeBody(page, page.locator(`${ipaSelector} .word-ipa-values`));
        if (spec.width === 1280 && word === 'bath') await ipaArrangement(page, 'inline');
        await chromeGeometry(page);
        await probe.check(`${word} measured ${mode}`);
        assert.deepEqual(await effects(page), before, 'layout measurement adds no audio/save');
        await capture(page, `ipa-${mode}-${spec.width}-${spec.locale}`);
        await close(page);
        await probe.check(`${word} ${mode} close`);
      } finally { await probe.stop(); }
    }
  });
}

const raceSpec = { width: 1280, height: 800, locale: 'en', theme: 'light', scale: 100 };
async function delayedAndSwitch() {
  const gate = shardGate();
  await withCase('actual-delayed-shard-quick-switch', raceSpec, { gate }, async ({ page }) => {
    await position(page, anchor(page, 'bath'));
    const probe = await stability(page);
    try {
      await open(page, 'bath', { reposition: false });
      await waitGate(page, gate);
      await status(page, 'loading', 'bath');
      await chromeGeometry(page);
      await probe.check('actual bath shard held');
      // A desktop reader tap replaces the open card directly. No intermediate
      // close or awaited IPA completion can conceal a stale-target race.
      await open(page, 'book', { reposition: false });
      await status(page, 'loading', 'book');
      assert.equal(gate.requests.length, 1, 'bath -> book shares the pending real b import');
      await probe.check('same-shard pending bath -> book');
      await open(page, 'does', { reposition: false });
      await checkReadings(page, 'does');
      const before = await effects(page);
      gate.release();
      await settle(page, 12);
      await checkReadings(page, 'does');
      assert.deepEqual(await effects(page), before, 'late bath result adds no sound/save');
      await probe.check('late bath cannot replace current does');
      await close(page);
      // Same-letter race bath -> book reuses exactly the one actual b request.
      await open(page, 'book', { reposition: false });
      await checkReadings(page, 'book');
      await probe.check('book after stale bath');
      await close(page);
      await probe.check('quick switches close');
      assert.equal(gate.requests.length, 1, 'one actual b import is shared and cached');
    } finally { await probe.stop(); }
  });
}
async function closeReopen() {
  const gate = shardGate();
  await withCase('close-pending-reopen-real-cache', raceSpec, { gate }, async ({ page }) => {
    await position(page, anchor(page, 'bath'));
    const probe = await stability(page);
    try {
      await open(page, 'bath', { reposition: false });
      await waitGate(page, gate);
      await close(page);
      const before = await effects(page);
      gate.release();
      await settle(page, 12);
      assert.equal(await page.locator(cardSelector).count(), 0, 'late lookup cannot resurrect a closed card');
      assert.deepEqual(await effects(page), before);
      await probe.check('late completion after close');
      await open(page, 'bath', { reposition: false });
      await checkReadings(page, 'bath');
      await close(page);
      await probe.check('close/reopen cache');
      assert.equal(gate.requests.length, 1, 'reopen uses actual cached shard');
    } finally { await probe.stop(); }
  });
}
async function phraseRoundTrip(spec) {
  const gate = shardGate();
  await withCase(`phrase-hide-resume-${spec.width}-${spec.locale}`, spec, { gate, phrases: true }, async ({ page }) => {
    await position(page, anchor(page, 'bath', true));
    const probe = await stability(page);
    try {
      await page.evaluate(() => { window.__ipaPhraseGate.armed = true; });
      const before = await effects(page);
      await tap(page, anchor(page, 'bath', true));
      const card = page.locator(cardSelector);
      await card.waitFor({ state: 'visible' });
      await page.waitForFunction(() => window.__ipaPhraseGate.hits > 0);
      await settle(page);
      assert.equal(await page.locator(ipaSelector).count(), 0, 'word IPA is unmounted while phrasePending is genuinely held');
      assert.equal(await card.locator('[data-word-header] [data-speak]').count(), 0,
        'unresolved word/phrase target has no redundant header playback control');
      assert.equal(gate.requests.length, 0, 'phrasePending performs no IPA shard lookup');
      await probe.check('actual phrase promise pending');
      await page.evaluate(() => window.__ipaPhraseGate.release());
      await card.locator('[data-look-target="word"]').waitFor();
      assert.equal(await card.locator('h2').innerText(), PHRASE);
      await assertOneAudio(page, before, PHRASE);
      assert.equal(await page.locator(ipaSelector).count(), 0, 'phrase mode has no word IPA');
      const generic = card.locator('[data-word-header] [data-speak]');
      assert.equal(await generic.count(), 1, 'phrase mode retains exactly one generic header speak control');
      assert.equal(await generic.getAttribute('data-speak-accent'), null, 'phrase header retains generic pronunciation policy');
      assert.equal(await card.locator('[data-speak-accent]').count(), 0, 'phrase mode never shows word accent controls');
      const spokenBefore = await effects(page);
      await tap(page, generic);
      await assertOneAudio(page, spokenBefore, PHRASE);
      await probe.check('phrase generic playback preserves reader layout');
      const silent = await effects(page);
      await tap(page, card.locator('[data-look-target="word"]'));
      await waitGate(page, gate);
      await status(page, 'loading', 'bath');
      await probe.check('word target actual shard pending');
      await tap(page, card.locator('[data-look-target="phrase"]'));
      assert.equal(await page.locator(ipaSelector).count(), 0, 'word -> phrase hides IPA even during loading');
      gate.release();
      await settle(page, 12);
      assert.equal(await page.locator(ipaSelector).count(), 0, 'late word response stays hidden in phrase mode');
      assert.equal(await card.locator('h2').innerText(), PHRASE);
      assert.equal(await generic.count(), 1, 'word -> phrase restores the generic header speak control');
      await tap(page, card.locator('[data-look-target="word"]'));
      await checkReadings(page, 'bath', { probe });
      assert.deepEqual(await effects(page), silent, 'phrase/word switches and late IPA add no audio/save');
      await probe.check('phrase -> word ready resumes');
      await tap(page, card.locator('[data-look-target="phrase"]'));
      assert.equal(await page.locator(ipaSelector).count(), 0);
      assert.equal(await generic.count(), 1, 'ready word -> phrase restores the generic header speak control');
      await chromeGeometry(page);
      await close(page);
      await probe.check('phrase close');
      await open(page, 'bath', { key: PHRASE, phrase: true, reposition: false });
      assert.equal(await page.locator(ipaSelector).count(), 0, 'reopen resets phrase mode without stale word IPA');
      assert.equal(await generic.count(), 1, 'reopened phrase retains its generic header playback');
      await close(page);
      await probe.check('phrase reopen close');
      assert.equal(gate.requests.length, 1);
    } finally {
      await page.evaluate(() => window.__ipaPhraseGate.release());
      await probe.stop();
    }
  });
}
async function negative(fault) {
  const gate = shardGate('b', fault);
  await withCase(`${fault}-actual-shard-resource`, raceSpec, { gate }, async ({ page }) => {
    await position(page, anchor(page, 'bath'));
    const probe = await stability(page);
    try {
      await open(page, 'bath', { reposition: false });
      await waitGate(page, gate);
      const before = await effects(page);
      gate.release();
      await status(page, 'error', 'bath');
      await chromeGeometry(page);
      assert.deepEqual(await effects(page), before, 'shard error adds no audio/save');
      await probe.check(`${fault} async error`);
      await close(page);
      // Remove the synthetic fault. Optional pronunciation data is fetched as
      // JSON so a rejected module/namespace cannot permanently poison retries.
      gate.recover();
      await open(page, 'bath', { reposition: false });
      await page.waitForFunction(selector => {
        const node = document.querySelector(selector);
        return node && node.dataset.ipaStatus !== 'loading';
      }, ipaSelector);
      const retryStatus = await page.locator(ipaSelector).getAttribute('data-ipa-status');
      console.log(`INFO ${fault}: reopened after fault removed -> ${retryStatus}; resource requests ${gate.requests.length}`);
      assert.equal(retryStatus, 'ready', 'reopening after fault removal retries the actual JSON shard successfully');
      assert.equal(gate.requests.length, 2, 'failed/malformed JSON was evicted and requested again exactly once');
      await checkReadings(page, 'bath');
      await chromeGeometry(page);
      await probe.check(`${fault} reopen after network recovery`);
      await close(page);
      await open(page, 'does', { reposition: false });
      await checkReadings(page, 'does');
      await probe.check(`${fault} does not poison unrelated shard`);
      await close(page);
      await probe.check(`${fault} close`);
    } finally { await probe.stop(); }
  });
}

try {
  const viewports = [[1280, 800], [820, 1100], [375, 667], [320, 568], [667, 375]];
  const themes = ['light', 'dark', 'sepia'];
  const matrix = [];
  for (const [width, height] of viewports) for (const locale of ['en', 'zh']) for (let t = 0; t < themes.length; t++) {
    const scales = process.env.IPA_FULL_MATRIX === '1' ? [100, 125, 150] : [[100, 125, 150][(t + (locale === 'zh' ? 1 : 0)) % 3]];
    for (const scale of scales) {
      if (process.env.IPA_VIEWPORT && process.env.IPA_VIEWPORT !== `${width}x${height}`) continue;
      if (process.env.IPA_LOCALE && process.env.IPA_LOCALE !== locale) continue;
      matrix.push({ width, height, locale, theme: themes[t], scale });
    }
  }
  assert.ok(matrix.length, 'IPA_VIEWPORT/IPA_LOCALE filters matched no cases');
  console.log(`Real IPA oracle ${oracle.manifest.version}: ${oracle.words.size} words; ${matrix.length} matrix cases${process.env.IPA_VIEWPORT || process.env.IPA_LOCALE ? ' (filtered)' : ''}`);
  const failures = [];
  const run = async (name, test) => {
    try { await test(); }
    catch (error) {
      if (process.env.IPA_CONTINUE !== '1') throw error;
      failures.push({ name, error: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
    }
  };
  if (process.env.IPA_ONLY_RACES === '1' || process.env.IPA_ONLY_LAYOUT === '1' || process.env.IPA_ONLY_PLAYBACK === '1') console.log('SKIP viewport matrix (targeted subrun)');
  else for (const spec of matrix) await run(`${spec.width}x${spec.height}-${spec.locale}-${spec.theme}-${spec.scale}`, () => ordinary(spec));
  if (process.env.IPA_ONLY_RACES !== '1' && process.env.IPA_ONLY_PLAYBACK !== '1') {
    for (const [width, height] of [[1280, 800], [820, 1100], [375, 667], [320, 568]]) for (const locale of ['en', 'zh']) {
      if (process.env.IPA_VIEWPORT && process.env.IPA_VIEWPORT !== `${width}x${height}`) continue;
      if (process.env.IPA_LOCALE && process.env.IPA_LOCALE !== locale) continue;
      const spec = { width, height, locale, theme: 'light', scale: 100 };
      await run(`ipa-inline-wrap-${width}-${locale}`, () => inlineAndWrap(spec));
    }
  }
  if (process.env.IPA_SKIP_RACES !== '1' && process.env.IPA_ONLY_LAYOUT !== '1' && process.env.IPA_ONLY_PLAYBACK !== '1') {
    await run('actual-delayed-shard-quick-switch', delayedAndSwitch);
    await run('close-pending-reopen-real-cache', closeReopen);
    await run('phrase-desktop', () => phraseRoundTrip(raceSpec));
    await run('phrase-phone', () => phraseRoundTrip({ width: 320, height: 568, locale: 'zh', theme: 'sepia', scale: 150 }));
    await run('malformed-actual-shard-resource', () => negative('malformed'));
    await run('failed-actual-shard-resource', () => negative('failed'));
  } else console.log('SKIP races/phrase/error cases (targeted layout or IPA_SKIP_RACES=1)');
  if (process.env.IPA_ONLY_RACES !== '1' && process.env.IPA_ONLY_LAYOUT !== '1') {
    for (const [width, height, locale] of [[1280, 800, 'en'], [375, 667, 'zh'], [320, 568, 'en']]) {
      const spec = { width, height, locale, theme: 'light', scale: 100 };
      await run(`accent-playback-${width}-${locale}`, () => playback(spec));
    }
    await run('accent-button-trusted-touch-exclusion', buttonGestureExclusion);
  }
  await mkdir(SHOT_DIR, { recursive: true });
  await writeFile(resolve(SHOT_DIR, 'word-ipa-e2e.json'), JSON.stringify({
    base: BASE.href, version: oracle.manifest.version, hashes: oracle.hashes, sourceHashes,
    filtered: Boolean(process.env.IPA_VIEWPORT || process.env.IPA_LOCALE || process.env.IPA_ONLY_RACES === '1' || process.env.IPA_ONLY_LAYOUT === '1' || process.env.IPA_ONLY_PLAYBACK === '1'),
    races: process.env.IPA_SKIP_RACES === '1' || process.env.IPA_ONLY_LAYOUT === '1' || process.env.IPA_ONLY_PLAYBACK === '1' ? 'skipped' : failures.some(item => /(?:phrase|shard|pending)/.test(item.name)) ? 'failed' : 'passed',
    screenshots, policy: 'one accepted UK/US reading and intended accent playback button per available locale; no alternative readings', results, failures,
  }, null, 2) + '\n');
  console.log(`${failures.length ? 'FAIL' : 'PASS'} ${results.length} passed IPA cases, ${failures.length} failed; proof ${resolve(SHOT_DIR, 'word-ipa-e2e.json')}`);
  assert.equal(failures.length, 0, `IPA regression failures: ${failures.map(item => item.name).join(', ')}`);
} finally { await browser.close(); }
