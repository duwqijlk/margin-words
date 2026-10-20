// Synthetic IndexedDB fixture; run against an already-running app. No external lookups are opened.
// WORD_CARD_STRESS=1 runs dark, centered-anchor, 100/125/150% root-font desktop cases
// plus a tall-window expand/shrink case. Add STRESS_LONG_TITLE=1 for the long phrase fixture.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const desktopWidth = Number(process.env.EXPECT_DESKTOP_WIDTH ?? 384);
assert.ok([336, 384].includes(desktopWidth), "EXPECT_DESKTOP_WIDTH must be 336 or 384");
const stress = process.env.WORD_CARD_STRESS === '1';
const stressFailures = [];
const phrase = stress && process.env.STRESS_LONG_TITLE === '1'
  ? 'against all odds and despite every possible obstacle' : 'against all odds';
const longWord = 'pneumonoultramicroscopicsilicovolcanoconiosis';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const settle = (page) => page.evaluate(() => new Promise(resolve => {
  let frames = 5;
  const tick = () => --frames ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}));
async function position(page, anchor, y) {
  await anchor.evaluate((el, top) => window.scrollBy(0, el.getBoundingClientRect().top - top), y);
  await settle(page);
}
async function links(card, term) {
  const q = encodeURIComponent(term);
  const urls = { longman: `https://www.ldoceonline.com/search/english/direct/?q=${q}`,
    webster: `https://www.merriam-webster.com/dictionary/${q}`, images: `https://www.bing.com/images/search?q=${q}` };
  for (const [site, href] of Object.entries(urls)) {
    const link = card.locator(`[data-lookup="${site}"]`);
    assert.equal(await link.getAttribute("href"), href);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/);
  }
}
async function geometry(page, anchor, card, width, height, side, article) {
  const c = await card.boundingBox();
  const a = await anchor.boundingBox();
  assert.ok(c && a);
  assert.equal(c.width, width >= 1024 ? desktopWidth : width >= 768 ? 288 : width);
  assert.ok(c.x >= -1 && c.x + c.width <= width + 1 && c.y >= -1 && c.y + c.height <= height + 1, "card inside viewport");
  assert.ok(c.x + c.width <= a.x + 1 || c.x >= a.x + a.width - 1 || c.y + c.height <= a.y + 1 || c.y >= a.y + a.height - 1, "card does not cover anchor");
  if (width >= 1024) {
    assert.equal(await card.getAttribute("data-float"), "");
    assert.ok(side === "bottom" ? c.y >= a.y + a.height : c.y + c.height <= a.y, `actual ${side} placement`);
  } else {
    assert.equal(await card.getAttribute("data-float"), null);
    if (width < 768) assert.ok(Math.abs(c.y + c.height - height) <= 1, "phone bottom sheet");
  }
  assert.deepEqual(await page.locator("article").boundingBox(), article, "article geometry unchanged");
}
async function metrics(card) {
  return card.locator('[data-word-body]').evaluate(body => {
    const content = body.querySelector('[data-word-content]');
    return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop,
      contentHeight: content.getBoundingClientRect().height, maxScroll: body.scrollHeight - body.clientHeight };
  });
}
// No locator.click()/tap() on lookup controls: those auto-scroll and can hide this regression.
async function cardChrome(page, card) {
  const state = await card.evaluate(el => {
    const body = el.querySelector('[data-word-body]');
    const content = body.querySelector('[data-word-content]');
    const head = el.querySelector('[data-word-header]');
    const footer = el.querySelector('[data-word-footer]');
    const box = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    return { tag: el.tagName, display: getComputedStyle(el).display, direction: getComputedStyle(el).flexDirection,
      overflow: getComputedStyle(el).overflowY, bodyOverflow: getComputedStyle(body).overflowY,
      contentOverflow: getComputedStyle(content).overflowY, contentMaxHeight: getComputedStyle(content).maxHeight,
      contentScrollHeight: content.scrollHeight, contentClientHeight: content.clientHeight,
      card: box(el), body: box(body), content: box(content), head: box(head), footer: box(footer),
      scroll: [scrollX, scrollY, el.scrollTop, body.scrollTop],
      viewport: [innerWidth, innerHeight],
      controls: [...el.querySelectorAll('[data-lookup], [data-look-target], [data-panel-close]')].map(node => {
        const r = box(node);
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { ...r, hit: !!hit && node.contains(hit), name: node.dataset.lookup || node.dataset.lookTarget || 'close' };
      }) };
  });
  assert.equal(state.tag, 'ASIDE');
  assert.equal(state.display, 'flex', 'card uses flex layout at every width');
  assert.equal(state.direction, 'column', 'card stacks header/body/footer');
  assert.equal(state.overflow, 'hidden', 'card itself must not scroll');
  assert.equal(state.bodyOverflow, 'auto', 'only explanation body scrolls');
  assert.equal(state.contentOverflow, 'visible', 'natural-height content does not create another scroll container');
  assert.equal(state.contentMaxHeight, 'none', 'content height is not capped');
  assert.ok(state.contentClientHeight >= state.contentScrollHeight - 1, 'content grows to fit its children');
  assert.equal(state.scroll[2], 0, 'outer card stays at scrollTop zero');
  if (state.viewport[0] < 768) {
    assert.equal(state.card.width, state.viewport[0], 'phone sheet spans viewport');
    assert.ok(Math.abs(state.card.bottom - state.viewport[1]) <= 1, 'phone sheet stays bottom-aligned');
  }
  for (const [name, box] of [['header', state.head], ['body', state.body], ['footer', state.footer]]) {
    assert.ok(box.height > 0 && box.y >= state.card.y - 1 && box.bottom <= state.card.bottom + 1,
      `${name} fits inside sheet`);
    assert.ok(box.y >= 0 && box.bottom <= state.viewport[1] + 1, `${name} is in viewport`);
  }
  assert.ok(state.head.bottom <= state.body.y + 1 && state.body.bottom <= state.footer.y + 1,
    'scrolling body does not overlap persistent header/footer');
  for (const control of state.controls) {
    assert.ok(control.x >= 0 && control.right <= state.viewport[0] + 1 && control.y >= 0 && control.bottom <= state.viewport[1] + 1,
      `${control.name} fully visible before interaction`);
    assert.ok(control.hit, `${control.name} receives a center hit without scrolling`);
  }
  return state;
}
async function coordinateTap(page, locator) {
  const point = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: el.contains(document.elementFromPoint(x, y)) };
  });
  assert.ok(point.hit, 'tap target is already exposed (no automatic scroll)');
  if (page.viewportSize().width < 768) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await settle(page);
}
async function exposeInBody(card, locator) {
  await locator.evaluate(el => {
    const body = el.closest('[data-word-body]');
    body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
  });
}
async function collapsedDetails(card, isPhrase) {
  assert.equal(await card.locator('[data-part="word-alone"]').count(), isPhrase ? 1 : 0);
  for (const part of ['word-alone', 'sentence-box', 'word-more']) {
    const details = card.locator(`[data-part="${part}"]`);
    if (!await details.count()) continue;
    assert.equal(await details.evaluate(el => el.tagName), 'DETAILS', `${part} uses native details`);
    assert.equal(await details.getAttribute('open'), null, `${part} starts collapsed`);
    assert.equal(await details.locator(':scope > summary').count(), 1, `${part} has a direct summary`);
    assert.ok((await details.locator(':scope > summary').innerText()).trim(), `${part} has a readable summary`);
  }
  if (isPhrase) {
    assert.equal(await card.locator('[data-part="word-more"]').count(), 1, 'fixture supplies more information');
    assert.equal(await card.locator('[data-part="word-alone"] [data-part="word-meaning"]').isVisible(), false,
      'standalone definition is hidden until expanded');
  }
}
async function expandDisclosure(page, card, part, text) {
  const details = card.locator(`[data-part="${part}"]`);
  const summary = details.locator(':scope > summary');
  const before = await metrics(card);
  await exposeInBody(card, summary);
  await settle(page);
  await coordinateTap(page, summary);
  assert.equal(await details.getAttribute('open'), '', `${part} opens by pointer`);
  assert.ok((await details.innerText()).includes(text), `${part} expanded text is readable`);
  assert.ok((await metrics(card)).contentHeight > before.contentHeight, `${part} expands natural-height content`);
  await cardChrome(page, card);
  if (page.viewportSize().width >= 768) {
    assert.equal(await summary.evaluate(el => document.activeElement === el), true, 'clicked summary receives focus');
    await page.keyboard.press('Enter');
    assert.equal(await details.getAttribute('open'), null, 'Enter collapses focused summary');
    await page.keyboard.press('Space');
    assert.equal(await details.getAttribute('open'), '', 'Space expands focused summary');
    assert.equal(await summary.evaluate(el => document.activeElement === el), true, 'keyboard toggle preserves summary focus');
    await settle(page);
    await cardChrome(page, card);
  }
}
async function lookupTarget(card, mode) {
  assert.equal(await card.locator('[data-look-target-group]').getAttribute('role'), 'group');
  for (const target of ['word', 'phrase']) {
    const button = card.locator(`[data-look-target="${target}"]`);
    assert.equal(await button.evaluate(el => el.tagName), 'BUTTON');
    assert.notEqual(await button.getAttribute('role'), 'radio');
    assert.equal(await button.getAttribute('aria-checked'), null);
    assert.equal(await button.getAttribute('aria-pressed'), String(target === mode));
  }
}
async function phoneRegression(page, width, height) {
  const card = page.locator('[data-word-card]');
  const body = card.locator('[data-word-body]');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }],
  });
  const drag = async (dy, end = 'touchEnd') => {
    const r = await body.boundingBox();
    assert.ok(r && r.height > 24, 'body has room for a touch gesture');
    const x = r.x + r.width / 2;
    const y = dy > 0 ? r.y + 12 : r.y + r.height - 12;
    assert.ok(y + dy > 0 && y + dy < height, 'touch gesture stays in viewport');
    await touch('touchStart', x, y);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', x, y + dy * i / 6);
      await page.waitForTimeout(20);
    }
    if (end === 'touchCancel') {
      assert.ok(await card.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 > 72),
        'cancel test first pulls beyond the dismissal threshold');
    }
    await touch(end);
    // Dismissal uses a 160ms timer and snap-back a 180ms transition.
    await page.waitForTimeout(260);
  };
  const open = async word => {
    const anchor = page.locator(`article [role="button"][data-word="${word}"] .book-tap`).nth(10);
    await position(page, anchor, 120);
    await anchor.tap();
    await card.waitFor({ state: 'visible' });
    if (word === 'odds') await card.locator('[data-part="phrase-meaning"]').waitFor();
    await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
    await settle(page);
    return cardChrome(page, card);
  };
  assert.deepEqual(await page.evaluate(() => [matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints > 0]),
    [true, true], 'phone context really has mobile touch input');
  const initial = await open('odds');
  assert.equal(initial.scroll[3], 0, 'new word body starts at top');
  await collapsedDetails(card, true);
  await lookupTarget(card, 'phrase');
  await links(card, phrase);
  // Intercept only the navigation, not pointer hit testing. Do not contact lookup sites.
  await card.evaluate(el => {
    el.dataset.testLookupClicks = '0';
    el.addEventListener('click', event => {
      if (event.target.closest('[data-lookup]')) {
        event.preventDefault();
        el.dataset.testLookupClicks = String(Number(el.dataset.testLookupClicks) + 1);
      }
    }, true);
  });
  for (const site of ['longman', 'webster', 'images']) {
    await coordinateTap(page, card.locator(`[data-lookup="${site}"]`));
    assert.deepEqual((await cardChrome(page, card)).scroll, initial.scroll, 'lookup tap never scrolls reader, sheet or body');
  }
  assert.equal(await card.getAttribute('data-test-lookup-clicks'), '3', 'all external actions receive actual touch clicks');
  for (const mode of ['word', 'phrase']) {
    await coordinateTap(page, card.locator(`[data-look-target="${mode}"]`));
    await lookupTarget(card, mode);
    await links(card, mode === 'word' ? 'odds' : phrase);
    assert.deepEqual((await cardChrome(page, card)).scroll, initial.scroll, 'target toggle never auto-scrolls');
  }
  await expandDisclosure(page, card, 'word-alone', 'chances that something');
  assert.equal(await card.locator('[data-part="word-alone"] [data-part="word-meaning"]').isVisible(), true);
  await expandDisclosure(page, card, 'word-more', 'An abstract plural noun');
  const collapsed = await metrics(card);
  // Explicit internal scroll is allowed to reach the sentence; never scroll the outer sheet.
  await body.evaluate(el => {
    const summary = el.querySelector('[data-part="sentence-box"] summary');
    el.scrollTop += summary.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  await settle(page);
  await coordinateTap(page, card.locator('[data-part="sentence-box"] summary'));
  assert.equal(await card.locator('[data-part="sentence-box"]').getAttribute('open'), '');
  assert.ok((await metrics(card)).contentHeight > collapsed.contentHeight, 'expanded sentence adds body content');
  const expanded = await cardChrome(page, card);
  assert.deepEqual(expanded.head, initial.head, 'sentence expansion keeps header fixed');
  assert.deepEqual(expanded.footer, initial.footer, 'sentence expansion keeps footer fixed');
  const explain = card.locator('[data-explain] button');
  await explain.waitFor({ state: 'visible' });
  await body.evaluate(el => {
    const button = el.querySelector('[data-explain] button');
    el.scrollTop += button.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  await settle(page);
  await coordinateTap(page, explain);
  assert.equal(await card.locator('[data-part="easier"]').innerText(),
    'The seller carried lights through the flood while the neighbors watched.');
  assert.equal(await card.locator('[data-part="grammar"]').innerText(),
    'While introduces an action happening at the same time as the journey.');
  const explained = await cardChrome(page, card);
  assert.deepEqual(explained.head, initial.head, 'ExplainSentence keeps header fixed');
  assert.deepEqual(explained.footer, initial.footer, 'ExplainSentence keeps footer fixed');
  assert.deepEqual(explained.scroll.slice(0, 3), initial.scroll.slice(0, 3),
    'ExplainSentence scrollIntoView affects only the explanation body');
  await body.evaluate(el => { el.scrollTop = 0; });
  const r = await body.boundingBox();
  await drag(-Math.min(100, r.height - 24));
  assert.ok(await body.evaluate(el => el.scrollTop) > 0, 'trusted upward touch scrolls the real body');
  const scrolled = await cardChrome(page, card);
  assert.deepEqual(scrolled.head, initial.head, 'internal scroll keeps header fixed');
  assert.deepEqual(scrolled.footer, initial.footer, 'internal scroll keeps footer fixed');
  assert.deepEqual(scrolled.scroll.slice(0, 3), initial.scroll.slice(0, 3), 'touch scroll leaves reader and outer sheet still');
  await body.evaluate(el => { el.scrollTop = 32; });
  await drag(100);
  assert.equal(await card.count(), 1, 'downward gesture starting in a scrolled body must not dismiss');
  assert.equal(await body.evaluate(el => el.scrollTop), 0, 'same gesture can reach top without becoming a dismissal');
  await cardChrome(page, card);
  await drag(100, 'touchCancel');
  assert.equal(await card.count(), 1, 'touchcancel beyond threshold does not close');
  assert.ok(await card.evaluate(el => Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42) < 1),
    'touchcancel returns the sheet to its original position');
  await cardChrome(page, card);
  await drag(100);
  await card.waitFor({ state: 'detached' });
  // Switch actual words, not only lookup targets; a previously scrolled card must reset.
  await open('odds');
  await collapsedDetails(card, true);
  await expandDisclosure(page, card, 'word-alone', 'chances that something');
  await expandDisclosure(page, card, 'word-more', 'An abstract plural noun');
  await expandDisclosure(page, card, 'sentence-box', 'Against all odds');
  await coordinateTap(page, card.locator('[data-look-target="word"]'));
  await lookupTarget(card, 'word');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle(page);
  assert.ok(await body.evaluate(el => el.scrollTop) > 0, 'word switch starts from a scrolled explanation');
  await cardChrome(page, card);
  if (width === 430) {
    // There is enough reader space above this sheet for the next word on the same line.
    const originalBody = await body.elementHandle();
    const readerScroll = await page.evaluate(() => [scrollX, scrollY]);
    await coordinateTap(page, page.locator('article [role="button"][data-word="lantern"] .book-tap').nth(10));
    await page.waitForFunction(() => document.querySelector('[data-word-card] h2')?.textContent === 'lantern');
    assert.ok(await originalBody.evaluate(el => el.isConnected && el === document.querySelector('[data-word-body]')),
      'tapping another reader word reuses the mounted body instead of close/reopen');
    assert.equal(await originalBody.evaluate(el => el.scrollTop), 0, 'same body resets scroll on word switch');
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), readerScroll, 'direct word switch does not scroll reader');
    await collapsedDetails(card, false);
    await cardChrome(page, card);
    await coordinateTap(page, page.locator('article [role="button"][data-word="odds"] .book-tap').nth(10));
    await card.locator('[data-part="phrase-meaning"]').waitFor();
    await settle(page);
    assert.ok(await originalBody.evaluate(el => el.isConnected && el === document.querySelector('[data-word-body]')),
      'returning to phrase also reuses the mounted body');
    await collapsedDetails(card, true);
    await lookupTarget(card, 'phrase');
    assert.equal(await body.evaluate(el => el.scrollTop), 0, 'same-card return resets body scroll');
    await coordinateTap(page, page.locator('article [role="button"][data-word="lantern"] .book-tap').nth(10));
    await page.waitForFunction(() => document.querySelector('[data-word-card] h2')?.textContent === 'lantern');
    await originalBody.dispose();
    await cardChrome(page, card);
  } else {
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
    await open('lantern');
  }
  assert.equal(await card.locator('h2').innerText(), 'lantern');
  assert.equal(await body.evaluate(el => el.scrollTop), 0);
  assert.equal(await card.locator('[data-look-target-group]').count(), 0);
  await links(card, 'lantern');
  await coordinateTap(page, card.locator('[data-panel-close]'));
  await card.waitFor({ state: 'detached' });
  const reopened = await open('odds');
  assert.equal(reopened.scroll[3], 0, 'returning to phrase resets body scroll');
  await collapsedDetails(card, true);
  await lookupTarget(card, 'phrase');
  await coordinateTap(page, card.locator('[data-panel-close]'));
  await card.waitFor({ state: 'detached' });
  const longInitial = await open(longWord);
  assert.equal(await card.locator('h2').innerText(), longWord);
  assert.equal(await card.locator('[data-part="word-here"]').count(), 0, 'long plain definition has no here block');
  assert.equal(await card.locator('[data-look-target-group]').count(), 0);
  await links(card, longWord);
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle(page);
  assert.ok(await body.evaluate(el => el.scrollTop) > 0, 'long plain definition needs internal scrolling');
  const longScrolled = await cardChrome(page, card);
  assert.deepEqual(longScrolled.head, longInitial.head, 'long title stays fixed');
  assert.deepEqual(longScrolled.footer, longInitial.footer, 'long plain definition keeps lookup footer visible');
  await coordinateTap(page, card.locator('[data-panel-close]'));
  await card.waitFor({ state: 'detached' });
  await cdp.detach();
  console.log(`PASS ${width}x${height}: mobile touch, persistent hit-testable lookup footer, body scrolling, sentence explanation, word switching, long plain definition, pull-down and touchcancel`);
}
async function stressRegression(page, width, height, scale) {
  const isPhrase = height < 1200;
  const label = `${width}x${height} root=${scale}% title=${isPhrase ? phrase.length : 'lantern'} dark`;
  const failures = [];
  const check = async (name, run) => {
    try { await run(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  await page.evaluate(scale => {
    document.documentElement.style.fontSize = `${scale}%`;
    document.documentElement.setAttribute('data-theme', 'dark');
  }, scale);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press('Escape');
  const anchor = page.locator(`article [role="button"][data-word="${isPhrase ? 'odds' : 'lantern'}"] .book-tap`).nth(10);
  await position(page, anchor, isPhrase ? height / 2 : 120);
  const article = await page.locator('article').boundingBox();
  await anchor.click();
  const card = page.locator('[data-word-card]');
  await card.locator(`[data-part="${isPhrase ? 'phrase-meaning' : 'word-meaning'}"]`).waitFor();
  await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
  await settle(page);
  const snapshot = async () => card.evaluate(el => {
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    const body = el.querySelector('[data-word-body]');
    const content = body.querySelector('[data-word-content]');
    const style = getComputedStyle(el), bodyStyle = getComputedStyle(body);
    const outerSpace = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, prop) => sum + parseFloat(style[prop]), 0)
      + parseFloat(bodyStyle.marginTop) + parseFloat(bodyStyle.marginBottom);
    return { card: rect(el), head: rect(el.querySelector('[data-word-header]')), body: rect(body), outerSpace,
      footer: rect(el.querySelector('[data-word-footer]')), content: rect(content),
      bodyScroll: body.scrollTop, maxScroll: body.scrollHeight - body.clientHeight,
      naturalContent: content.offsetHeight, maxHeight: getComputedStyle(el).maxHeight,
      rootSize: getComputedStyle(document.documentElement).fontSize,
      theme: document.documentElement.dataset.theme, background: style.backgroundColor, color: style.color };
  });
  const validate = async stage => {
    const state = await snapshot();
    await check(`${stage} theme and root scale`, async () => {
      assert.equal(state.theme, 'dark');
      assert.equal(state.background, 'rgb(29, 32, 37)', 'dark theme is actually painted on card');
      assert.equal(state.color, 'rgb(233, 230, 223)', 'dark theme applies readable foreground');
      assert.equal(state.rootSize, `${16 * scale / 100}px`, 'requested root font scaling is applied');
    });
    await check(`${stage} chrome`, () => cardChrome(page, card));
    await check(`${stage} geometry`, async () => {
      const c = state.card, a = await anchor.boundingBox();
      assert.equal(c.width, desktopWidth, 'desktop width remains exactly 384px even with root font scaling');
      assert.ok(c.x >= 0 && c.right <= width + 1 && c.y >= 0 && c.bottom <= height + 1, 'card stays in viewport');
      assert.ok(c.right <= a.x + 1 || c.x >= a.x + a.width - 1 || c.bottom <= a.y + 1 || c.y >= a.y + a.height - 1,
        'card does not cover centered anchor');
      assert.deepEqual(await page.locator('article').boundingBox(), article, 'reader stays fixed');
    });
    await check(`${stage} body budget`, async () => {
      const nonBody = state.head.height + state.footer.height + state.outerSpace;
      if (height - 24 - nonBody >= 80) {
        assert.ok(state.body.height >= 80, `body is ${state.body.height}px although viewport can fit 80px plus ${nonBody}px chrome`);
      }
    });
    const frames = await card.evaluate(async el => {
      const frames = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const r = el.getBoundingClientRect();
        frames.push([r.x, r.y, r.width, r.height, el.querySelector('[data-word-body]').clientHeight]);
      }
      return frames;
    });
    await check(`${stage} stability`, async () => {
      for (const frame of frames.slice(1)) assert.deepEqual(frame, frames[0], 'layout is stable for 20 consecutive frames');
    });
    return state;
  };
  await collapsedDetails(card, isPhrase);
  const initial = await validate('collapsed');
  // This independent geometry probe toggles native details directly, avoiding any
  // locator auto-scroll. Pointer/keyboard disclosure behavior is covered in the normal matrix.
  await card.locator('[data-word-content]').evaluate(el => {
    for (const details of el.querySelectorAll('details')) details.open = true;
  });
  await settle(page);
  const expanded = await validate('expanded');
  await card.locator('[data-word-content]').evaluate(el => {
    for (const details of el.querySelectorAll('details')) details.open = false;
  });
  await settle(page);
  const recollapsed = await validate('recollapsed');
  await check('collapse restores size', async () => {
    assert.ok(expanded.naturalContent > initial.naturalContent, 'opening details increases natural height');
    if (height >= 1200) assert.ok(expanded.card.height > initial.card.height, 'uncapped card grows on expansion');
    assert.ok(Math.abs(recollapsed.naturalContent - initial.naturalContent) <= 1, 'content shrinks back');
    assert.ok(Math.abs(recollapsed.card.height - initial.card.height) <= 1, 'card shrinks back to initial height');
  });
  await check('close is pointer-reachable', async () => {
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
  });
  if (await card.count()) {
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'detached' });
  }
  console.log(JSON.stringify({ stress: label, initial, expanded, recollapsed, failures }));
  stressFailures.push(...failures.map(failure => `${label}: ${failure}`));
}
try {
  const viewports = stress
    ? [...[1024, 1280].flatMap(width => [100, 125, 150].map(scale => [width, 450, scale])), [1280, 1200, 100]]
    : [[1280, 800], [1024, 768], [1280, 600], [820, 1100], [768, 1024], [390, 844], [375, 667], [430, 932], [320, 568], [667, 375]];
  for (const [width, height, scale = 100] of viewports) {
    // Cover both UI languages without multiplying the entire viewport matrix.
    const locale = width === 375 || width === 320 ? 'zh-CN' : 'en-US';
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 768,
      hasTouch: width < 768, serviceWorkers: 'block', locale });
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "shelf");
    await page.waitForSelector("header");
    await page.evaluate(async ({ phraseKey, longWord }) => {
      const id = "word-card-layout-regression";
      const sentence = `${phraseKey[0].toUpperCase()}${phraseKey.slice(1)} the lantern seller carried the fragile lights through the flooded streets, while neighbors watched from their windows and wondered whether the exhausted traveler could reach the distant village before the rising river covered the last safe bridge.`;
      const paragraphs = Array.from({ length: 40 }, () => `${sentence} The doctor discussed ${longWord} after the journey.`);
      const glossary = {
        [longWord]: { pos: 'noun', meaning: 'A name for a lung illness caused by breathing very fine dust. '.repeat(24), whyHard: 'A very long technical word.' },
        lantern: { pos: "noun", meaning: "A portable light.", whyHard: "" },
        odds: { pos: "noun", meaning: "The chances that something will happen, especially when several difficulties make the hoped-for result seem very unlikely.", whyHard: "An abstract plural noun used in a fixed expression." },
      };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("cibian-books", 3);
        request.onupgradeneeded = () => {
          for (const name of ["books", "covers", "notes"])
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "notes"], "readwrite");
        tx.objectStore("books").put({ id, title: "Word card layout", author: "Test", glossary, pending: [], totalHard: 3,
          chapters: [{ title: "Chapter", paragraphs, html: paragraphs.map(p => `<p>${p}</p>`).join("") }] }, id);
        tx.objectStore("notes").put({ paragraphs: [{ chapter: 0, paragraph: 10, context: sentence,
          mainIdea: "A difficult journey.", simple: "The seller carries lights through a flood." }],
          sentences: [{ chapter: 0, context: sentence,
            simple: 'The seller carried lights through the flood while the neighbors watched.',
            grammar: 'While introduces an action happening at the same time as the journey.' }],
          phrases: { [phraseKey]: { pos: "idiom", meaning: "Despite many serious difficulties and very little chance of success, continuing to try until an unexpected result becomes possible through patience, determination, and help from others.",
            here: "The seller keeps carrying the lanterns toward the village even though the flooded streets, rising river, and approaching darkness all make a safe arrival seem almost impossible." } } }, `extras:${id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
        books: [{ id, title: "Word card layout", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {} } }));
    }, { phraseKey: phrase, longWord });
    await page.goto(base + "read/word-card-layout-regression");
    await page.waitForSelector('article.book-body [role="button"][data-word="odds"]');
    assert.equal(await page.locator('html').getAttribute('lang'), locale === 'zh-CN' ? 'zh-CN' : 'en',
      `${width}x${height}: expected UI language is applied`);
    if (stress) {
      await stressRegression(page, width, height, scale);
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (width < 768) {
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press('Escape'); // Release initial saved-position hold before positioning the fixture.
      await phoneRegression(page, width, height);
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    await page.evaluate(() => {
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.testExternalControl = "1";
      control.textContent = "External control";
      control.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;padding:8px;background:white;color:black";
      document.body.append(control);
    });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Escape"); // Release the reader's initial saved-position hold without scrolling.
    for (const side of width >= 1024 ? ["bottom", "top"] : ["bottom"]) {
      for (const word of ["lantern", "odds"]) {
        const button = page.locator(`article [role="button"][data-word="${word}"]`).nth(10);
        const anchor = button.locator(".book-tap");
        await position(page, anchor, side === "top" ? height - 85 : 120);
        const article = await page.locator("article").boundingBox();
        await anchor.click();
        const card = page.locator("[data-word-card]");
        await card.waitFor({ state: "visible" });
        if (word === "odds") await card.locator('[data-part="phrase-meaning"]').waitFor();
        await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
        await settle(page);
        await geometry(page, anchor, card, width, height, side, article);
        await cardChrome(page, card);
        await collapsedDetails(card, word === 'odds');
        if (width >= 1024) {
          await page.keyboard.press("Tab");
          assert.ok(await card.evaluate(el => el.contains(document.activeElement)), "Tab keeps focus inside desktop card");
        }
        assert.equal(await card.locator("h2").innerText(), word === "odds" ? phrase : word);
        await links(card, word === "odds" ? phrase : word);
        if (word === "odds") {
          assert.ok((await card.locator('[data-part="word-here"]').innerText()).includes("flooded streets"));
          await lookupTarget(card, 'phrase');
          const initialChrome = await cardChrome(page, card);
          for (const mode of ['word', 'phrase']) {
            await coordinateTap(page, card.locator(`[data-look-target="${mode}"]`));
            await lookupTarget(card, mode);
            await links(card, mode === 'word' ? word : phrase);
            assert.deepEqual((await cardChrome(page, card)).scroll, initialChrome.scroll,
              'lookup target click does not scroll reader, card or body');
          }
          await expandDisclosure(page, card, 'word-alone', 'chances that something');
          assert.equal(await card.locator('[data-part="word-alone"] [data-part="word-meaning"]').isVisible(), true);
          await expandDisclosure(page, card, 'word-more', 'An abstract plural noun');
          const collapsed = await metrics(card);
          await expandDisclosure(page, card, 'sentence-box', 'Against all odds');
          const expanded = await metrics(card);
          assert.ok(expanded.contentHeight > collapsed.contentHeight, 'expanded sentence adds natural-height content');
          console.log(JSON.stringify({ viewport: `${width}x${height}`, side, desktopWidth, collapsed, expanded }));
          // Desktop may resize/reposition on expansion; assert visibility and placement, not frozen coordinates.
          await geometry(page, anchor, card, width, height, side, article);
          const explain = card.locator('[data-explain] button');
          await exposeInBody(card, explain);
          await settle(page);
          await coordinateTap(page, explain);
          assert.equal(await card.locator('[data-part="easier"]').innerText(),
            'The seller carried lights through the flood while the neighbors watched.');
          assert.equal(await card.locator('[data-part="grammar"]').innerText(),
            'While introduces an action happening at the same time as the journey.');
          const explainedChrome = await cardChrome(page, card);
          assert.deepEqual(explainedChrome.scroll.slice(0, 3), initialChrome.scroll.slice(0, 3),
            'ExplainSentence scrollIntoView affects only the explanation body');
          await card.locator('[data-word-body]').evaluate(el => { el.scrollTop = el.scrollHeight; });
          await settle(page);
          assert.ok((await metrics(card)).scrollTop > 0, 'expanded explanation scrolls inside the body');
          const scrolledChrome = await cardChrome(page, card);
          assert.deepEqual(scrolledChrome.head, explainedChrome.head, 'internal scroll leaves header visible and still');
          assert.deepEqual(scrolledChrome.footer, explainedChrome.footer, 'internal scroll leaves footer visible and still');
          assert.deepEqual(scrolledChrome.scroll.slice(0, 3), initialChrome.scroll.slice(0, 3),
            'body scrolling leaves reader and outer card still');
          // Explain replaces its trigger with results. Restore a live in-card focus target
          // before testing explicit-close focus return (which intentionally requires in-card focus).
          await card.locator('[data-part="sentence-box"] > summary').evaluate(el => el.focus({ preventScroll: true }));
          assert.ok(await card.evaluate(el => el.contains(document.activeElement)), 'Escape starts with focus inside card');
        } else assert.equal(await card.locator("[data-look-target-group]").count(), 0);
        await page.keyboard.press("Escape");
        await card.waitFor({ state: "detached" });
        if (width >= 1024) {
          assert.equal(
            await button.evaluate(el => document.activeElement === el),
            true,
            `${width}x${height} ${side} ${word}: Escape restores focus to the exact originating word control`,
          );
        }
        assert.deepEqual(await page.locator("article").boundingBox(), article);

        // A click-away to a real external control closes without stealing its focus.
        await anchor.click();
        await card.waitFor({ state: "visible" });
        const external = page.locator('[data-test-external-control]');
        await external.click();
        await card.waitFor({ state: "detached" });
        assert.equal(await external.evaluate(el => document.activeElement === el), true,
          `${width}x${height} ${word}: click-away does not steal external control focus`);
      }
    }
    {
      const card = page.locator('[data-word-card]');
      const phraseAnchor = page.locator('article [role="button"][data-word="odds"] .book-tap').nth(10);
      const nextAnchor = page.locator('article [role="button"][data-word="lantern"] .book-tap').nth(10);
      await position(page, phraseAnchor, 120);
      await phraseAnchor.click();
      await card.locator('[data-part="phrase-meaning"]').waitFor();
      await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
      await settle(page);
      await collapsedDetails(card, true);
      await expandDisclosure(page, card, 'word-alone', 'chances that something');
      await expandDisclosure(page, card, 'word-more', 'An abstract plural noun');
      await expandDisclosure(page, card, 'sentence-box', 'Against all odds');
      await coordinateTap(page, card.locator('[data-look-target="word"]'));
      await lookupTarget(card, 'word');
      const body = card.locator('[data-word-body]');
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await settle(page);
      assert.ok((await metrics(card)).scrollTop > 0, 'same-card switch begins with scrolled expanded content');
      await cardChrome(page, card);
      const originalBody = await body.elementHandle();
      const readerScroll = await page.evaluate(() => [scrollX, scrollY]);
      await coordinateTap(page, nextAnchor);
      await page.waitForFunction(() => document.querySelector('[data-word-card] h2')?.textContent === 'lantern');
      assert.ok(await originalBody.evaluate(el => el.isConnected && el === document.querySelector('[data-word-body]')),
        'desktop/tablet word switch reuses the mounted body');
      assert.equal(await body.evaluate(el => el.scrollTop), 0, 'same-card word switch resets body scroll');
      await collapsedDetails(card, false);
      await cardChrome(page, card);
      await links(card, 'lantern');
      await coordinateTap(page, phraseAnchor);
      await card.locator('[data-part="phrase-meaning"]').waitFor();
      await settle(page);
      assert.ok(await originalBody.evaluate(el => el.isConnected && el === document.querySelector('[data-word-body]')));
      assert.equal(await body.evaluate(el => el.scrollTop), 0, 'return to phrase resets scroll');
      await collapsedDetails(card, true);
      await lookupTarget(card, 'phrase');
      await cardChrome(page, card);
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), readerScroll, 'same-card round trip leaves reader still');
      await originalBody.dispose();
      await page.keyboard.press('Escape');
      await card.waitFor({ state: 'detached' });

      const longAnchor = page.locator(`article [role="button"][data-word="${longWord}"] .book-tap`).nth(10);
      await position(page, longAnchor, 120);
      await longAnchor.click();
      await card.waitFor({ state: 'visible' });
      await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
      await settle(page);
      await collapsedDetails(card, false);
      assert.equal(await card.locator('h2').innerText(), longWord);
      assert.equal(await card.locator('[data-part="word-here"]').count(), 0);
      await links(card, longWord);
      const longInitial = await cardChrome(page, card);
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await settle(page);
      assert.ok((await metrics(card)).scrollTop > 0, 'long plain definition scrolls inside body on desktop/tablet');
      const longScrolled = await cardChrome(page, card);
      assert.deepEqual(longScrolled.head, longInitial.head, 'long title remains visible during body scroll');
      assert.deepEqual(longScrolled.footer, longInitial.footer, 'long definition keeps lookup footer visible');
      await page.keyboard.press('Escape');
      await card.waitFor({ state: 'detached' });
    }
    if (width >= 1024) {
      const origin = page.locator('article [role="button"][data-word="lantern"]').nth(10);
      const ink = origin.locator(".book-tap");
      const card = page.locator("[data-word-card]");
      const external = page.locator("[data-test-external-control]");
      await position(page, ink, 120);
      assert.equal(await origin.evaluate(el => el.tagName), "SPAN");
      assert.equal(await origin.getAttribute("tabindex"), "-1");
      assert.equal(await ink.getAttribute("role"), null, "inner ink stays non-interactive");
      assert.equal(await ink.getAttribute("tabindex"), null, "inner ink stays out of focus order");
      await ink.click();
      await card.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await origin.evaluate(el => document.activeElement === el), true);
      const scroll = await page.evaluate(() => [scrollX, scrollY]);
      await origin.evaluate(el => {
        el.dataset.testClicks = "0";
        el.addEventListener("click", () => { el.dataset.testClicks = String(Number(el.dataset.testClicks) + 1); });
      });
      for (const key of ["Enter", "Space"]) {
        const clicks = Number(await origin.getAttribute("data-test-clicks"));
        await page.keyboard.down(key);
        await settle(page);
        if (key === "Space") {
          assert.equal(await card.count(), 0, "Space keydown does not open a card");
          assert.equal(Number(await origin.getAttribute("data-test-clicks")), clicks);
        }
        await page.keyboard.up(key);
        await card.waitFor({ state: "visible" });
        await settle(page);
        assert.equal(await card.count(), 1, `${key} reopens one card`);
        assert.equal(Number(await origin.getAttribute("data-test-clicks")), clicks + 1, `${key} activates exactly once`);
        assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scroll, `${key} does not scroll the reader`);
        await card.locator("[data-panel-close]").click();
        await card.waitFor({ state: "detached" });
        await settle(page);
        assert.equal(await origin.evaluate(el => document.activeElement === el), true, "close button restores exact outer control");
        assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scroll, "close button restores without scrolling");
      }

      await ink.click();
      await card.waitFor({ state: "visible" });
      await settle(page);
      await external.focus();
      await origin.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().bottom + 100));
      await card.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await origin.evaluate(el => el.getBoundingClientRect().bottom < 0), true);
      assert.equal(await external.evaluate(el => document.activeElement === el), true, "offscreen dismissal never restores focus");

      await position(page, ink, 120);
      await ink.click();
      await card.waitFor({ state: "visible" });
      await settle(page);
      await external.focus();
      await page.setViewportSize({ width: 1023, height });
      await settle(page);
      assert.equal(await external.evaluate(el => document.activeElement === el), true, "crossing desktop breakpoint does not restore word focus");
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await page.setViewportSize({ width, height });
      await settle(page);
      await position(page, page.locator("article p").nth(10), 120);
      const marker = page.locator('[data-para-marker="10"]');
      await marker.waitFor({ state: "visible" });
      const article = await page.locator("article").boundingBox();
      await marker.click();
      const panel = page.locator("[data-para-panel]");
      await panel.waitFor({ state: "visible" });
      await panel.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
      await settle(page);
      assert.equal((await panel.boundingBox()).width, 336, "paragraph card stays 336px");
      assert.deepEqual(await page.locator("article").boundingBox(), article);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height}: widths, placement, article stability, lookup targets, sentence, click-away${width >= 1024 ? ", exact focus return, Enter/Space, close button, offscreen and breakpoint focus" : " and Escape dismissal"}`);
    await page.close();
  }
  assert.deepEqual(stressFailures, [], 'independent stress matrix has no layout failures');
} finally {
  await browser.close();
}
