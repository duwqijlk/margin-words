// Synthetic IndexedDB fixture; run against an already-running app. No external lookups are opened.
// WORD_CARD_STRESS=1 runs dark, centered-anchor, 100/125/150% root-font desktop cases
// plus a tall-window expand/shrink case. Add STRESS_LONG_TITLE=1 for the long phrase fixture.
// The long-title run also probes 125/150% root fonts on a narrow phone.
// WORD_CARD_VIEWPORT=phone (or e.g. 390x844) filters iteration only; default retains all 10 cases.
// Fixed-position sparse-surface drags + reader layout-shift probes use 320x568 (zh) / 667x375 (en).
// WORD_CARD_NO_LIST=1 also checks the empty-glossary notice on that isolated fixture pair.
// WORD_CARD_REQUIRE_IPA=1 requires locale-only word audio on the explicitly enabled IPA build.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8098/").replace(/\/?$/, "/");
const desktopWidth = Number(process.env.EXPECT_DESKTOP_WIDTH ?? 384);
assert.ok([336, 384].includes(desktopWidth), "EXPECT_DESKTOP_WIDTH must be 336 or 384");
const stress = process.env.WORD_CARD_STRESS === '1';
const requireIpa = process.env.WORD_CARD_REQUIRE_IPA === '1';
const stressFailures = [];
const phrase = stress && process.env.STRESS_LONG_TITLE === '1'
  ? 'against all odds and despite every possible obstacle' : 'against all odds';
const longWord = 'pneumonoultramicroscopicsilicovolcanoconiosis';
const fixture = {
  phraseMeaning: 'Despite many serious difficulties and very little chance of success, continuing to try until an unexpected result becomes possible through patience, determination, and help from others.',
  phraseHere: 'The seller keeps carrying the lanterns toward the village even though the flooded streets, rising river, and approaching darkness all make a safe arrival seem almost impossible.',
  phraseExample: `They finished the journey ${phrase}.`,
  wordMeaning: 'The chances that something will happen, especially when several difficulties make the hoped-for result seem very unlikely.',
  wordHere: 'The seller has very little chance of reaching the village safely.',
  wordWhy: 'An abstract plural noun used in a fixed expression.',
  wordExample: 'The odds of finding a blue lantern were small.',
  otherMeaning: 'A comparison between amounts paid on a bet.',
  sparseMeaning: 'Easily broken or damaged.',
};
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
  // From 768px (tablets too) the card floats beside the word; below that it is a bottom sheet.
  assert.equal(c.width, width >= 768 ? desktopWidth : width);
  assert.ok(c.x >= -1 && c.x + c.width <= width + 1 && c.y >= -1 && c.y + c.height <= height + 1, "card inside viewport");
  assert.ok(c.x + c.width <= a.x + 1 || c.x >= a.x + a.width - 1 || c.y + c.height <= a.y + 1 || c.y >= a.y + a.height - 1, "card does not cover anchor");
  if (width >= 768) {
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
// Assert the build's audio contract, not whichever controls happened to mount. In particular,
// absent/broken IPA must not silently turn an enabled word card back into a generic-speaker case.
async function pronunciationControls(card) {
  const word = await card.locator('h2').innerText();
  const isPhrase = await card.locator('[data-part="phrase-meaning"]').count() > 0;
  if (isPhrase) {
    assert.equal(await card.locator('[data-word-header] [data-speak]').count(), 0, 'phrase has no redundant generic header speaker');
    assert.equal(await card.locator('[data-word-ipa]').count(), 0, 'phrase has no invented IPA');
    assert.equal(await card.locator('[data-phrase-audio] [data-speak-accent]').count(), 2, 'phrase has UK and US controls');
    return { localeOnly: true, accents: ['UK', 'US'] };
  }
  const localeOnly = requireIpa;
  const header = card.locator('[data-word-header] [data-speak]');
  assert.equal(await header.count(), localeOnly ? 0 : 1,
    localeOnly ? 'enabled word card has no redundant header speaker' : 'phrase/default card retains one generic header speaker');
  if (!localeOnly) {
    assert.equal(await card.locator('[data-speak-accent]').count(), 0, 'phrase/default card has no locale speakers');
    assert.equal(await card.locator('[data-word-ipa]').count(), 0, 'phrase/default card has no IPA row');
    assert.equal(await card.locator('[data-speak]').count(), 1, 'phrase/default card has only its generic speaker');
    assert.ok((await header.getAttribute('aria-label')).endsWith(`: ${word}`), 'generic speaker names displayed target');
    return { localeOnly, accents: [] };
  }
  const ipa = card.locator('[data-word-ipa]');
  assert.equal(await ipa.count(), 1, 'enabled word has exactly one IPA section');
  assert.equal(await ipa.getAttribute('data-ipa-word'), word, 'IPA matches the visible word');
  assert.equal(await ipa.evaluate(el => {
    const content = el.closest('[data-word-content]');
    return content?.firstElementChild === el && el.nextElementSibling?.hasAttribute('data-word-primary');
  }), true, 'IPA is the first scroll-body content, immediately before primary meaning');
  await card.locator('[data-word-ipa]:not([data-ipa-status="loading"])').waitFor();
  const accents = [];
  for (const accent of ['UK', 'US']) {
    const group = ipa.locator(`[data-ipa-locale="${accent}"]`);
    const readings = await group.locator('[data-ipa-reading]').count();
    const button = group.locator(`[data-speak-accent="${accent}"]`);
    assert.ok(readings <= 1, 'one primary IPA per accent');
    assert.equal(await button.count(), 1, `${accent} retains its speaker independently of local IPA`);
    {
      accents.push(accent);
      assert.equal(await button.evaluate(el => el.tagName), 'BUTTON', `${accent} speaker is a native button`);
      assert.ok((await button.getAttribute('aria-label')).endsWith(`: ${word}`), `${accent} accessible name names displayed word`);
    }
  }
  assert.equal(await card.locator('[data-speak]').count(), accents.length, 'enabled word has only matching locale speakers');
  if (word === 'odds') assert.deepEqual(accents, ['UK', 'US'], 'known fixture word requires exactly UK and US speakers');
  return { localeOnly, accents };
}
// No locator.click()/tap() on lookup controls: those auto-scroll and can hide this regression.
async function cardChrome(page, card) {
  const audioControls = await pronunciationControls(card);
  // A preceding real tap may still be finishing active:scale-95's 150ms return.
  // Measure stable geometry, not a transient 43.87px projection of a 44px button.
  await card.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(animation =>
    animation.playState !== 'finished' && animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  const state = await card.evaluate(el => {
    const body = el.querySelector('[data-word-body]');
    const content = body.querySelector('[data-word-content]');
    const head = el.querySelector('[data-word-header]');
    const footer = el.querySelector('[data-word-footer]');
    const primary = el.querySelector('[data-word-primary]');
    const box = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    // Measure the intersection actually exposed by the scrolling body, not the
    // primary block's un-clipped natural box (especially on 320x568/667x375).
    const clipped = (node, clip) => {
      const r = node.getBoundingClientRect(), c = clip.getBoundingClientRect();
      const x = Math.max(0, r.left, c.left), y = Math.max(0, r.top, c.top);
      const right = Math.min(innerWidth, r.right, c.right), bottom = Math.min(innerHeight, r.bottom, c.bottom);
      return { x, y, right, bottom, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
    };
    const exposed = clipped(primary, body);
    const points = (r, target) => r.width > 0 && r.height > 0
      ? [0.15, 0.5, 0.85].flatMap(fx => [0.25, 0.75].map(fy => {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: !!hit && target.contains(hit), interactive: !!hit?.closest('a, button, input, textarea, select, summary, [role="button"], [data-word-footer]') };
      })) : [];
    const handle = el.querySelector('[data-sheet-handle]');
    const handleBox = box(handle);
    const cardBox = box(el), cardStyle = getComputedStyle(el);
    // Overflow clipping follows the rounded card, whose rem radius grows under
    // root-font stress. Derive each edge point from that curve, not a lucky hit
    // search or a fixed 5px point outside the painted top corner at 150%.
    const cornerInset = (radius, y) => {
      const parts = radius.split(/\s+/);
      const pixels = (value, size) => parseFloat(value) * (value.endsWith('%') ? size / 100 : 1);
      const rx = pixels(parts[0], cardBox.width), ry = pixels(parts[1] ?? parts[0], cardBox.height);
      const dy = y - cardBox.y;
      if (!rx || !ry || dy >= ry) return 5;
      const normalized = Math.max(0, Math.min(1, (ry - dy) / ry));
      return rx * (1 - Math.sqrt(1 - normalized ** 2)) + 5;
    };
    const handlePoints = [0.25, 0.75].flatMap(fy => {
      const y = handleBox.y + handleBox.height * fy;
      return [
        { edge: 'left', x: cardBox.x + cornerInset(cardStyle.borderTopLeftRadius, y) },
        { edge: 'center', x: cardBox.x + cardBox.width / 2 },
        { edge: 'right', x: cardBox.right - cornerInset(cardStyle.borderTopRightRadius, y) },
      ].map(({ edge, x }) => {
        const hit = document.elementFromPoint(x, y);
        const inPadding = edge === 'center' || (edge === 'left'
          ? x < cardBox.x + parseFloat(cardStyle.paddingLeft)
          : x > cardBox.right - parseFloat(cardStyle.paddingRight));
        return { edge, x, y, inPadding, hit: !!hit && handle.contains(hit) };
      });
    });
    return { tag: el.tagName, display: getComputedStyle(el).display, direction: getComputedStyle(el).flexDirection,
      maxHeight: getComputedStyle(el).maxHeight, bodyMinHeight: getComputedStyle(body).minHeight,
      primary: { ...box(primary), minHeight: getComputedStyle(primary).minHeight,
        alignContent: getComputedStyle(primary).alignContent, exposed, points: points(exposed, primary),
        first: box(primary.firstElementChild) },
      overflow: getComputedStyle(el).overflowY, bodyOverflow: getComputedStyle(body).overflowY,
      contentOverflow: getComputedStyle(content).overflowY, contentMaxHeight: getComputedStyle(content).maxHeight,
      contentScrollHeight: content.scrollHeight, contentClientHeight: content.clientHeight,
      card: box(el), body: box(body), content: box(content), head: box(head), footer: box(footer),
      header: Object.fromEntries(['head', 'title', 'tools', 'meta', 'actions'].map(part => {
        const node = el.querySelector(`[data-word-${part}]`);
        const style = getComputedStyle(node);
        return [part, { ...box(node), position: style.position, display: style.display,
          justifyContent: style.justifyContent, flexWrap: style.flexWrap,
          columnGap: parseFloat(style.columnGap), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }];
      })),
      titleText: box(el.querySelector('h2')),
      handle: { ...handleBox, touchAction: getComputedStyle(handle).touchAction, points: handlePoints },
      scroll: [scrollX, scrollY, el.scrollTop, body.scrollTop],
      viewport: [innerWidth, innerHeight],
      controls: [...el.querySelectorAll('[data-lookup], [data-look-target], [data-panel-close], [data-word-header] [data-speak], [data-word-save], [data-feedback-toggle], [data-feedback-options] button')].map(node => {
        const r = box(node);
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const name = node.dataset.lookup || node.dataset.lookTarget || (node.hasAttribute('data-speak') ? 'speak'
          : node.hasAttribute('data-word-save') ? 'save' : node.hasAttribute('data-panel-close') ? 'close'
          : node.hasAttribute('data-feedback-toggle') ? 'feedback-toggle' : 'feedback-option');
        return { ...r, hit: !!hit && node.contains(hit), name };
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
      `${name} fits inside sheet: ${JSON.stringify({ box, card: state.card, header: state.head, footer: state.footer })}`);
    assert.ok(box.y >= 0 && box.bottom <= state.viewport[1] + 1, `${name} is in viewport`);
  }
  assert.ok(state.head.bottom <= state.body.y + 1 && state.body.bottom <= state.footer.y + 1,
    'scrolling body does not overlap persistent header/footer');
  for (const control of state.controls) {
    if (['word', 'phrase'].includes(control.name)) assert.ok(control.y >= state.head.y - 1 && control.bottom <= state.head.bottom + 1,
      `${control.name} toggle remains inside persistent header`);
    assert.ok(control.x >= 0 && control.right <= state.viewport[0] + 1 && control.y >= 0 && control.bottom <= state.viewport[1] + 1,
      `${control.name} fully visible before interaction`);
    assert.ok(control.hit, `${control.name} receives a center hit without scrolling`);
  }
  const { head, title, tools, meta, actions } = state.header;
  const buttons = (audioControls.localeOnly ? ['save', 'close'] : ['speak', 'save', 'close']).map(name => {
    const matches = state.controls.filter(control => control.name === name);
    assert.equal(matches.length, 1, `header has exactly one ${name} button`);
    return matches[0];
  });
  const speak = buttons.find(button => button.name === 'speak');
  const save = buttons.find(button => button.name === 'save');
  const close = buttons.find(button => button.name === 'close');
  const separated = (a, b, gap = 0) => a.right + gap <= b.x + 0.5 || b.right + gap <= a.x + 0.5
    || a.bottom + gap <= b.y + 0.5 || b.bottom + gap <= a.y + 0.5;
  assert.ok(['static', 'relative'].includes(title.position), 'title stays in normal document flow');
  assert.ok(title.x >= head.x - 1 && title.right <= actions.x - 8, 'long title reserves a separate right-hand save/close column');
  assert.ok(state.titleText.width <= title.width + 1 && title.scrollWidth <= title.clientWidth + 1,
    'long title wraps without horizontal clipping or overflow');
  assert.ok(separated(title, actions, 8), 'title never overlaps save/close, including long-title regressions');
  assert.ok(head.bottom <= tools.y + 1, 'POS toolbar occupies a separate row below title/save/close');
  assert.equal(tools.display, 'flex', 'metadata and optional generic speaker share a flex toolbar');
  assert.ok(tools.scrollWidth <= tools.clientWidth + 1, 'toolbar never overflows horizontally (metadata may wrap or scroll internally)');
  assert.ok(['normal', 'flex-start', 'start'].includes(tools.justifyContent), 'toolbar is left aligned, never space-between');
  assert.ok(Math.abs(meta.x - tools.x) <= 1 && Math.abs(title.x - tools.x) <= 1,
    'metadata and toolbar align with title on the left');
  assert.ok(actions.x >= head.x - 1 && actions.right <= head.right + 1
    && actions.y >= head.y - 1 && actions.bottom <= head.bottom + 1, 'save/close actions fit in title row');
  assert.ok(save.x >= actions.x - 1 && close.right <= actions.right + 1
    && Math.abs(save.y + save.height / 2 - close.y - close.height / 2) <= 1,
    'save and close share the top-right title action row');
  assert.ok(close.x - save.right >= 8 - 0.5, 'save precedes close with at least 8px horizontal spacing');
  if (speak) {
    assert.ok(speak.x >= tools.x - 1 && speak.right <= tools.right + 1
      && speak.y >= tools.y - 1 && speak.bottom <= tools.bottom + 1, 'generic speaker stays in POS toolbar');
    const sameRow = speak.y < meta.bottom && meta.y < speak.bottom;
    assert.ok(sameRow ? Math.abs(speak.x - meta.right - tools.columnGap) <= 1 : Math.abs(speak.x - tools.x) <= 1,
      'generic speaker follows metadata on the left, or wraps to the left edge');
    assert.ok(separated(speak, save, 8) && separated(speak, close, 8), 'generic speaker is separate from title actions');
  }
  if (state.viewport[0] < 768) {
    assert.equal(state.handle.height, 44, 'phone dismissal handle is a dedicated 44px hit band');
    assert.ok(Math.abs(state.handle.x - state.card.x) <= 1 && Math.abs(state.handle.right - state.card.right) <= 1,
      'phone handle spans the full card width, including horizontal padding');
    assert.ok(state.handle.points.every(point => point.inPadding), 'rounded-corner edge samples remain within left/right card padding');
    assert.ok(state.handle.points.every(point => point.hit), 'left padding, center and right padding hit the handle at both vertical quarters');
    assert.equal(state.handle.touchAction, 'none', 'handle owns its touch gesture');
    const minimum = state.viewport[1] <= 450 ? 64 : 96;
    assert.equal(state.primary.minHeight, `${minimum}px`, 'first meaning block reserves a natural phone swipe surface');
    assert.ok(state.primary.height >= minimum - 1, 'natural primary block is not shrunk to its clipped visible height');
    assert.equal(state.primary.alignContent, 'start', 'extra primary space stays below the meaning instead of stretching grid rows');
    assert.ok(Math.abs(state.primary.first.y - state.primary.y) <= 1, 'first meaning stays at the top of the primary surface');
    assert.equal(state.bodyMinHeight, '0px', 'constrained body can shrink while persistent controls remain visible');
    assert.ok(Math.abs(parseFloat(state.maxHeight) - state.viewport[1] * (state.viewport[1] <= 600 ? 0.92 : 0.8)) <= 1,
      'plain and context phone sheets use the increased viewport height budget');
    if (state.scroll[3] === 0) {
      assert.ok(state.primary.exposed.height > 0 && state.primary.exposed.width > 0,
        `primary has a real exposed clipped region: ${JSON.stringify(state.primary)}`);
      assert.ok(state.primary.points.length === 6 && state.primary.points.every(point => point.hit && !point.interactive),
        'predetermined primary positions hit noninteractive content without scrolling');
      // A small phone may show less than the natural 96/64px after header/footer
      // budgeting. Assert the intersection, never pretend all of that minimum is visible.
      const expectedExposure = Math.max(0, Math.min(state.primary.bottom, state.body.bottom, state.viewport[1])
        - Math.max(state.primary.y, state.body.y, 0));
      assert.ok(Math.abs(state.primary.exposed.height - expectedExposure) <= 1,
        'reported primary exposure is clipped to actual primary/body intersection after IPA');
    }
    assert.ok(state.handle.bottom <= head.y + 1, 'handle does not cover title or buttons');
    for (const button of buttons) assert.ok(button.width >= 44 && button.height >= 44,
      `${button.name} has a minimum 44x44px phone target: ${JSON.stringify(button)}`);
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
      assert.ok(separated(buttons[i], buttons[j], 8), `${buttons[i].name}/${buttons[j].name} have at least 8px separation`);
    }
  }
  return state;
}
async function coordinateTap(page, locator) {
  const point = await locator.evaluate(el => {
    // An inline word may wrap across two lines (e.g. soft-hyphenated doctor at 320px).
    // Its union box center can be blank paragraph space; use an actual painted fragment.
    const rects = [...el.getClientRects()];
    const r = rects.find(r => el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)))
      ?? el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const box = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, scrollTop: node.scrollTop };
    };
    const card = el.closest('[data-word-card]');
    return { x, y, hit: el.contains(hit), target: el.outerHTML.slice(0, 180), interceptedBy: hit?.outerHTML.slice(0, 180),
      scroll: [scrollX, scrollY], viewport: [innerWidth, innerHeight],
      card: box(card), body: box(card?.querySelector('[data-word-body]')),
      header: box(card?.querySelector('[data-word-header]')), footer: box(card?.querySelector('[data-word-footer]')) };
  });
  assert.ok(point.hit, `tap target is already exposed (no automatic scroll): ${JSON.stringify(point)}`);
  if (page.viewportSize().width < 768) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await settle(page);
}
async function exposeInBody(card, locator) {
  await locator.evaluate(el => {
    const body = el.closest('[data-word-body]');
    if (body) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
  });
}
async function collapsedDetails(card, isPhrase) {
  const feedback = card.locator('[data-feedback-toggle]');
  if (await feedback.count()) {
    assert.equal(await feedback.getAttribute('aria-expanded'), 'false', 'feedback starts collapsed on each word open/switch');
    assert.equal(await card.locator('[data-feedback-options]').isVisible(), false, 'feedback choices are initially hidden');
  }
  assert.equal(await card.locator('[data-part="word-alone"]').count(), 0, 'obsolete constituent-word disclosure never renders');
  assert.equal(await card.locator('[data-word-body] details[open]').count(), 0, 'every body disclosure resets on open/target change');
  for (const part of ['sentence-box', 'word-more'])
    assert.equal(await card.locator(`[data-part="${part}"]`).count(), 0, `${part} was removed from the card`);
  if (isPhrase) await targetContent(card, 'phrase');
}
async function targetContent(card, mode) {
  const isPhrase = mode === 'phrase';
  assert.equal(await card.locator('h2').innerText(), isPhrase ? phrase : 'odds', 'target changes card title');
  // The design system card has no part of speech line (WordCard: headword, IPA, meaning, credit).
  assert.equal(await card.locator('[data-word-pos]').count(), 0, 'no part of speech on the card');
  await pronunciationControls(card);
  assert.equal(await card.locator(`[data-part="${isPhrase ? 'phrase' : 'word'}-meaning"]`).innerText(),
    isPhrase ? fixture.phraseMeaning : fixture.wordMeaning, 'target changes primary meaning');
  assert.equal(await card.locator(`[data-part="${isPhrase ? 'word' : 'phrase'}-meaning"]`).count(), 0,
    'other target meaning is unmounted, not just hidden');
  assert.equal(await card.locator('[data-part="word-here"]').count(), 0, 'no "in this sentence" block on the card');
  assert.equal(await card.locator('[data-part="word-alone"]').count(), 0);
  const text = await card.innerText();
  if (isPhrase) {
    // textContent sees collapsed content too: hiding word facts in a disclosure is not sufficient.
    const all = await card.textContent();
    for (const wordFact of [fixture.wordWhy, fixture.wordExample, fixture.otherMeaning])
      assert.ok(!all.includes(wordFact), 'phrase mode never mounts constituent whyHard/example/other meanings');
    assert.equal(await card.locator('[data-part="word-more"] details').count(), 0,
      'phrase mode has neither constituent occurrence facts nor OtherMeanings disclosures');
    assert.ok(!all.includes(fixture.wordMeaning), 'phrase mode has no constituent meaning');
    assert.ok(all.includes(fixture.phraseExample), 'supplied phrase example is retained');
    assert.ok(!(await card.locator('[data-word-content]').textContent()).includes('40'),
      'phrase mode excludes the constituent 40-occurrence fact in either UI language');
  } else {
    assert.ok(!text.includes(fixture.phraseMeaning), 'word mode excludes phrase meaning');
    assert.ok(!(await card.textContent()).includes(fixture.phraseExample), 'word mode excludes phrase example');
    const all = await card.textContent();
    for (const wordFact of [fixture.wordWhy, fixture.wordExample, fixture.otherMeaning])
      assert.ok(!all.includes(wordFact), 'word mode no longer shows whyHard/example/other meanings');
  }
}
async function switchTarget(page, card, mode, key) {
  const before = await page.evaluate(() => [scrollX, scrollY]);
  const effects = await phoneEffects(page);
  const target = card.locator(`[data-look-target="${mode}"]`);
  if (key) {
    await target.evaluate(el => el.focus({ preventScroll: true }));
    await page.keyboard.press(key);
    await settle(page);
    assert.equal(await target.evaluate(el => document.activeElement === el), true, `${key} target activation retains focus`);
  } else await coordinateTap(page, target);
  await lookupTarget(card, mode);
  await targetContent(card, mode);
  await links(card, mode === 'phrase' ? phrase : 'odds');
  assert.equal((await metrics(card)).scrollTop, 0, 'target switch resets body scroll');
  await collapsedDetails(card, mode === 'phrase');
  assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), before, 'target switch never moves reader');
  assert.deepEqual(await phoneEffects(page), effects, 'target switch adds neither pronunciation nor word-tap telemetry');
  await cardChrome(page, card);
}
async function targetRoundTrip(page, card) {
  await lookupTarget(card, 'phrase');
  await targetContent(card, 'phrase');
  await switchTarget(page, card, 'word');
  await feedbackDisclosure(page, card, true);
  await card.locator('[data-word-body]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle(page);
  { const m = await metrics(card); assert.ok(m.maxScroll <= 0 || m.scrollTop > 0, 'whole-card switch begins scrolled when the body can scroll'); }
  await switchTarget(page, card, 'phrase');
  // Reveal the supplied phrase example without assuming whether it is a direct quote or in More.
  const example = card.locator('[data-part="example"]');
  assert.equal(await example.count(), 0, 'the card shows no second example');
  if (!(await example.count())) return;
  const exampleDetails = example.locator('xpath=ancestor::details[1]');
  if (await exampleDetails.count()) {
    const summary = exampleDetails.locator(':scope > summary');
    await exposeInBody(card, summary);
    await settle(page);
    await coordinateTap(page, summary);
  }
  await exposeInBody(card, example);
  await settle(page);
  assert.equal(await example.locator('blockquote').innerText(), fixture.phraseExample, 'phrase example is readable');
  await switchTarget(page, card, 'word', page.viewportSize().width >= 768 ? 'Enter' : undefined);
  await switchTarget(page, card, 'phrase', page.viewportSize().width >= 768 ? 'Space' : undefined);
}
async function feedbackDisclosure(page, card, leaveOpen = false) {
  const toggle = card.locator('[data-feedback-toggle]');
  assert.equal(await toggle.count(), 1, 'word card has one feedback question button');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'feedback begins collapsed');
  await exposeInBody(card, toggle);
  await settle(page);
  await coordinateTap(page, toggle);
  assert.equal(await card.count(), 1, 'feedback question click does not dismiss card');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'question button expands feedback');
  assert.equal(await card.locator('[data-feedback-options]').isVisible(), true, 'feedback choices become visible');
  await cardChrome(page, card); // Expanded footer and all options remain hit-testable, even on short phones.
  assert.ok((await metrics(card)).clientHeight > 0, 'expanded feedback leaves readable explanation space');
  // Do not choose a reason or submit feedback to a real endpoint.
  if (!leaveOpen) {
    await exposeInBody(card, toggle);
    await settle(page);
    await coordinateTap(page, toggle);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'question button collapses feedback again');
    assert.equal(await card.locator('[data-feedback-options]').isVisible(), false, 'feedback choices are hidden again');
    assert.equal(await card.count(), 1, 'feedback collapse does not dismiss card');
    assert.equal(await card.locator('[data-feedback-options]').count(), 0, 'collapsed choices cannot enter Tab order');
    if (page.viewportSize().width >= 768) {
      await toggle.focus();
      await page.keyboard.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'Enter expands focused feedback button');
      await page.keyboard.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Space collapses focused feedback button');
      assert.equal(await card.locator('[data-feedback-options]').count(), 0);
      assert.equal(await toggle.evaluate(el => document.activeElement === el), true, 'keyboard toggle retains focus');
      assert.equal(await card.count(), 1, 'keyboard feedback interaction does not dismiss');
      await settle(page);
    }
  }
  await cardChrome(page, card);
}
async function feedbackSubmission(page, card, reason, mode) {
  const requests = [];
  const endpoint = '**/api/feedback/word';
  const mock = async route => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  };
  await page.route(endpoint, mock);
  try {
    await feedbackDisclosure(page, card, true);
    const selector = reason === 'too_hard' ? '[data-feedback-too-hard]' : '[data-feedback-wrong]';
    await coordinateTap(page, card.locator(selector));
    await card.locator('[data-feedback-submitted]').waitFor({ state: 'visible' });
    assert.equal(await card.locator('[data-feedback-submitted]').getAttribute('role'), 'status', 'feedback acknowledges submission accessibly');
    assert.equal(await card.count(), 1, 'feedback reason click and acknowledgement never dismiss card');
    assert.equal(requests.length, 1, 'reason sends exactly one mocked request');
    assert.equal(requests[0].method, 'POST');
    const payload = requests[0].body;
    assert.equal(payload.reason, reason);
    assert.equal(payload.bookId, 'word-card-layout-regression');
    assert.equal(payload.bookTitle, 'Word card layout');
    assert.equal(payload.word, mode === 'phrase' ? phrase : 'odds', 'feedback names the displayed target');
    assert.equal(payload.form, mode === 'phrase' ? phrase : 'odds', 'feedback form matches phrase span or tapped word');
    assert.equal(payload.senseIndex, mode === 'phrase' ? -1 : 1, 'phrase never inherits constituent sense index');
    assert.equal(payload.chapter, 0);
    assert.equal(payload.paragraph, 10);
    assert.equal(payload.occurrence, 11);
    assert.ok(payload.context.includes('lantern seller'), 'feedback preserves reading context');
    assert.ok(payload.sentence.startsWith('Against all odds'), 'feedback keeps full source sentence');
    assert.equal(payload.senseMeaning, mode === 'phrase' ? fixture.phraseMeaning : fixture.wordMeaning,
      'feedback identifies only the displayed target meaning');
    assert.equal(await card.locator('[data-feedback-toggle]').count(), 0, 'thanks replaces question control');
    await cardChrome(page, card);
  } finally {
    await page.unroute(endpoint, mock);
  }
}
async function feedbackTargets(page, card, open) {
  for (const reason of ['too_hard', 'wrong_meaning']) {
    await open();
    await feedbackSubmission(page, card, reason, 'phrase');
    await switchTarget(page, card, 'word');
    assert.equal(await card.locator('[data-feedback-submitted]').count(), 0, 'phrase acknowledgement never leaks to word');
    await feedbackSubmission(page, card, reason, 'word');
    await switchTarget(page, card, 'phrase');
    assert.equal(await card.locator('[data-feedback-submitted]').count(), 0, 'word acknowledgement never leaks to phrase');
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
  }
  // A response for an unmounted target must not acknowledge the newly selected target.
  await open();
  const endpoint = '**/api/feedback/word';
  let release, received, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const requestSeen = new Promise(resolve => { received = resolve; });
  const responseDone = new Promise(resolve => { finished = resolve; });
  const delayed = async route => {
    received();
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    finished();
  };
  await page.route(endpoint, delayed);
  try {
    await feedbackDisclosure(page, card, true);
    await coordinateTap(page, card.locator('[data-feedback-wrong]'));
    await requestSeen;
    await switchTarget(page, card, 'word');
    release();
    await responseDone;
    await settle(page);
    assert.equal(await card.locator('[data-feedback-submitted]').count(), 0, 'late phrase response cannot acknowledge word feedback');
    await collapsedDetails(card, false);
    await switchTarget(page, card, 'phrase');
    assert.equal(await card.locator('[data-feedback-submitted]').count(), 0, 'returning phrase has fresh feedback despite late response');
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
  } finally {
    release();
    await page.unroute(endpoint, delayed);
  }
}
async function pronunciationTarget(page, card, mode) {
  const controls = await pronunciationControls(card);
  const beforeScroll = await page.evaluate(() => [scrollX, scrollY]);
  const saved = await card.locator('[data-word-save]').getAttribute('aria-pressed');
  const bodyScroll = await card.locator('[data-word-body]').evaluate(el => el.scrollTop);
  for (const accent of controls.localeOnly ? controls.accents : [null]) {
    const button = card.locator(accent ? `[data-speak-accent="${accent}"]` : '[data-word-header] [data-speak]');
    if (accent) {
      await exposeInBody(card, button);
      await settle(page);
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${accent} has a minimum 44x44 target after internal scroll`);
    }
    const before = await phoneEffects(page);
    await coordinateTap(page, button);
    const after = await phoneEffects(page);
    assert.equal(after.taps, before.taps, 'explicit speaker does not count as another reader-word tap');
    const urls = after.audios.slice(before.audios.length);
    const spoken = [...urls.map(url => new URL(url).searchParams.get('word')),
      ...after.voices.slice(before.voices.length)];
    assert.deepEqual(spoken, [mode === 'phrase' ? phrase : 'odds'], 'one speaker tap pronounces only displayed target');
    assert.equal(urls.every(url => new URL(url).hostname === 'uapis.cn'), true, 'speaker tap requests the uapis provider');
    if (accent) assert.deepEqual(urls.map(url => new URL(url).searchParams.get('accent')),
      [accent === 'UK' ? 'uk' : 'us'], `${accent} button requests only its selected recording`);
    assert.equal(await card.count(), 1, 'speaker interaction never dismisses the card');
    assert.equal(await card.locator('[data-word-save]').getAttribute('aria-pressed'), saved, 'speaker leaves save state unchanged');
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), beforeScroll, 'speaker internal reveal and playback never scroll reader');
  }
  await card.locator('[data-word-body]').evaluate((el, scrollTop) => { el.scrollTop = scrollTop; }, bodyScroll);
  await settle(page);
}
async function savedTargetsAndVariants(page, width, height) {
  const card = page.locator('[data-word-card]');
  const close = async () => {
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
  };
  const open = async (word, index = 10) => {
    const anchor = page.locator(`article [role="button"][data-word="${word}"] .book-tap`).nth(index);
    await position(page, anchor, 120);
    await coordinateTap(page, anchor);
    await card.waitFor({ state: 'visible' });
    if (word === 'odds') await card.locator('[data-part="phrase-meaning"]').waitFor();
    await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
    await settle(page);
  };
  const words = () => page.evaluate(() => JSON.parse(localStorage.getItem('cibian-notebook-v1')).state.words);
  const save = card.locator('[data-word-save]'); // Never use generic aria-pressed: target buttons have it too.
  const saved = async value => {
    assert.equal(await save.count(), 1, 'exactly one unambiguous save button');
    assert.equal(await save.getAttribute('aria-pressed'), String(value));
    assert.equal(await save.isEnabled(), true);
    assert.ok((await save.getAttribute('aria-label')).includes(await card.locator('h2').innerText()),
      'save accessible name identifies displayed target');
  };
  await open('odds');
  await saved(false);
  await pronunciationTarget(page, card, 'phrase');
  await coordinateTap(page, save);
  await saved(true);
  await switchTarget(page, card, 'word');
  await saved(false);
  await pronunciationTarget(page, card, 'word');
  await coordinateTap(page, save);
  await saved(true);
  const checkSaved = async () => {
    const all = await words();
    assert.deepEqual(all.map(word => word.lemma).sort(), [phrase, 'odds'].sort(), 'phrase and word save as two independent entries');
    const phraseWord = all.find(word => word.lemma === phrase);
    const plainWord = all.find(word => word.lemma === 'odds');
    assert.notEqual(phraseWord.id, plainWord.id);
    for (const [word, surface, pos, ref] of [[phraseWord, phrase, 'idiom', { list: 'custom', phrase: true }],
      [plainWord, 'odds', 'plural noun', { list: 'custom', chapter: 0, occurrence: 11 }]]) {
      assert.equal(word.sources.length, 1);
      const source = word.sources[0];
      assert.deepEqual(source.ref, ref, 'save points to the displayed phrase or anchored word sense');
      assert.equal(source.surface.toLowerCase(), surface);
      assert.equal(source.pos, pos);
      assert.equal(source.title, 'Word card layout');
      assert.equal(source.chapter, 0);
      assert.ok(source.sentence.startsWith('Against all odds') && source.sentence.includes('lantern seller'),
        'both saves retain the same original reader sentence');
      assert.ok(source.book, 'source retains book identity');
    }
    assert.equal(phraseWord.sources[0].book, plainWord.sources[0].book, 'separate targets retain same source book');
  };
  await checkSaved();
  await switchTarget(page, card, 'phrase');
  await saved(true);
  await coordinateTap(page, save); // Removing phrase must not remove the separately saved word.
  assert.deepEqual((await words()).map(word => word.lemma), ['odds']);
  await switchTarget(page, card, 'word');
  await saved(true);
  await coordinateTap(page, save);
  assert.deepEqual(await words(), []);
  await switchTarget(page, card, 'phrase');
  await saved(false);
  await coordinateTap(page, save);
  await switchTarget(page, card, 'word');
  await saved(false);
  await coordinateTap(page, save);
  await close();
  await page.reload();
  await page.locator('article [data-word="odds"]').first().waitFor();
  await page.keyboard.press('Escape');
  await open('odds');
  await lookupTarget(card, 'phrase');
  await collapsedDetails(card, true);
  await saved(true);
  await switchTarget(page, card, 'word');
  await saved(true);
  await checkSaved();
  await close();

  // A common word with no entry (doctor) shows the same no-meaning card as any other.
  for (const [word, index, status] of [['lantern', 10, 'ready'], ['doctor', 10, 'unknown'],
    ['quuxstone', 10, 'unknown'], ['fragile', 10, 'ready'], ['fragile', 9, 'unknown']]) {
    await open(word, index);
    assert.equal(await card.locator('h2').innerText(), word);
    assert.equal(await card.locator('[data-look-target-group]').count(), 0, 'non-phrase cards have no target toggle');
    await collapsedDetails(card, false);
    await links(card, word);
    assert.equal(await save.isEnabled(), status !== 'unknown', 'save availability follows word status');
    assert.equal(await save.getAttribute('aria-pressed'), 'false');
    assert.equal(await card.locator('[data-part="no-meaning"]').count(), status === 'unknown' ? 1 : 0);
    assert.equal(await card.locator('[data-feedback-toggle]').count(), 1, 'every word card offers feedback');
    if (status === 'unknown') {
      await card.locator('[data-feedback-toggle]').click();
      assert.equal(await card.locator('[data-feedback-missing]').count(), 1, 'a word with no meaning can be reported missing');
      assert.equal(await card.locator('[data-feedback-too-hard], [data-feedback-wrong]').count(), 0,
        'there is no meaning to call too hard or wrong');
      await card.locator('[data-feedback-toggle]').click();
    }
    if (word === 'lantern') assert.equal(await card.locator('[data-part="word-meaning"]').innerText(), 'A portable light.');
    if (word === 'fragile') {
      if (status === 'ready') assert.equal(await card.locator('[data-part="word-meaning"]').innerText(), fixture.sparseMeaning);
      else assert.ok(!(await card.textContent()).includes(fixture.sparseMeaning), 'senseOnly meaning never leaks outside its anchor');
    }
    await cardChrome(page, card);
    await close();
  }
  assert.equal(await page.locator('article [data-word="fragile"].book-hard').count(), 1,
    'senseOnly is underlined only at fixture anchor');
  await open('odds');
  await lookupTarget(card, 'phrase');
  await switchTarget(page, card, 'word');
  await close();
  await open('odds');
  await lookupTarget(card, 'phrase');
  await collapsedDetails(card, true);
  if ((width === 1280 && height === 800) || width === 820) {
    await close();
    await feedbackTargets(page, card, () => open('odds'));
  } else await close();

  await phraseWordAvailability(page, card);
  await page.goto(base + 'words');
  await page.locator('[data-word-sources]').first().waitFor();
  await page.reload();
  await page.locator('[data-word-sources]').first().waitFor();
  for (const [lemma, meaning, pos] of [[phrase, fixture.phraseMeaning, 'idiom'], ['odds', fixture.wordMeaning, 'noun']]) {
    const row = page.locator('li').filter({ has: page.getByRole('heading', { level: 3, name: lemma, exact: true }) });
    assert.equal(await row.count(), 1, 'notebook retains separate phrase and word rows after reload');
    await row.locator('[data-source-meaning]').filter({ hasText: meaning }).waitFor();
    assert.equal(await row.locator('[data-source-meaning]').innerText(), meaning, 'notebook resolves the correct target ref');
    assert.ok((await row.innerText()).includes(pos), 'notebook preserves target POS');
    assert.equal(await row.locator('[data-word-source]').count(), 1);
  }
  await checkSaved();
  console.log(`PASS ${width}x${height}: independent target save/remove/refs/reload/notebook, target pronunciation, plain/easy/unknown/senseOnly, default phrase reset`);
}
async function phraseWordAvailability(page, card) {
  // Add overlapping phrase coverage only after plain-word cases, retaining both paths.
  const cases = [
    { phrase: 'doctor discussed', word: 'doctor', index: 10, status: 'unknown', ref: undefined },
    { phrase: 'quuxstone lay by Hook’s bridge', word: 'quuxstone', index: 10, status: 'unknown', ref: undefined },
    { phrase: 'fragile lights', word: 'fragile', index: 9, status: 'unknown', ref: undefined },
    { phrase: 'fragile lights', word: 'fragile', index: 10, status: 'ready', ref: { list: 'custom', chapter: 0, occurrence: 11 } },
  ];
  await page.evaluate(async phrases => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('cibian-books', 3);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const notes = tx.objectStore('notes');
      const request = notes.get('extras:word-card-layout-regression');
      request.onsuccess = () => {
        const extras = request.result;
        for (const phrase of phrases) extras.phrases[phrase] = { pos: 'phrase', meaning: `Synthetic phrase meaning for ${phrase}.` };
        notes.put(extras, 'extras:word-card-layout-regression');
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, [...new Set(cases.map(test => test.phrase))]);
  await page.reload();
  await page.locator('article [data-word="odds"]').first().waitFor();
  await page.keyboard.press('Escape');
  const savedWords = () => page.evaluate(() => JSON.parse(localStorage.getItem('cibian-notebook-v1')).state.words);
  const gestures = surfaceViewport(page) ? await phoneGestures(page, page.viewportSize().width, page.viewportSize().height) : null;
  let stability;
  try {
  for (const test of cases) {
    const anchor = page.locator(`article [data-word="${test.word}"] .book-tap`).nth(test.index);
    await position(page, anchor, 120);
    // Unknown phrase/word is the shortest switched surface and gets the full
    // open/mode/drag/snap-back/close reader stability run in both UI languages.
    stability = gestures && test.word === 'quuxstone' ? await readerStability(page) : null;
    await coordinateTap(page, anchor);
    await card.locator('[data-part="phrase-meaning"]').waitFor();
    await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
    await settle(page);
    const save = card.locator('[data-word-save]');
    const phraseMeaning = `Synthetic phrase meaning for ${test.phrase}.`;
    if (stability) {
      await stability.check('unknown phrase open');
      await surfaceDrag(page, card, gestures, 0, 'unknown phrase fixed primary position', stability);
    }
    await lookupTarget(card, 'phrase');
    assert.equal(await card.locator('h2').innerText(), test.phrase);
    assert.equal(await card.locator('[data-part="phrase-meaning"]').innerText(), phraseMeaning);
    assert.equal(await save.isEnabled(), true, 'known phrase can save even when its tapped word cannot');
    assert.equal(await save.getAttribute('aria-pressed'), 'false');
    await coordinateTap(page, save);
    const phraseEntry = (await savedWords()).find(word => word.lemma === test.phrase);
    assert.deepEqual(phraseEntry.sources[0].ref, { list: 'custom', phrase: true });
    if (test.word === 'quuxstone') {
      const endpoint = '**/api/feedback/word';
      const payloads = [];
      const mock = async route => {
        payloads.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      };
      await page.route(endpoint, mock);
      try {
        await feedbackDisclosure(page, card, true);
        await coordinateTap(page, card.locator('[data-feedback-wrong]'));
        await card.locator('[data-feedback-submitted]').waitFor();
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].word, test.phrase);
        assert.equal(payloads[0].form, test.phrase.toLowerCase(), 'curly apostrophe preserves entire matched phrase form');
        assert.equal(payloads[0].senseIndex, -1);
        assert.equal(payloads[0].senseMeaning, phraseMeaning);
      } finally { await page.unroute(endpoint, mock); }
    }
    const switchMode = async mode => {
      const scroll = await page.evaluate(() => [scrollX, scrollY]);
      const effects = await phoneEffects(page);
      await coordinateTap(page, card.locator(`[data-look-target="${mode}"]`));
      await lookupTarget(card, mode);
      await collapsedDetails(card, false);
      assert.equal((await metrics(card)).scrollTop, 0);
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scroll);
      assert.deepEqual(await phoneEffects(page), effects);
      await cardChrome(page, card);
      if (stability) await stability.check(`unknown switched to ${mode}`);
    };
    await switchMode('word');
    if (gestures && (test.word !== 'fragile' || test.status === 'ready')) {
      const slot = test.word === 'quuxstone' ? 2 : test.word === 'doctor' ? 0 : 1;
      await surfaceDrag(page, card, gestures, slot, `${test.status} phrase-to-word fixed primary position`, stability);
    }
    assert.equal(await card.locator('h2').innerText(), test.word);
    await links(card, test.word);
    assert.equal(await card.locator('[data-part="phrase-meaning"]').count(), 0);
    assert.equal(await save.getAttribute('aria-pressed'), 'false', 'phrase save never marks constituent word saved');
    assert.equal(await save.isEnabled(), test.status !== 'unknown', 'phrase presence never bypasses word save gating');
    assert.equal(await card.locator('[data-part="no-meaning"]').count(), test.status === 'unknown' ? 1 : 0);
    assert.equal(await card.locator('[data-feedback-toggle]').count(), 1);
    if (test.word === 'fragile' && test.status === 'unknown')
      assert.ok(!(await card.textContent()).includes(fixture.sparseMeaning), 'recognized phrase cannot leak out-of-scope senseOnly meaning');
    if (test.status !== 'unknown') {
      if (test.status === 'ready') assert.equal(await card.locator('[data-part="word-meaning"]').innerText(), fixture.sparseMeaning);
      await coordinateTap(page, save);
      const wordEntry = (await savedWords()).find(word => word.lemma === test.word);
      assert.deepEqual(wordEntry.sources[0].ref, test.ref, 'constituent save uses its own word pointer, never phrase ref');
      assert.notEqual(wordEntry.id, phraseEntry.id);
      await coordinateTap(page, save);
      assert.ok((await savedWords()).some(word => word.lemma === test.phrase), 'removing constituent word retains phrase');
    } else assert.ok(!(await savedWords()).some(word => word.lemma === test.word));
    await switchMode('phrase');
    if (stability) await surfaceDrag(page, card, gestures, 1, 'unknown word-to-phrase fixed primary position', stability);
    assert.equal(await save.isEnabled(), true);
    assert.equal(await save.getAttribute('aria-pressed'), 'true', 'phrase remains independently saved');
    await coordinateTap(page, save);
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
    await settle(page);
    if (stability) {
      await stability.check('unknown phrase close');
      await stability.stop();
      stability = null;
    }
  }
  } finally {
    if (stability) await stability.stop();
    if (gestures) await gestures.detach();
  }
}
async function lookupTarget(card, mode) {
  assert.equal(await card.locator('[data-look-target-group]').count(), 1, 'exactly one whole-card target group');
  assert.equal(await card.locator('[data-word-header] [data-look-target-group]').count(), 1,
    'whole-card target group is in persistent header');
  assert.equal(await card.locator('[data-word-footer] [data-look-target-group]').count(), 0,
    'footer no longer owns target switch');
  assert.equal(await card.locator('[data-look-target-group]').getAttribute('role'), 'group');
  for (const target of ['word', 'phrase']) {
    const button = card.locator(`[data-look-target="${target}"]`);
    assert.equal(await button.count(), 1, `one ${target} target control`);
    assert.equal(await button.evaluate(el => el.tagName), 'BUTTON');
    assert.notEqual(await button.getAttribute('role'), 'radio');
    assert.equal(await button.getAttribute('aria-checked'), null);
    assert.equal(await button.getAttribute('aria-pressed'), String(target === mode));
  }
}
// Test-only sound/analytics recorders, installed before app code. Keep the collector's
// real buffering path: capture only its 15-minute timer and flush it deterministically.
// A positive open below must produce audio AND a real collector payload, so silence
// on dismissal cannot pass merely because analytics or playback was never observed.
async function installPhoneRecorders(page) {
  await page.addInitScript(() => {
    const state = { audios: [], voices: [], batches: [] };
    window.__wordCardEffects = state;
    HTMLMediaElement.prototype.play = function () {
      state.audios.push(this.src || this.getAttribute('src') || '');
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false, pending: false, speaking: false, getVoices: () => [],
      cancel() {}, resume() {}, speak(utterance) { state.voices.push(utterance.text); },
    } });
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (url.origin === location.origin && url.pathname === '/api/analytics/word-taps') {
        state.batches.push(JSON.parse(init.body));
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return fetch(input, init);
    };
    const setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
    const pending = new Map();
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 15 * 60 * 1000 || typeof callback !== 'function') return setTimeout(callback, delay, ...args);
      const id = setTimeout(() => {
        pending.delete(id);
        callback(...args);
      }, delay);
      pending.set(id, () => callback(...args));
      return id;
    };
    window.clearTimeout = id => { pending.delete(id); clearTimeout(id); };
    window.__flushWordCardTaps = () => {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        clearTimeout(id);
        callback();
      }
    };
  });
}
async function phoneEffects(page) {
  return page.evaluate(async () => {
    window.__flushWordCardTaps();
    await Promise.resolve();
    const state = window.__wordCardEffects;
    const taps = state.batches.flatMap(batch => batch.taps);
    return { audios: [...state.audios], voices: [...state.voices],
      taps: taps.reduce((sum, tap) => sum + tap.count, 0),
      words: taps.map(tap => [tap.word, tap.count]) };
  });
}
// Independent reader geometry is stronger than CLS alone: recent-input shifts
// may be excluded from CLS, while this fixture must not move at all during a drag.
async function readerStability(page) {
  await page.evaluate(() => {
    const article = document.querySelector('article');
    const rect = node => {
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    };
    const nodes = [article, ...[9, 10, 11].map(i => article.querySelectorAll('p')[i]),
      ...['odds', 'quuxstone', 'fragile'].map(word => article.querySelectorAll(`[data-word="${word}"]`)[10])];
    if (nodes.some(node => !node)) throw new Error('Synthetic reader stability anchors are missing');
    const shifts = [];
    const collect = entries => {
      for (const entry of entries) {
        // Keep only text-bearing reader sources; overlay animation is not reader
        // layout. Include hadRecentInput entries instead of relying on CLS rules.
        const sources = (entry.sources ?? []).filter(source => source.node && article.contains(source.node)
          && (source.node.nodeType === Node.TEXT_NODE || source.node.textContent?.trim()));
        if (sources.length) shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput,
          sources: sources.map(source => ({ text: source.node.textContent.slice(0, 80),
            before: [source.previousRect.x, source.previousRect.y, source.previousRect.width, source.previousRect.height],
            after: [source.currentRect.x, source.currentRect.y, source.currentRect.width, source.currentRect.height] })) });
      }
    };
    let observer;
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
      observer = new PerformanceObserver(list => collect(list.getEntries()));
      observer.observe({ type: 'layout-shift', buffered: false });
    }
    window.__wordCardReaderProbe = {
      snapshot() {
        if (observer) collect(observer.takeRecords());
        const root = document.documentElement, body = document.body;
        return { boxes: nodes.map(rect), fragments: nodes.slice(-3).map(node => [...node.getClientRects()].map(r => [r.x, r.y, r.width, r.height])),
          window: [scrollX, scrollY, innerWidth, innerHeight],
          visual: visualViewport ? [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.width, visualViewport.height, visualViewport.scale] : null,
          document: [root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight, root.scrollLeft, root.scrollTop,
            body.clientWidth, body.clientHeight, body.scrollWidth, body.scrollHeight, body.scrollLeft, body.scrollTop], shifts: [...shifts] };
      },
      stop() { observer?.disconnect(); },
    };
  });
  const baseline = await page.evaluate(() => window.__wordCardReaderProbe.snapshot());
  return {
    async check(label) {
      const state = await page.evaluate(() => window.__wordCardReaderProbe.snapshot());
      assert.deepEqual(state.shifts, [], `${label}: no text-bearing reader layout-shift sources`);
      assert.deepEqual(state, baseline, `${label}: article, paragraphs, word fragments, window and document geometry stay fixed`);
    },
    async stop() {
      await page.evaluate(() => { window.__wordCardReaderProbe.stop(); delete window.__wordCardReaderProbe; });
    },
  };
}
async function phoneGestures(page, width, height) {
  const card = page.locator('[data-word-card]');
  const body = card.locator('[data-word-body]');
  const cdp = await page.context().newCDPSession(page);
  const handle = card.locator('[data-sheet-handle]');
  const excluded = 'a, button, input, textarea, select, summary, [role="button"], [data-word-footer]';
  // Observe trusted events without cancelling them ourselves. A deferred task
  // reads defaultPrevented after propagation (microtasks can run BETWEEN native
  // listeners, before the production handler has had its turn).
  const observe = () => page.evaluate(() => {
    if (window.__sheetGestureObserver) return;
    window.__sheetGestureObserver = true;
    window.__sheetGestureEvents = [];
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointercancel']) {
      document.addEventListener(type, event => {
        const record = { type, trusted: event.isTrusted, cancelable: event.cancelable,
          defaultPrevented: event.defaultPrevented, touches: event.touches?.length,
          target: event.target instanceof Element ? event.target.outerHTML.slice(0, 180) : '' };
        window.__sheetGestureEvents.push(record);
        setTimeout(() => { record.defaultPrevented = event.defaultPrevented; }, 0);
      }, { capture: true, passive: true });
    }
  });
  await observe();
  let lastGesture;
  const diagnostics = () => JSON.stringify(lastGesture);
  const touch = (type, x, y, multi = false) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? []
      : [{ x, y, id: 1 }, ...(multi ? [{ x: x + 24, y, id: 2 }] : [])],
  });
  const safeOrigin = async (target, dy) => target.evaluate((el, { dy, excluded }) => {
    const r = el.getBoundingClientRect();
    const ys = dy >= 0 ? [r.top + 5, r.top + r.height / 2, r.bottom - 5]
      : [r.bottom - 5, r.top + r.height / 2, r.top + 5];
    for (const y of ys) for (const x of [r.left + r.width / 2, r.left + 5, r.right - 5]) {
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && !hit.closest(excluded)) return { x, y };
    }
    return null;
  }, { dy, excluded });
  const drag = async (dy, { target = body, origin, end = 'touchEnd', dx = 0, multi = false,
    secondFinger = false, returnToOrigin = false, expected = 'still', label = 'gesture', stability } = {}) => {
    await observe(); // Reinstall after the optional noList fixture reload.
    origin ??= await safeOrigin(target, dy);
    assert.ok(origin, `${label}: a noninteractive real hit origin is exposed`);
    const { x, y } = origin;
    const distance = Math.max(Math.abs(dy), Math.abs(dx));
    // A large first CDP move can hide lost native touch ownership. Exercise the
    // slow 2/4/6/10px lead-in before crossing Chromium's scrolling slop.
    const distances = [...new Set([2, 4, 6, 10, ...[0.25, 0.5, 0.75, 1].map(f => distance * f)])]
      .filter(value => value <= distance).sort((a, b) => a - b);
    const path = distances.map(value => ({ x: x + dx * value / distance, y: y + dy * value / distance }));
    if (returnToOrigin) path.push({ x, y: y + dy / 2 }, { x, y: y + 4 }, { x, y });
    assert.ok([origin, ...path].every(p => p.y > 0 && p.y < height && p.x > 0
      && p.x + (multi || secondFinger ? 24 : 0) < width), `${label}: every touch stays inside viewport`);
    assert.ok(await target.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), origin),
      `${label}: origin hit-tests without locator auto-scroll`);
    await page.evaluate(() => { window.__sheetGestureEvents = []; });
    lastGesture = { label, origin, path, samples: [] };
    await touch('touchStart', x, y, multi);
    const sample = async stage => {
      const state = await card.evaluate(el => ({
        translation: new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
        scrollTop: el.querySelector('[data-word-body]').scrollTop,
      }));
      lastGesture.samples.push({ stage, ...state });
      if (stability) await stability.check(`${label} ${stage}`);
      return state.translation;
    };
    try {
      for (const point of path) {
        await touch('touchMove', point.x, point.y, multi);
        await page.waitForTimeout(35);
        await sample('move');
      }
      if (secondFinger) {
        const point = path.at(-1);
        await touch('touchStart', point.x, point.y, true);
        await touch('touchMove', point.x, point.y + 2, true);
        await page.waitForTimeout(220);
        await sample('second-finger');
      }
      const pulled = await sample('before-release');
      lastGesture.events = await page.evaluate(() => window.__sheetGestureEvents);
      const maxPull = Math.max(...lastGesture.samples.filter(s => s.stage === 'move').map(s => s.translation));
      if (expected === 'pull') assert.ok(maxPull >= Math.min(30, dy - 2),
        `${label}: sheet follows the finger DURING trusted drag; ${diagnostics()}`);
      else assert.ok(lastGesture.samples.every(s => Math.abs(s.translation) < 1),
        `${label}: never translates during gesture; ${diagnostics()}`);
      if (expected === 'pull') assert.ok(lastGesture.events.some(event => event.type === 'touchmove'
        && event.trusted && event.cancelable && event.defaultPrevented),
        `${label}: production owns a cancelable native touchmove; ${diagnostics()}`);
      if (expected === 'pull' && dy > 72) assert.ok(maxPull > 72,
        `${label}: visibly crosses 72px before release; ${diagnostics()}`);
      if (returnToOrigin || secondFinger) assert.ok(Math.abs(pulled) < 1,
        `${label}: returns to origin before release; ${diagnostics()}`);
      assert.ok(lastGesture.events.some(event => event.type === 'touchmove' && event.trusted),
        `${label}: requires trusted browser touchmoves; ${diagnostics()}`);
      return pulled;
    } finally {
      await touch(end);
      // Dismissal uses a 160ms timer and snap-back a 180ms transition.
      await page.waitForTimeout(260);
      lastGesture.events = await page.evaluate(() => window.__sheetGestureEvents);
      if (stability) await stability.check(`${label} released/snap-back`);
    }
  };
  const remains = async label => {
    assert.equal(await card.count(), 1, `${label} does not dismiss; ${diagnostics()}`);
    assert.ok(await card.evaluate(el => Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42) < 1),
      `${label} leaves sheet in its original position; ${diagnostics()}`);
    await cardChrome(page, card);
  };
  const dismissed = async label => {
    assert.equal(await card.count(), 0, `${label} dismisses after visibly following the finger; ${diagnostics()}`);
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
  return { drag, remains, dismissed, open, diagnostics, detach: () => cdp.detach() };
}
// Keep slow trusted additions to the narrow portrait + short landscape pair;
// these cover both languages while the complete matrix still runs all old guards.
const surfaceViewport = page => [320, 667].includes(page.viewportSize().width);
async function surfaceDrag(page, card, gestures, slot, label, stability) {
  const state = await cardChrome(page, card);
  assert.equal(state.scroll[3], 0, `${label}: surface is measured at body scroll zero`);
  const r = state.primary.exposed;
  // Predetermined, not a search for whichever lone pixel happens to work.
  const [fx, fy] = [[0.15, 0.25], [0.5, 0.5], [0.85, 0.75]][slot % 3];
  const origin = { x: r.x + r.width * fx, y: r.y + r.height * fy };
  assert.ok(r.width > 0 && r.height > 0 && state.primary.points.every(point => point.hit && !point.interactive),
    `${label}: actual clipped primary surface is exposed at multiple fixed positions`);
  const effects = await phoneEffects(page);
  await gestures.drag(40, { target: card.locator('[data-word-primary]'), origin, expected: 'pull', label, stability });
  await gestures.remains(label);
  const after = await cardChrome(page, card);
  assert.deepEqual(after.scroll, state.scroll, `${label}: no reader, sheet or body scrolling after snap-back`);
  assert.deepEqual(after.head, state.head, `${label}: header returns to its exact box`);
  assert.deepEqual(after.footer, state.footer, `${label}: footer controls retain their exact box`);
  assert.deepEqual(await phoneEffects(page), effects, `${label}: no pronunciation or word-tap telemetry`);
  return state;
}
async function phoneSurfaceRegression(page, width, height) {
  const card = page.locator('[data-word-card]');
  const gestures = await phoneGestures(page, width, height);
  const close = async () => {
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
    await settle(page);
  };
  try {
    for (const [slot, word] of ['quuxstone', 'doctor', 'fragile'].entries()) {
      const anchor = page.locator(`article [data-word="${word}"] .book-tap`).nth(10);
      await position(page, anchor, 120);
      // Capture before open, not after the overlay has already had a chance to
      // shift the reader. Do not reposition the page until this probe is stopped.
      const stability = await readerStability(page);
      try {
        await coordinateTap(page, anchor);
        await card.waitFor({ state: 'visible' });
        await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
        await settle(page);
        await stability.check(`${word} open`);
        assert.equal(await card.locator('h2').innerText(), word);
        await collapsedDetails(card, false);
        assert.equal(await card.locator('[data-look-target-group]').count(), 0, 'plain sparse fixtures have no phrase switch');
        assert.equal(await card.locator('[data-part="word-here"]').count(), 0, 'sparse surface has no contextual filler');
        if (word === 'quuxstone' || word === 'doctor') {
          assert.equal(await card.locator('[data-part="no-meaning"]').count(), 1, `${word}: no entry, so no meaning`);
          assert.equal(await card.locator('[data-word-save]').isEnabled(), false, 'unknown save stays gated');
          assert.equal(await card.locator('[data-word-pos]').count(), 0, 'no easy-word label');
        }
        if (word === 'fragile') assert.equal(await card.locator('[data-part="word-meaning"]').innerText(), fixture.sparseMeaning);
        if (word === 'fragile') assert.equal(await card.locator('[data-word-save]').isEnabled(), true);
        const effects = await phoneEffects(page);
        await surfaceDrag(page, card, gestures, slot, `${word} fixed primary position`, stability);
        // Every sparse status gets a second fixed origin, never safeOrigin's
        // first lucky noninteractive point in an otherwise occluded surface.
        await surfaceDrag(page, card, gestures, (slot + 2) % 3, `${word} second fixed primary position`, stability);
        assert.deepEqual(await phoneEffects(page), effects, 'surface gestures add no audio or word telemetry');
        await close();
        await stability.check(`${word} close`);
      } finally { await stability.stop(); }
    }
    // Release beyond threshold from a fixed primary point too: a snap-back alone
    // cannot prove the sparse body can actually dismiss rather than just animate.
    const unknown = await gestures.open('quuxstone');
    const exposed = unknown.primary.exposed;
    await gestures.drag(100, { target: card.locator('[data-word-primary]'),
      origin: { x: exposed.x + exposed.width * 0.5, y: exposed.y + exposed.height * 0.25 },
      expected: 'pull', label: 'unknown fixed primary dismissal' });
    await gestures.dismissed('unknown fixed primary dismissal');
    // Exercise both padding ends, not merely the visible center grip. Geometry
    // above already probes six positions including the full 44px band.
    for (const side of ['left', 'right']) {
      const state = await gestures.open('quuxstone');
      const origin = { x: side === 'left' ? state.card.x + 5 : state.card.right - 5,
        y: state.handle.y + state.handle.height * (side === 'left' ? 0.25 : 0.75) };
      const effects = await phoneEffects(page);
      await gestures.drag(100, { target: card.locator('[data-sheet-handle]'), origin, expected: 'pull',
        label: `unknown full-width handle ${side} padding dismissal` });
      await gestures.dismissed(`unknown ${side} padding`);
      assert.deepEqual(await phoneEffects(page), effects, 'handle dismissal adds no audio or word telemetry');
    }
    if (process.env.WORD_CARD_NO_LIST === '1') {
      // loadStoredBook overlays books.glossary with notes[`gloss:${id}`]. A
      // prior shelf load may already have migrated that metadata; clearing only
      // the legacy book field therefore does not produce a no-list reader.
      // Save/restore both exact fixture records (including metadata absence).
      // extras is deliberately untouched: it has reader notes, not this list.
      const originalList = await page.evaluate(async () => {
        const id = 'word-card-layout-regression', key = `gloss:${id}`;
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open('cibian-books', 3);
          open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
        });
        const original = {};
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(['books', 'notes'], 'readwrite');
            const books = tx.objectStore('books'), notes = tx.objectStore('notes');
            const book = books.get(id), meta = notes.get(key);
            let bookReady = false, metaReady = false;
            const replace = () => {
              if (!bookReady || !metaReady) return;
              if (!original.book) { tx.abort(); return; }
              const empty = { glossary: {}, pending: [], totalHard: 0 };
              books.put({ ...original.book, ...empty }, id);
              notes.put({ ...(original.hasMeta ? original.meta : {
                id, title: original.book.title, author: original.book.author,
              }), ...empty }, key);
            };
            book.onsuccess = () => { original.book = book.result; bookReady = true; replace(); };
            meta.onsuccess = () => {
              original.hasMeta = meta.result !== undefined;
              original.meta = meta.result ?? null;
              metaReady = true; replace();
            };
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('Missing synthetic noList book'));
          });
          return original;
        } finally { db.close(); }
      });
      try {
        await page.reload();
        await page.locator('article [data-word="quuxstone"]').first().waitFor();
        // Reload brings back the saved-position ResizeObserver hold and reloads
        // reader fonts. Let fonts/layout finish first, then release that hold,
        // exactly as initial phone setup does, before manual fixture positioning.
        // Otherwise opening the overlay can deliver a late body resize and move
        // the reader to the saved position during the first measured gesture.
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        await page.keyboard.press('Escape');
        await settle(page);
        await gestures.open('quuxstone');
        const notice = card.locator('[data-part="no-meaning"] > span');
        assert.equal(await notice.count(), 1, 'noList notice accompanies unknown status');
        assert.ok((await notice.innerText()).trim(), 'noList notice is localized and nonempty');
        await surfaceDrag(page, card, gestures, 1, 'noList fixed primary position');
        await close();
      } finally {
        await page.evaluate(async original => {
          const id = 'word-card-layout-regression', key = `gloss:${id}`;
          const db = await new Promise((resolve, reject) => {
            const open = indexedDB.open('cibian-books', 3);
            open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction(['books', 'notes'], 'readwrite');
              tx.objectStore('books').put(original.book, id);
              if (original.hasMeta) tx.objectStore('notes').put(original.meta, key);
              else tx.objectStore('notes').delete(key);
              tx.oncomplete = resolve;
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error ?? new Error('Synthetic noList restore aborted'));
            });
          } finally { db.close(); }
        }, originalList);
        await page.reload();
        await page.locator('article [data-word="odds"]').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        await page.keyboard.press('Escape');
        await settle(page);
      }
    }
  } finally { await gestures.detach(); }
  console.log(`PASS ${width}x${height}: sparse/easy/unknown clipped primary geometry, fixed-position trusted drags, full-width handle padding, synthetic reader layout stability${process.env.WORD_CARD_NO_LIST === '1' ? ', noList' : ''}`);
}
async function phoneRegression(page, width, height) {
  const card = page.locator('[data-word-card]');
  const body = card.locator('[data-word-body]');
  const handle = card.locator('[data-sheet-handle]');
  const gestures = await phoneGestures(page, width, height);
  const { drag, remains, dismissed, open, diagnostics } = gestures;
  assert.deepEqual(await page.evaluate(() => [matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints > 0]),
    [true, true], 'phone context really has mobile touch input');
  let initial = await open('odds');
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
  await targetRoundTrip(page, card);
  await switchTarget(page, card, 'word');
  initial = await cardChrome(page, card); // Whole-card mode legitimately changes chrome height; expansion must not.
  await feedbackDisclosure(page, card, true);
  // The short card may fit without scrolling. Cap the real body (no added content) so the
  // touch checks below run against an actual scroller; the next open remounts a fresh body.
  if ((await metrics(card)).maxScroll <= 32)
    await body.evaluate(el => { el.style.maxHeight = `${Math.min(el.clientHeight, 120)}px`; });
  await settle(page);
  assert.ok((await metrics(card)).maxScroll > 32, 'capped body can scroll');
  initial = await cardChrome(page, card);
  await body.evaluate(el => { el.scrollTop = 0; });
  const r = await body.boundingBox();
  await drag(-Math.min(100, r.height - 24), { label: 'native upward body scroll' });
  assert.ok(await body.evaluate(el => el.scrollTop) > 0, 'trusted upward touch scrolls the real body');
  const scrolled = await cardChrome(page, card);
  assert.deepEqual(scrolled.head, initial.head, 'internal scroll keeps header fixed');
  assert.deepEqual(scrolled.footer, initial.footer, 'internal scroll keeps footer fixed');
  assert.deepEqual(scrolled.scroll.slice(0, 3), initial.scroll.slice(0, 3), 'touch scroll leaves reader and outer sheet still');
  await body.evaluate(el => { el.scrollTop = 32; });
  await drag(100, { label: 'body scrolled at gesture start' });
  await remains('body scrolled at gesture start');
  assert.equal(await body.evaluate(el => el.scrollTop), 0, 'same gesture reaches top without becoming dismissal');
  await drag(100, { expected: 'pull', label: 'separate body-at-top downward drag' });
  await dismissed('separate body-at-top downward drag');
  await open('odds');
  const title = card.locator('[data-word-title]');
  for (const [label, target] of [['title', title], ['body', body], ['handle', handle]]) {
    await drag(40, { target, expected: 'pull', label: `short ${label} drag` });
    await remains(`short ${label} drag`);
    await drag(100, { target, expected: 'pull', end: 'touchCancel', label: `${label} cancellation beyond threshold` });
    await remains(`${label} cancellation beyond threshold`);
  }
  await drag(100, { target: title, expected: 'pull', returnToOrigin: true, label: 'title return-to-origin drag' });
  await remains('title return-to-origin drag');
  await drag(12, { target: handle, dx: 90, label: 'horizontal handle gesture' });
  await remains('horizontal handle gesture');
  await drag(100, { target: title, multi: true, label: 'two fingers from start' });
  await remains('two fingers from start');
  await drag(100, { target: title, expected: 'pull', secondFinger: true, label: 'second finger after active drag' });
  await remains('second finger after active drag');
  // IPA builds put the UK/US speakers under the title instead of one header speaker.
  const speak = card.locator(requireIpa ? '[data-speak]' : '[data-word-header] [data-speak]').first();
  const speakBox = await speak.boundingBox();
  await drag(100, { target: speak, origin: { x: speakBox.x + speakBox.width / 2, y: speakBox.y + 5 },
    label: 'button-origin downward drag' });
  await remains('button-origin downward drag');
  const footer = card.locator('[data-word-footer]');
  const footerBox = await footer.boundingBox();
  // Near-bottom checks must not accidentally leave the viewport and become cancellation tests.
  const footerOrigin = { x: footerBox.x + 2, y: footerBox.y + 3 };
  await drag(Math.min(40, height - footerOrigin.y - 4), { target: footer, origin: footerOrigin,
    label: 'excluded footer short downward drag' });
  await remains('excluded footer short downward drag');
  const blank = await card.evaluate(el => {
    const r = el.getBoundingClientRect();
    const h = el.querySelector('[data-word-head]').getBoundingClientRect();
    const x = r.left + 5, y = h.top + 5;
    return { x, y, blank: document.elementFromPoint(x, y) === el };
  });
  assert.ok(blank.blank, 'sheet padding origin is real blank space, not a title or handle descendant');
  await drag(100, { target: card, origin: blank, expected: 'pull', label: 'noninteractive padding blank drag' });
  await dismissed('noninteractive padding blank drag');
  await open('odds');
  await drag(100, { target: title, expected: 'pull', label: 'header title downward drag' });
  await dismissed('header title downward drag');
  await open('odds');
  await drag(100, { target: handle, expected: 'pull', label: 'handle downward drag' });
  await dismissed('handle downward drag');
  // Constrain existing title/meta scrollers, without adding content or synthetic
  // touch events. This deterministically exercises real ancestor scrollTop locks
  // even when this viewport's normal fixture needs no header scrolling.
  for (const part of ['title', 'meta']) {
    await open('odds');
    const scroller = card.locator(`[data-word-${part}]`);
    const previous = await scroller.getAttribute('style');
    await scroller.evaluate(el => { el.style.maxHeight = '12px'; el.style.overflowY = 'auto'; el.scrollTop = 4; });
    await settle(page);
    assert.ok(await scroller.evaluate(el => el.scrollTop) > 0, `${part} has an actual scrolled ancestor at START`);
    await drag(100, { target: scroller, label: `scrolled ${part} downward gesture` });
    assert.equal(await card.count(), 1, `scrolled ${part} stays open; ${diagnostics()}`);
    assert.equal(await scroller.evaluate(el => el.scrollTop), 0, `${part} reaches top but stays scroll-locked`);
    await scroller.evaluate((el, previous) => {
      if (previous === null) el.removeAttribute('style'); else el.setAttribute('style', previous);
    }, previous);
    await settle(page);
    await remains(`scrolled ${part} gesture after reaching top`);
    await drag(100, { target: scroller, expected: 'pull', label: `separate ${part}-at-top drag` });
    await dismissed(`separate ${part}-at-top drag`);
  }
  // Actual phone word taps close first; a later, separate tap opens with fresh state.
  await open('odds');
  await collapsedDetails(card, true);
  await switchTarget(page, card, 'word');
  await feedbackDisclosure(page, card, true);
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle(page);
  { const m = await metrics(card); assert.ok(m.maxScroll <= 0 || m.scrollTop > 0, 'word switch starts scrolled when the body can scroll'); }
  await cardChrome(page, card);
  if (width === 430) {
    // Same-line targets are exposed above the sheet at this viewport. Do not use
    // locator.tap(): its auto-scroll could dismiss the sheet before the actual tap.
    const phraseAnchor = page.locator('article [role="button"][data-word="odds"] .book-tap').nth(10);
    const nextAnchor = page.locator('article [role="button"][data-word="lantern"] .book-tap').nth(10);
    const readerScroll = await page.evaluate(() => [scrollX, scrollY]);
    const baseline = await phoneEffects(page);
    assert.ok(baseline.audios.length + baseline.voices.length > 0, 'real word opens are observed by audio recorder');
    assert.ok(baseline.taps > 0 && baseline.words.some(([word]) => word === 'odds'),
      'real word opens reach the deterministic production telemetry collector');
    const dismissOnly = async (anchor, label) => {
      const originalBody = await body.elementHandle();
      const effects = await phoneEffects(page);
      await coordinateTap(page, anchor);
      await card.waitFor({ state: 'detached' });
      await page.waitForTimeout(260); // Include delayed synthetic click/phrase/audio work.
      await settle(page);
      assert.equal(await card.count(), 0, `${label}: first tap closes without reopening`);
      assert.equal(await originalBody.evaluate(el => el.isConnected), false, `${label}: old body is unmounted`);
      assert.deepEqual(await phoneEffects(page), effects, `${label}: dismissal adds neither audio nor word-tap telemetry`);
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), readerScroll, `${label}: reader remains still`);
      await originalBody.dispose();
    };
    const reopen = async (anchor, word) => {
      const effects = await phoneEffects(page);
      await coordinateTap(page, anchor);
      await card.waitFor({ state: 'visible' });
      if (word === 'odds') await card.locator('[data-part="phrase-meaning"]').waitFor();
      await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
      await settle(page);
      assert.equal(await card.locator('h2').innerText(), word === 'odds' ? phrase : word,
        'only a separate second tap opens the requested word');
      const after = await phoneEffects(page);
      assert.equal(after.taps, effects.taps + 1, 'second tap records exactly one genuine word open');
      assert.ok(after.audios.length + after.voices.length > effects.audios.length + effects.voices.length,
        'second tap genuinely starts pronunciation');
      assert.equal(await body.evaluate(el => el.scrollTop), 0, 'separate reopening resets body scroll');
      await collapsedDetails(card, word === 'odds');
      if (word === 'odds') await lookupTarget(card, 'phrase');
      await cardChrome(page, card);
    };
    await dismissOnly(phraseAnchor, 'same originating word');
    await reopen(phraseAnchor, 'odds');
    await dismissOnly(nextAnchor, 'different reader word');
    await reopen(nextAnchor, 'lantern');
    await dismissOnly(phraseAnchor, 'return to phrase word');
    await reopen(phraseAnchor, 'odds');
    await dismissOnly(nextAnchor, 'phrase to plain word again');
    await reopen(nextAnchor, 'lantern');
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
  if (width === 430) {
    await feedbackTargets(page, card, () => open('odds'));
  }
  await gestures.detach();
  console.log(`PASS ${width}x${height}: trusted slow-start mobile touch, persistent hit-testable chrome, body-only native scrolling, sentence explanation, close-only word taps then separate reopen, long title, natural title/body/padding/handle dismissal, start-time body/title/meta scroll locks, short/return/cancel/horizontal/multitouch/button/footer exclusions`);
}
async function mobileHeaderStress(page, width, height, scale) {
  const label = `${width}x${height} mobile root=${scale}% title=${phrase.length}`;
  const failures = [];
  const check = async (name, run) => {
    try { await run(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, scale);
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press('Escape');
  const anchor = page.locator('article [role="button"][data-word="odds"] .book-tap').nth(10);
  await position(page, anchor, 100);
  const article = await page.locator('article').boundingBox();
  await coordinateTap(page, anchor);
  const card = page.locator('[data-word-card]');
  await card.locator('[data-part="phrase-meaning"]').waitFor();
  await card.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
  await settle(page);
  assert.equal(await card.locator('h2').innerText(), phrase, 'mobile stress actually uses long title');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), `${16 * scale / 100}px`);
  for (const stage of ['collapsed', 'expanded', 'scrolled']) {
    if (stage === 'expanded') await card.locator('[data-word-content]').evaluate(el => {
      for (const details of el.querySelectorAll('details')) details.open = true;
    });
    if (stage === 'scrolled') await card.locator('[data-word-body]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await settle(page);
    await check(`${stage} chrome and touch targets`, () => cardChrome(page, card));
    await check(`${stage} geometry`, () => geometry(page, anchor, card, width, height, 'bottom', article));
    await check(`${stage} usable explanation body`, async () => {
      const m = await metrics(card);
      assert.ok(m.clientHeight > 0, 'font-scaled header leaves a nonzero explanation body');
      if (stage === 'scrolled') assert.ok(m.scrollTop > 0, 'font-scaled explanation can scroll internally');
    });
  }
  await check('word-target switch at enlarged font', () => switchTarget(page, card, 'word'));
  for (const stage of ['collapsed', 'expanded', 'scrolled']) {
    if (stage === 'expanded') await card.locator('[data-word-content]').evaluate(el => {
      for (const details of el.querySelectorAll('details')) details.open = true;
    });
    if (stage === 'scrolled') await card.locator('[data-word-body]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await settle(page);
    await check(`word ${stage} chrome and touch targets`, () => cardChrome(page, card));
    await check(`word ${stage} geometry`, () => geometry(page, anchor, card, width, height, 'bottom', article));
    await check(`word ${stage} usable explanation body`, async () => {
      assert.ok((await metrics(card)).clientHeight > 0);
      if (stage === 'scrolled') assert.ok((await metrics(card)).scrollTop > 0, 'scaled word details scroll internally');
    });
  }
  await check('phrase reset from scrolled word at enlarged font', () => switchTarget(page, card, 'phrase'));
  await check('close is touch reachable', async () => {
    await coordinateTap(page, card.locator('[data-panel-close]'));
    await card.waitFor({ state: 'detached' });
  });
  console.log(JSON.stringify({ mobileHeaderStress: label, failures }));
  stressFailures.push(...failures.map(failure => `${label}: ${failure}`));
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
  // Prewarm fonts hidden by native details before measuring the collapsed baseline;
  // otherwise the expanded pass can trigger a late font swap in the collapse comparison.
  await card.locator('[data-word-content]').evaluate(el => {
    for (const details of el.querySelectorAll('details')) details.open = true;
  });
  await settle(page);
  await page.evaluate(() => document.fonts.ready);
  await card.locator('[data-word-content]').evaluate(el => {
    for (const details of el.querySelectorAll('details')) details.open = false;
  });
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
  if (isPhrase) {
    await check('word-target switch under stress', () => switchTarget(page, card, 'word'));
    const wordInitial = await validate('word collapsed');
    await card.locator('[data-word-content]').evaluate(el => {
      for (const details of el.querySelectorAll('details')) details.open = true;
    });
    await settle(page);
    const wordExpanded = await validate('word expanded');
    await card.locator('[data-word-body]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await settle(page);
    await validate('word scrolled');
    await check('word details add natural content', async () => {
      assert.ok(wordExpanded.naturalContent > wordInitial.naturalContent);
      assert.ok((await metrics(card)).scrollTop > 0, 'stress word body scrolls independently');
    });
    await check('phrase reset from scrolled expanded word under stress', () => switchTarget(page, card, 'phrase'));
    await validate('phrase reset');
  }
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
    ? [...[1024, 1280].flatMap(width => [100, 125, 150].map(scale => [width, 450, scale])), [1280, 1200, 100],
      ...(process.env.STRESS_LONG_TITLE === '1' ? [125, 150].map(scale => [375, 812, scale]) : [])]
    : [[1280, 800], [1024, 768], [1280, 600], [820, 1100], [768, 1024], [390, 844], [375, 667], [430, 932], [320, 568], [667, 375]];
  const viewportFilter = process.env.WORD_CARD_VIEWPORT;
  const selectedViewports = viewports.filter(([width, height]) => !viewportFilter
    || (viewportFilter === 'phone' ? width < 768 : viewportFilter === `${width}x${height}`));
  assert.ok(selectedViewports.length, `WORD_CARD_VIEWPORT matched no cases: ${viewportFilter}`);
  for (const [width, height, scale = 100] of selectedViewports) {
    // Cover both UI languages without multiplying the entire viewport matrix.
    const locale = width === 375 || width === 320 ? 'zh-CN' : 'en-US';
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 768,
      hasTouch: width < 768, serviceWorkers: 'block', locale });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      // Even when pointed at a hosted preview, never hit account, telemetry, feedback,
      // protected-book or other real service endpoints. Specific feedback mocks override this.
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401,
        contentType: 'application/json', body: '{"error":"Synthetic fixture: services disabled"}' });
      return route.continue();
    });
    await installPhoneRecorders(page); // All sizes need positive audio/telemetry and silent-switch assertions.
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "shelf");
    await page.waitForSelector("header");
    await page.evaluate(async ({ phraseKey, longWord, fixture }) => {
      const id = "word-card-layout-regression";
      const sentence = `${phraseKey[0].toUpperCase()}${phraseKey.slice(1)} the lantern seller carried the fragile lights through the flooded streets, while neighbors watched from their windows and wondered whether the exhausted traveler could reach the distant village before the rising river covered the last safe bridge.`;
      const paragraphs = Array.from({ length: 40 }, () => `${sentence} The doctor discussed ${longWord} after the journey. A quuxstone lay by Hook’s bridge.`);
      const glossary = {
        [longWord]: { pos: 'noun', meaning: 'A name for a lung illness caused by breathing very fine dust. '.repeat(24), whyHard: 'A very long technical word.' },
        lantern: { pos: 'noun', meaning: 'A portable light.', whyHard: '' },
        odds: { pos: 'noun', meaning: fixture.wordMeaning, whyHard: fixture.wordWhy, example: fixture.wordExample,
          senses: [
            { pos: 'noun', meaning: fixture.otherMeaning, anchors: [{ chapter: 1, occurrence: 1 }] },
            { pos: 'noun', meaning: fixture.wordMeaning, whyHard: fixture.wordWhy, here: fixture.wordHere,
              anchors: [{ chapter: 0, occurrence: 11 }] },
          ] },
        fragile: { pos: 'adjective', meaning: '', whyHard: '', senseOnly: true,
          senses: [{ pos: 'adjective', meaning: fixture.sparseMeaning,
            anchors: [{ chapter: 0, occurrence: 11 }] }] },
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
          phrases: { [phraseKey]: { pos: 'idiom', meaning: fixture.phraseMeaning,
            here: fixture.phraseHere, example: fixture.phraseExample } } }, `extras:${id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cibian-notebook-v1", JSON.stringify({ version: 0, state: {
        books: [{ id, title: "Word card layout", author: "Test", source: "epub", cloth: "cloth", createdAt: 1 }], words: [], log: {} } }));
    }, { phraseKey: phrase, longWord, fixture });
    await page.goto(base + "read/word-card-layout-regression");
    await page.waitForSelector('article.book-body [role="button"][data-word="odds"]');
    assert.equal(await page.locator('html').getAttribute('lang'), locale === 'zh-CN' ? 'zh-CN' : 'en',
      `${width}x${height}: expected UI language is applied`);
    if (stress) {
      if (width < 768) await mobileHeaderStress(page, width, height, scale);
      else await stressRegression(page, width, height, scale);
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (width < 768) {
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press('Escape'); // Release initial saved-position hold before positioning the fixture.
      await phoneRegression(page, width, height);
      if (surfaceViewport(page)) await phoneSurfaceRegression(page, width, height);
      await savedTargetsAndVariants(page, width, height);
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
          assert.equal(await card.locator('[data-part="word-here"]').count(), 0);
          await lookupTarget(card, 'phrase');
          await targetRoundTrip(page, card);
          await switchTarget(page, card, 'word');
          const initialChrome = await cardChrome(page, card);
          await feedbackDisclosure(page, card, true);
          console.log(JSON.stringify({ viewport: `${width}x${height}`, side, desktopWidth, card: await metrics(card) }));
          // Desktop may resize/reposition on expansion; assert visibility and placement, not frozen coordinates.
          await geometry(page, anchor, card, width, height, side, article);
          const openChrome = await cardChrome(page, card);
          assert.deepEqual(openChrome.scroll.slice(0, 3), initialChrome.scroll.slice(0, 3),
            'opening feedback affects only the card body');
          await card.locator('[data-feedback-toggle]').evaluate(el => el.focus({ preventScroll: true }));
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
      await switchTarget(page, card, 'word');
      const body = card.locator('[data-word-body]');
      await feedbackDisclosure(page, card);
      await feedbackDisclosure(page, card, true);
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await settle(page);
      { const m = await metrics(card); assert.ok(m.maxScroll <= 0 || m.scrollTop > 0, 'same-card switch begins scrolled when the body can scroll'); }
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
    await savedTargetsAndVariants(page, width, height);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height}: widths, placement, article stability, lookup targets, sentence, click-away${width >= 1024 ? ", exact focus return, Enter/Space, close button, offscreen and breakpoint focus" : " and Escape dismissal"}`);
    await page.close();
  }
  assert.deepEqual(stressFailures, [], 'independent stress matrix has no layout failures');
} finally {
  await browser.close();
}
