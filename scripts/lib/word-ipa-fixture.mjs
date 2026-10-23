import assert from 'node:assert/strict';

export const BOOK = 'ipa-word-card-regression';
export const PHRASE = 'bath time';
export const UNKNOWN = 'quuxstone';
export const LONG_IPA = 'psychoneuroimmunology';
export const ANCHOR_INDEX = 10;
export const cardSelector = '[data-word-card]';
export const ipaSelector = '[data-word-ipa]';

export async function settle(page, frames = 5) {
  await page.evaluate(count => new Promise(resolve => {
    const tick = () => --count ? requestAnimationFrame(tick) : resolve();
    requestAnimationFrame(tick);
  }), frames);
}

// Install before app code in a new, nonpersistent browser context. Nothing here
// reads the user's browser profile, existing books, or existing saved words.
// Explicit UK/US playback uses one direct uapis recording for the requested accent.
// Every recording comes from uapis: generic playback tries US, then UK; explicit controls ask for one accent.
// Recording and synthesis attempts are captured without real sound/network use.
export async function installRecorders(context) {
  await context.addInitScript(({ phrase }) => {
    const effects = { audios: [], voices: [], voiceRecords: [] };
    window.__ipaEffects = effects;
    window.__ipaPlayback = { audio: 'success', voices: [
      { name: 'Synthetic UK', lang: 'en_GB', default: false, localService: true, voiceURI: 'fixture-uk' },
      { name: 'Synthetic US', lang: 'en-US', default: false, localService: true, voiceURI: 'fixture-us' },
    ], tts: 'success' };
    // Keep native preloads out of the mock: an aborted remote preload emits an
    // error after a resolved play promise and would invalidate synthetic success.
    const sources = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return sources.get(this) || ''; },
      set(value) {
        const url = new URL(value, location.href).href;
        sources.set(this, url);
      },
    });
    HTMLMediaElement.prototype.play = function () {
      const record = { src: this.src || this.getAttribute('src') || '', attached: this.isConnected, playing: false };
      effects.audios.push(record);
      if (window.__ipaPlayback.audio === 'reject') return Promise.reject(new Error('Synthetic recording unavailable'));
      if (window.__ipaPlayback.audio === 'never') return new Promise(() => {});
      record.playing = true;
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      const record = effects.audios.find(item => item.src === this.src);
      if (record) record.playing = false;
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const ttsTimers = new Set();
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false, pending: false, speaking: false,
      getVoices: () => window.__ipaPlayback.voices,
      cancel() { for (const timer of ttsTimers) clearTimeout(timer); ttsTimers.clear(); },
      resume() {},
      speak(utterance) {
        effects.voices.push(utterance.text);
        effects.voiceRecords.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.lang ?? null });
        const timer = setTimeout(() => {
          ttsTimers.delete(timer);
          if (window.__ipaPlayback.tts === 'error') utterance.onerror?.({ error: 'synthesis-failed' });
          else { utterance.onstart?.({}); utterance.onend?.({}); }
        }, 10);
        ttsTimers.add(timer);
      },
    } });

    // Narrowly delay the reader's actual resolved findPhrase result, not its
    // contents and not IPA data. extrasOf is already cached when the chapter is
    // linked, so an HTTP or IndexedDB delay cannot reliably hold phrasePending.
    // The gate is opt-in after page boot and proves the exact result was seen.
    const then = Promise.prototype.then;
    const gate = { armed: false, hits: 0, releases: [] };
    window.__ipaPhraseGate = gate;
    gate.release = () => {
      gate.armed = false;
      for (const release of gate.releases.splice(0)) release();
    };
    Promise.prototype.then = function (fulfilled, rejected) {
      if (typeof fulfilled !== 'function') return then.call(this, fulfilled, rejected);
      return then.call(this, value => {
        if (gate.armed && value?.key === phrase && value?.entry && typeof value.matched === 'string') {
          gate.hits++;
          return new Promise(resolve => gate.releases.push(resolve)).then(() => fulfilled(value));
        }
        return fulfilled(value);
      }, rejected);
    };
  }, { phrase: PHRASE });
}

export async function seed(page, { locale, theme, phrases = false, layoutWord = '' }) {
  await page.evaluate(async ({ id, locale, theme, phrase, phrases, unknown, layoutWord }) => {
    assertFresh();
    function assertFresh() {
      if (localStorage.getItem('cibian-notebook-v1')) throw new Error('Expected a fresh synthetic context');
    }
    const sentence = `bath does book bow use quuxstone books baths the takin${layoutWord ? ` ${layoutWord}` : ''}. A quiet bath time comes after a walk.`;
    const paragraphs = Array.from({ length: 34 }, (_, i) => `${sentence} Passage ${i + 1}. The reader rests beside the window and waits for a calm evening.`);
    const glossary = {
      bath: { pos: 'noun', meaning: 'Washing the body in water.', forms: ['baths'] },
      book: { pos: 'noun', meaning: 'Pages held together to read.', forms: ['books'] },
      bow: { pos: 'noun', meaning: 'A curved piece of wood with a string.', whyHard: 'One spelling has more than one pronunciation.' },
      does: { pos: 'verb', meaning: 'Performs an action.' },
      use: { pos: 'verb', meaning: 'To do something with an object.' },
      ...(layoutWord ? { [layoutWord]: { pos: 'noun', meaning: 'A scientific field studying connections within the body.' } } : {}),
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cibian-books', 3);
      request.onupgradeneeded = () => {
        for (const name of ['books', 'covers', 'notes']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['books', 'notes'], 'readwrite');
        const meta = { id, title: 'IPA word card regression', author: 'Synthetic fixture', glossary, pending: [], totalHard: Object.keys(glossary).length };
        tx.objectStore('books').put({ ...meta, chapters: [{ title: 'A quiet evening', paragraphs,
          html: paragraphs.map(text => `<p>${text}</p>`).join('') }] }, id);
        tx.objectStore('notes').put(meta, `gloss:${id}`);
        tx.objectStore('notes').put({ rev: '', source: 'custom', paragraphs: [], sentences: [],
          phrases: phrases ? { [phrase]: { pos: 'phrase', meaning: 'A time for washing in water.' } } : {} }, `extras:${id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Fixture transaction aborted'));
      });
    } finally { db.close(); }
    localStorage.setItem('cibian-notebook-v1', JSON.stringify({ version: 0, state: {
      books: [{ id, title: 'IPA word card regression', author: 'Synthetic fixture', source: 'epub', cloth: 'cloth', createdAt: 1 }],
      words: [], log: {},
    } }));
    localStorage.setItem('cibian-locale-v1', locale);
    localStorage.setItem('cibian-prefs-v1', JSON.stringify({ version: 0, state: {
      theme, font: 'literata', size: 20, leading: 1.8, width: 'medium', column: 39, focus: false, paging: false,
    } }));
    // This word is intentionally absent from both the glossary and the IPA oracle.
    if (glossary[unknown]) throw new Error('Unknown fixture must remain unknown');
  }, { id: BOOK, locale, theme, phrase: PHRASE, phrases, unknown: UNKNOWN, layoutWord });
}

export function anchor(page, word, phrase = false) {
  // Scope by paragraph rather than global token count: ordinary easy words can
  // occur elsewhere in the filler text. The explicit phrase is the second bath.
  return page.locator('article p').nth(ANCHOR_INDEX)
    .locator(`[role="button"][data-word="${word}"] .book-tap`).nth(word === 'bath' ? Number(phrase) : 0);
}

export async function position(page, locator) {
  await locator.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 120));
  await settle(page);
}

// Intentionally no locator.click()/tap(): their automatic scrolling can conceal
// the regression this script measures. Every control must already hit-test.
export async function tap(page, locator) {
  const point = await locator.evaluate(el => {
    const rects = [...el.getClientRects()];
    for (const r of rects) {
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && el.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  assert.ok(point, `Target is exposed without auto-scroll: ${await locator.evaluate(el => el.outerHTML.slice(0, 200))}`);
  if (page.viewportSize().width < 768) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function exposeBody(page, locator) {
  await locator.evaluate(el => {
    const body = el.closest('[data-word-body]');
    if (!body) throw new Error('Expected a word-body child');
    const r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) body.scrollTop += r.top - b.top;
  });
  await settle(page);
}

export async function effects(page) {
  return page.evaluate(() => ({
    ...window.__ipaEffects,
    audioSources: [...window.__ipaEffects.audios].map(audio => audio.src),
    words: JSON.parse(localStorage.getItem('cibian-notebook-v1')).state.words,
  }));
}

export async function assertOneAudio(page, before, expected) {
  await settle(page);
  const after = await effects(page);
  assert.deepEqual(after.words, before.words, 'opening never saves a word');
  assert.deepEqual(after.voices, before.voices, 'opening adds no fallback voice');
  const audio = after.audios.slice(before.audios.length);
  assert.equal(audio.length, 1, `exactly one unchanged recording for ${expected}`);
  const url = new URL(audio[0].src);
  assert.equal(url.hostname, 'uapis.cn');
  assert.equal(url.pathname, '/api/v1/dictionary/audio');
  assert.equal(url.searchParams.get('word'), expected);
  assert.equal(url.searchParams.get('accent'), 'us', 'American recording remains first for generic playback');
  assert.equal(audio[0].attached, true, 'audio element remains attached before playback');
  return after;
}

export async function finishAnimations(card) {
  await card.evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
    .map(a => a.finished.catch(() => {}))));
}

export async function close(page) {
  const card = page.locator(cardSelector);
  const before = await effects(page);
  await tap(page, card.locator('[data-panel-close]'));
  await card.waitFor({ state: 'detached' });
  await settle(page);
  assert.deepEqual(await effects(page), before, 'closing adds no audio or save');
}

export async function chromeGeometry(page) {
  const card = page.locator(cardSelector);
  await finishAnimations(card);
  const state = await card.evaluate(el => {
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const body = el.querySelector('[data-word-body]');
    const header = el.querySelector('[data-word-header]');
    const footer = el.querySelector('[data-word-footer]');
    const save = el.querySelector('[data-word-save]'), close = el.querySelector('[data-panel-close]');
    const title = el.querySelector('h2'), actions = save.closest('[data-word-actions]');
    const titleActions = { shared: !!actions && actions.contains(close), save: rect(save), close: rect(close), title: rect(title),
      header: header.contains(save) && header.contains(close) };
    const controls = [...el.querySelectorAll('[data-panel-close], [data-word-save], [data-word-header] [data-speak], [data-look-target], [data-lookup]')]
      .map(node => {
        const r = rect(node), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { ...r, name: node.getAttribute('aria-label') || node.dataset.lookup || node.dataset.lookTarget,
          hit: !!hit && node.contains(hit), named: !!(node.getAttribute('aria-label') || node.textContent.trim()) };
      });
    return { card: rect(el), header: rect(header), body: rect(body), footer: rect(footer), controls, titleActions,
      outerScroll: el.scrollTop, bodyOverflow: getComputedStyle(body).overflowY,
      bodyClientWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
      rootWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth,
      overflowNodes: [...document.querySelectorAll('body *')].filter(node => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && (r.left < -1 || r.right > document.documentElement.clientWidth + 1);
      }).slice(0, 12).map(node => ({ tag: node.tagName, class: node.className?.baseVal ?? node.className,
        part: node.getAttribute('data-part'), word: node.getAttribute('data-word'), text: node.textContent.slice(0, 50), ...rect(node) })),
      width: innerWidth, height: innerHeight };
  });
  assert.ok(state.titleActions.shared && state.titleActions.header, 'save and close share the persistent title actions');
  assert.ok(state.titleActions.save.right <= state.titleActions.close.x + 1,
    'save sits immediately beside and before close');
  for (const button of [state.titleActions.save, state.titleActions.close]) {
    assert.ok(button.y < state.titleActions.title.bottom && button.bottom > state.titleActions.title.y,
      'save and close remain on the title row');
  }
  assert.equal(state.outerScroll, 0, 'outer word card never scrolls');
  assert.equal(state.bodyOverflow, 'auto', 'explanation body owns scrolling');
  assert.ok(state.body.height > 0, `body retains usable space: ${JSON.stringify({ word: await card.locator('h2').innerText(), card: state.card, header: state.header, body: state.body, footer: state.footer })}`);
  assert.ok(state.bodyScrollWidth <= state.bodyClientWidth + 1, 'no horizontal body overflow');
  assert.ok(state.rootScrollWidth <= state.rootWidth + 1, `no horizontal page overflow: ${JSON.stringify({ word: await card.locator('h2').innerText(), viewport: state.width, rootWidth: state.rootWidth, rootScrollWidth: state.rootScrollWidth, nodes: state.overflowNodes })}`);
  assert.ok(state.card.x >= -1 && state.card.right <= state.width + 1 && state.card.y >= -1 && state.card.bottom <= state.height + 1,
    `card remains inside viewport: ${JSON.stringify(state)}`);
  for (const part of [state.header, state.body, state.footer]) {
    assert.ok(part.height > 0 && part.y >= state.card.y - 1 && part.bottom <= state.card.bottom + 1,
      'header/body/footer remain within card');
  }
  assert.ok(state.header.bottom <= state.body.y + 1 && state.body.bottom <= state.footer.y + 1,
    'body does not overlap persistent header/footer');
  for (const control of state.controls) {
    assert.ok(control.named, 'persistent controls have accessible names');
    assert.ok(control.x >= 0 && control.right <= state.width + 1 && control.y >= 0 && control.bottom <= state.height + 1 && control.hit,
      `persistent control reachable without scrolling: ${JSON.stringify(control)}`);
  }
  return state;
}

// Start BEFORE opening the overlay. Observe recent-input shifts as well as CLS;
// sample geometry every animation frame so transient async shifts cannot vanish
// before an after-only comparison. Only text-bearing reader sources are counted.
export async function stability(page) {
  // Establish the baseline only after pre-open font/layout work has settled.
  // This does NOT reset or tolerate any movement after the card is opened.
  // Root-font stress can start a new font load after the first fonts.ready.
  await page.evaluate(async () => {
    if (document.querySelector('[data-word-card]')) throw new Error('Layout probe must start before opening a card');
    await document.fonts.ready;
    let previous = '', identical = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const article = document.querySelector('article');
      const box = article.getBoundingClientRect();
      const root = document.documentElement;
      const current = JSON.stringify([box.x, box.y, box.width, box.height, scrollX, scrollY,
        root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight,
        ...[...article.querySelectorAll('p')].slice(9, 12).map(node => {
          const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        })]);
      identical = current === previous ? identical + 1 : 0;
      previous = current;
      if (identical >= 12) return;
    }
    throw new Error('Reader did not settle before opening the IPA card');
  });
  await page.evaluate(({ index }) => {
    const article = document.querySelector('article');
    const paragraphs = article.querySelectorAll('p');
    const nodes = [article, ...[index - 1, index, index + 1].map(i => paragraphs[i]),
      ...['bath', 'does', 'book', 'bow', 'use'].map(word => paragraphs[index].querySelector(`[data-word="${word}"]`))];
    if (nodes.some(node => !node)) throw new Error('Missing synthetic layout probe anchors');
    const rect = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    const snapshot = () => {
      const root = document.documentElement, body = document.body;
      return { boxes: nodes.map(rect), fragments: nodes.slice(-5).map(node => [...node.getClientRects()].map(r => [r.x, r.y, r.width, r.height])),
        window: [scrollX, scrollY, innerWidth, innerHeight],
        document: [root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight, root.scrollLeft, root.scrollTop,
          body.clientWidth, body.clientHeight, body.scrollWidth, body.scrollHeight, body.scrollLeft, body.scrollTop],
        visual: window.visualViewport ? [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.width, visualViewport.height, visualViewport.scale] : null };
    };
    const baseline = snapshot(), changes = [], shifts = [];
    const sample = () => {
      const current = snapshot();
      if (JSON.stringify(current) !== JSON.stringify(baseline) && changes.length < 4) changes.push(current);
    };
    let frame, stopped = false;
    const tick = () => { if (!stopped) { sample(); frame = requestAnimationFrame(tick); } };
    frame = requestAnimationFrame(tick);
    const collect = entries => {
      for (const entry of entries) {
        const sources = (entry.sources ?? []).filter(source => source.node && article.contains(source.node)
          && (source.node.nodeType === Node.TEXT_NODE || source.node.textContent?.trim()));
        if (sources.length) shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput,
          sources: sources.map(source => ({ text: source.node.textContent.slice(0, 70),
            before: [source.previousRect.x, source.previousRect.y, source.previousRect.width, source.previousRect.height],
            after: [source.currentRect.x, source.currentRect.y, source.currentRect.width, source.currentRect.height] })) });
      }
    };
    let observer;
    if (PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
      observer = new PerformanceObserver(list => collect(list.getEntries()));
      observer.observe({ type: 'layout-shift', buffered: false });
    }
    window.__ipaLayoutProbe = {
      read() { sample(); if (observer) collect(observer.takeRecords()); return { baseline, current: snapshot(), changes: [...changes], shifts: [...shifts] }; },
      stop() { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); },
    };
  }, { index: ANCHOR_INDEX });
  return {
    async check(label) {
      const state = await page.evaluate(() => window.__ipaLayoutProbe.read());
      assert.deepEqual(state.shifts, [], `${label}: no text-bearing reader shifts, including recent-input shifts`);
      const differences = [];
      const diff = (before, after, path = '') => {
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        if (Array.isArray(before) && Array.isArray(after)) {
          for (let i = 0; i < Math.max(before.length, after.length); i++) diff(before[i], after[i], `${path}[${i}]`);
        } else if (before && after && typeof before === 'object' && typeof after === 'object') {
          for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[key], after[key], path ? `${path}.${key}` : key);
        } else differences.push({ path, baseline: before, actual: after });
      };
      diff(state.baseline, state.changes[0] ?? state.current);
      assert.equal(state.changes.length, 0, `${label}: reader/paragraph/anchor/document/scroll geometry stable in every frame; first diff ${JSON.stringify(differences.slice(0, 16))}`);
      assert.deepEqual(state.current, state.baseline, `${label}: reader geometry stays at pre-open baseline`);
    },
    async stop() {
      if (!page.isClosed()) await page.evaluate(() => { window.__ipaLayoutProbe?.stop(); delete window.__ipaLayoutProbe; });
    },
  };
}
