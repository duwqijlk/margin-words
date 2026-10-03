// Layout-shift test for the reading view: tapping a word must never move the text.
// Usage: node scripts/layout-shift-test.mjs <before|after> [baseUrl] [--quick]   (output: ./layout-shift-out/<tag>, or $LAYOUT_OUT)
// Serve the built app first (e.g. npx vite preview --port 8090, or python3 -m http.server 8090 in dist/). Needs Chrome at /usr/bin/google-chrome.
import { chromium } from "playwright";
import fs from "node:fs";

const TAG = process.argv[2] || "after";
const BASE = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "http://127.0.0.1:8090/";
const QUICK = process.argv.includes("--quick");
const OUT = `${process.env.LAYOUT_OUT ?? "layout-shift-out"}/${TAG}`;
fs.mkdirSync(OUT, { recursive: true });

const CONFIGS = [
  { name: "default", theme: "light", size: 20, leading: 1.8, width: "medium", focus: false },
  { name: "small-tight-narrow", theme: "light", size: 16, leading: 1.6, width: "narrow", focus: false },
  { name: "large-loose-wide", theme: "light", size: 30, leading: 2.05, width: "wide", focus: false },
  { name: "sepia-24-wide", theme: "sepia", size: 24, leading: 1.8, width: "wide", focus: false },
  { name: "dark-18-loose-narrow", theme: "dark", size: 18, leading: 2.05, width: "narrow", focus: false },
  { name: "focus-dark-20", theme: "dark", size: 20, leading: 1.8, width: "medium", focus: true },
  { name: "sepia-30-tight-narrow", theme: "sepia", size: 30, leading: 1.6, width: "narrow", focus: false },
  { name: "default-word-low", theme: "light", size: 20, leading: 1.8, width: "medium", focus: false, low: true },
  { name: "dark-24-word-low-narrow", theme: "dark", size: 24, leading: 1.8, width: "narrow", focus: false, low: true },
  { name: "dark-16-loose-wide", theme: "dark", size: 16, leading: 2.05, width: "wide", focus: false },
].filter((c, i) => !QUICK || i < 3 || c.low);

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 800 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
];

const MULTI_SENSE = ["stuck", "trick", "sight", "jump", "painting"];

// Runs in the page: measure everything that must not move.
const SNAP = ({ wordIds, paraIdx }) => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [b.x, b.y, b.width, b.height];
  };
  const art = document.querySelector("article.book-body");
  const paras = [...art.querySelectorAll("p")];
  const out = {
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    article: r(art),
    main: r(document.querySelector("main")),
    paras: paraIdx.map((i) => r(paras[i])),
    words: wordIds.map((i) => r(art.querySelector(`button[data-i="${i}"]`))),
    // per-line breaks of the visible paragraph: number of client rects of the paragraph
    lines: paraIdx.map((i) => (paras[i] ? paras[i].getClientRects().length + ":" + Math.round(paras[i].getBoundingClientRect().height) : null)),
  };
  return out;
};

function diff(a, b) {
  let max = 0;
  const bad = [];
  const cmp = (path, x, y) => {
    if (Array.isArray(x) && Array.isArray(y)) return x.forEach((v, i) => cmp(`${path}[${i}]`, v, y[i]));
    if (typeof x === "number" && typeof y === "number") {
      const d = Math.abs(x - y);
      if (d !== 0) {
        bad.push(`${path}: ${x} -> ${y}`);
        max = Math.max(max, d);
      }
    } else if (x !== y) {
      bad.push(`${path}: ${x} -> ${y}`);
      max = Math.max(max, 1);
    }
  };
  for (const k of Object.keys(a)) cmp(k, a[k], b[k]);
  return { max, bad };
}


// ---------------------------------------------------------------------------------------------
// Panels phase: paragraph help, explain-sentence, phrase card, coined badge. All must be overlays.
// Runs on chapter 2 of The Twits (it has written help for the paragraph below).
const PANEL_PARA = "if you peered deep into the moustachy";
async function panelsPhase({ page, vp, cfg, label, OUT, results, log, errors }) {
  const mobile = vp.mobile;
  const tap = async (loc) => (mobile ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 }));
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("cibian-progress-v1"));
    for (const k of Object.keys(raw.state.items)) { raw.state.items[k].chapter = 2; raw.state.items[k].scroll = 0; }
    localStorage.setItem("cibian-progress-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForSelector("button[data-word]", { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  const at = cfg.low ? 0.7 : mobile ? 0.25 : 0.3;
  const found = await page.evaluate(({ text, frac }) => {
    const p = [...document.querySelectorAll("article.book-body p")].find((x) => x.textContent.replace(/\s+/g, " ").includes(text));
    if (!p) return false;
    const y = p.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, y - window.innerHeight * frac), behavior: "instant" });
    return true;
  }, { text: PANEL_PARA, frac: at });
  await page.waitForTimeout(600);
  if (!found) { log("FAIL", label + "/panels", "test paragraph not found"); return 1; }
  const info = await page.evaluate((text) => {
    const art = document.querySelector("article.book-body");
    const paras = [...art.querySelectorAll("p")];
    const idx = paras.findIndex((x) => x.textContent.replace(/\s+/g, " ").includes(text));
    const vis = [...art.querySelectorAll("button[data-word]")].filter((b) => { const r = b.getBoundingClientRect(); return r.top > 70 && r.bottom < innerHeight - 8 && r.width > 8; });
    const spread = [];
    for (let k = 0; k < 14 && vis.length; k++) spread.push(vis[Math.floor((k * (vis.length - 1)) / 13)].dataset.i);
    const near = [];
    paras.forEach((p, i) => { const r = p.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight && near.length < 10) near.push(i); });
    return { idx, spread: [...new Set(spread)], near };
  }, PANEL_PARA);
  const snap = () => page.evaluate(SNAP, { wordIds: info.spread, paraIdx: info.near });
  const base = await snap();
  const t0 = await page.evaluate(() => performance.now());
  const steps = [];
  const record = async (name, expect) => {
    const s = await snap();
    const d = diff(base, s);
    const state = await page.evaluate(() => ({
      para: !!document.querySelector('aside[aria-label="Paragraph help"]'),
      card: !!document.querySelector('aside[aria-label^="Word card"]'),
      marker: !!document.querySelector("[data-para-marker]"),
    }));
    const pass = d.max === 0 && Object.entries(expect || {}).every(([k, v]) => state[k] === v);
    steps.push({ name, max: d.max, bad: d.bad.slice(0, 4), state, pass });
  };
  const hoverPara = async () => {
    if (mobile) return;
    const r = await page.evaluate((text) => { const p = [...document.querySelectorAll("article.book-body p")].find((x) => x.textContent.replace(/\s+/g, " ").includes(text)); const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 60) }; }, PANEL_PARA);
    await page.mouse.move(r.x, r.y); await page.mouse.move(r.x + 2, r.y + 1);
  };
  const shot = (n) => page.screenshot({ path: `${OUT}/${vp.name}-${cfg.name}-panels-${n}.png` });
  const para = page.locator('aside[aria-label="Paragraph help"]');
  const card = page.locator('aside[aria-label^="Word card"]');
  const marker = page.locator("[data-para-marker]");

  await hoverPara(); await page.waitForTimeout(500);
  await record("marker appears", { marker: true });
  await shot("1-marker");
  await tap(marker); await page.waitForTimeout(800);
  await record("paragraph help opens", { para: true });
  await shot("2-paragraph");
  await page.locator('[data-part="simple"]').waitFor();
  await record("simple version expanded", { para: true });
  await shot("3-simple");
  await tap(para.locator('[data-hard-word="peered"]')); await page.waitForTimeout(900);
  await record("hard word opens the word card", { para: false, card: true });
  await tap(card.getByRole("button", { name: /Explain this sentence/ })); await page.waitForTimeout(1200);
  await record("explain sentence (written)", { card: true });
  await shot("4-explain");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  // phrase + coined taps on the page
  for (const [w, name] of [["sticking", "phrase card"], ["moustachy", "coined word card"], ["bristles", "plain word card"]]) {
    await page.keyboard.press("Escape"); await page.waitForTimeout(400); // a card on the side may sit over the next word (same as the old test)
    await tap(page.locator(`article.book-body p:has-text("${PANEL_PARA}") button[data-word="${w}"]`).first());
    await page.waitForTimeout(900);
    await record(name, { card: true, para: false });
    if (w === "sticking") await shot("5-phrase");
    if (w === "moustachy") await shot("6-coined");
  }
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  // paragraph help on a paragraph without written help (friendly message path)
  await hoverPara(); await page.waitForTimeout(400);
  await tap(marker); await page.waitForTimeout(700);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await record("closed again", { para: false, card: false });
  await page.waitForTimeout(300);
  const all = (await page.evaluate(() => window.__ls)).filter((e) => e.t >= t0);
  const cls = all.filter((e) => e.inText).reduce((a, e) => a + e.value, 0);
  const fail = cls > 0 || steps.some((x) => !x.pass);
  results.push({ label: label + "/panels", cls, steps, errors: [...errors] });
  log(`${fail ? "FAIL" : "PASS"} ${label}/panels textCLS=${cls.toFixed(4)}`);
  for (const x of steps) {
    log(`   ${x.pass ? "ok  " : "BAD "} ${x.name.padEnd(34)} maxShift=${x.max}px ${JSON.stringify(x.state)}`);
    if (!x.pass && x.bad.length) log(`        e.g. ${x.bad.slice(0, 3).join(" | ")}`);
  }
  return fail ? 1 : 0;
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
  // keep real (classic) scrollbars on desktop so scrollbar appear/disappear shifts are caught
  ignoreDefaultArgs: ["--hide-scrollbars"],
});

const results = [];
let failures = 0;
let pendingPanels = false;
const log = (...a) => console.log(...a);

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: vp.viewport,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
    locale: "en-US",
  });
  // The default catalog is now the bundled public-domain classics; this test reads The Twits from ./packs.
  await ctx.addInitScript(() => {
    try { if (!localStorage.getItem("cibian-catalog-url-v1")) localStorage.setItem("cibian-catalog-url-v1", "./packs/catalog.json"); } catch {}
  });
  await ctx.addInitScript(() => {
    window.__ls = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__ls.push({ value: e.value, recent: e.hadRecentInput, t: e.startTime, inText: (e.sources || []).some((x) => { const n = x.node; const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest && el.closest("article.book-body")); }),
          inCard: (e.sources || []).some((x) => { const n = x.node; const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest && el.closest("aside")); }) });
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  // --- put The Twits on the shelf once
  await page.goto(BASE);
  // Static reader: the shelf starts empty. Add the Twits from "Add book" -> "Free books".
  // Locators use the card (data-pack) and the accessible name, so the curly quotes in the labels
  // (Download “The Twits”) do not matter.
  await page.getByRole("button", { name: "Add book" }).first().click();
  const card = page.locator('[data-pack="twits"]');
  const add = card.getByRole("button", { name: /^Download\b/ });
  await add.waitFor({ timeout: 90000 });
  await add.click();
  const openBtn = card.getByRole("button", { name: /^Open\b/ });
  await openBtn.waitFor({ timeout: 90000 });
  await openBtn.click();
  await page.waitForSelector("button[data-word]", { timeout: 30000 });

  for (const cfg of CONFIGS) {
    const label = `${vp.name}/${cfg.name}`;
    const prefs = { theme: cfg.theme, font: "literata", size: cfg.size, leading: cfg.leading, width: cfg.width, focus: cfg.focus };
    await page.evaluate((p) => {
      localStorage.setItem("cibian-prefs-v1", JSON.stringify({ state: p, version: 0 }));
      localStorage.removeItem("cibian-progress-v1");
      for (const k of Object.keys(localStorage)) if (k.includes("progress")) localStorage.removeItem(k);
    }, prefs);
    await page.reload();
    const open = page.getByRole("button", { name: /^Open\b.*The Twits/ }).first();
    await Promise.race([
      page.waitForSelector("button[data-word]", { timeout: 20000 }).catch(() => {}),
      open.waitFor({ timeout: 20000 }).catch(() => {}),
    ]);
    if (!(await page.$("button[data-word]"))) {
      await open.click();
      await page.waitForSelector("button[data-word]", { timeout: 20000 });
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3000); // let the position-restore observer finish
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const gotSize = await page.evaluate(() => getComputedStyle(document.querySelector("article.book-body")).fontSize);

    // Choose the multi-sense word and put it at ~30% of the viewport height.
    const H = vp.viewport.height;
    const target = await page.evaluate(
      ({ multi, topFrac }) => {
        const art = document.querySelector("article.book-body");
        const btns = [...art.querySelectorAll("button[data-word]")];
        const m = btns.find((b) => multi.includes(b.dataset.word.toLowerCase()) && b.classList.contains("book-hard"));
        if (!m) return null;
        const y = m.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, y - window.innerHeight * topFrac), behavior: "instant" });
        return { i: m.dataset.i, word: m.dataset.word };
      },
      { multi: MULTI_SENSE, topFrac: cfg.low ? 0.7 : vp.mobile ? 0.3 : 0.35 },
    );
    await page.waitForTimeout(500);
    if (!target) {
      log("FAIL", label, "no multi-sense word found");
      failures++;
      continue;
    }

    // Pick other words near the same screen area: A (above), B (below, still above the mobile sheet).
    const picks = await page.evaluate(
      ({ mi, vh, mobile, low }) => {
        const art = document.querySelector("article.book-body");
        const btns = [...art.querySelectorAll("button[data-word]")];
        const vis = btns
          .map((b) => ({ b, r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.top > (low && mobile ? vh * 0.5 : 90) && r.bottom < vh * (mobile && !low ? 0.45 : 0.92) && r.width > 8);
        const hard = vis.filter(({ b }) => b.classList.contains("book-hard") && b.dataset.i !== mi);
        const easy = vis.filter(({ b }) => !b.classList.contains("book-hard") && !b.classList.contains("book-wait") && b.dataset.word.length > 3);
        const left = hard.find(({ r }) => r.left + r.width / 2 < window.innerWidth / 2);
        const right = [...hard].reverse().find(({ r }) => r.left + r.width / 2 >= window.innerWidth / 2);
        const e = easy[Math.floor(easy.length / 2)];
        const pick = (x) => (x ? { i: x.b.dataset.i, word: x.b.dataset.word } : null);
        // 10 words spread over the visible words for the rect comparison
        const spread = [];
        const all = vis.length ? vis : [];
        for (let k = 0; k < 10 && all.length; k++) spread.push(all[Math.floor((k * (all.length - 1)) / 9)].b.dataset.i);
        const paras = [...art.querySelectorAll("p")];
        const near = paras
          .map((p, idx) => ({ idx, d: Math.abs(p.getBoundingClientRect().top - 0) }))
          .filter((x) => paras[x.idx].getBoundingClientRect().bottom > 0)
          .sort((a, b) => a.idx - b.idx)
          .slice(0, 10)
          .map((x) => x.idx);
        return { left: pick(left), right: pick(right), easy: pick(e), spread: [...new Set(spread)], paras: near };
      },
      { mi: target.i, vh: H, mobile: vp.mobile, low: !!cfg.low },
    );
    const wordIds = [...new Set([target.i, picks.left?.i, picks.right?.i, picks.easy?.i, ...picks.spread].filter(Boolean))];
    const paraIdx = picks.paras;
    const snap = () => page.evaluate(SNAP, { wordIds, paraIdx });
    const shot = (n) => page.screenshot({ path: `${OUT}/${vp.name}-${cfg.name}-${n}.png` });

    const tapWord = async (i) => {
      const covered = await page.evaluate((idx) => {
        const w = document.querySelector(`article.book-body button[data-i="${idx}"]`);
        const r = w.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== w && !w.contains(hit);
      }, i);
      if (covered) {
        // a real reader would dismiss the card first; the word cannot be tapped under it
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
      const loc = page.locator(`article.book-body button[data-i="${i}"]`);
      if (vp.mobile) await loc.tap({ timeout: 5000 });
      else await loc.click({ timeout: 5000 });
      await page.waitForTimeout(vp.mobile ? 1100 : 700);
    };
    const cardInfo = (i) =>
      page.evaluate((idx) => {
        const card = document.querySelector('aside[aria-label^="Word card"]');
        const w = document.querySelector(`article.book-body button[data-i="${idx}"]`);
        if (!card) return { open: false };
        const c = card.getBoundingClientRect();
        const r = w ? w.getBoundingClientRect() : null;
        const overlap = r ? !(r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) : null;
        return { open: true, label: card.getAttribute("aria-label"), coversWord: overlap, card: [c.left, c.top, c.width, c.height].map(Math.round) };
      }, i);

    await shot("0-base");
    const base = await snap();
    const t0 = await page.evaluate(() => performance.now());

    const steps = [];
    const record = async (name, extra = {}) => {
      const s = await snap();
      const d = diff(base, s);
      steps.push({ name, max: d.max, bad: d.bad.slice(0, 6), ...extra });
    };

    // 1 tap multi-sense word
    await tapWord(target.i);
    let info = await cardInfo(target.i);
    await record(`tap multi-sense "${target.word}"`, { card: info });
    await shot("1-tap-multi");
    // 2 switch to other words
    for (const [k, p] of [["hard-left", picks.left], ["hard-right", picks.right], ["easy", picks.easy]]) {
      if (!p) continue;
      await tapWord(p.i);
      info = await cardInfo(p.i);
      await record(`switch to ${k} "${p.word}"`, { card: info });
      if (k === "hard-right") await shot("2-switch");
    }
    // 3 switch back to the multi-sense word, then Escape
    await tapWord(target.i);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    info = await cardInfo(target.i);
    await record("close with Escape", { card: info, expectClosed: true });
    await shot("3-closed");
    // 4 close button
    await tapWord(target.i);
    const closeBtn = page.locator('button[aria-label="Close word card"]');
    if (vp.mobile) await closeBtn.tap({ timeout: 5000 }).catch(() => {});
    else await closeBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    info = await cardInfo(target.i);
    await record("close with close button", { card: info, expectClosed: true });
    // 5 click outside (empty margin of the page)
    await tapWord(target.i);
    const away = await page.evaluate(
      ({ mobile }) => {
        const c = document.querySelector('aside[aria-label^="Word card"]').getBoundingClientRect();
        if (mobile) return { x: 6, y: c.top < 100 ? window.innerHeight - 24 : Math.round(window.innerHeight * 0.22) };
        const spots = [
          { x: 8, y: 220 },
          { x: window.innerWidth - 8, y: 220 },
          { x: 8, y: window.innerHeight - 8 },
          { x: window.innerWidth - 8, y: window.innerHeight - 8 },
        ];
        for (const spot of spots) {
          const onCard = spot.x >= c.left && spot.x <= c.right && spot.y >= c.top && spot.y <= c.bottom;
          if (!onCard) return spot;
        }
        return { x: 8, y: 8 };
      },
      { mobile: vp.mobile },
    );
    if (vp.mobile) await page.touchscreen.tap(away.x, away.y);
    else await page.mouse.click(away.x, away.y);
    await page.waitForTimeout(600);
    info = await cardInfo(target.i);
    await record("close by tapping outside", { card: info, expectClosed: true });

    await page.waitForTimeout(300);
    // layout-shift entries after the baseline (the observer delivers entries late, so filter by time)
    // Only shifts of the reading text count. Shifts inside the word card itself (it is an overlay;
    // its own content grows when the meaning arrives) are reported separately.
    const all = (await page.evaluate(() => window.__ls)).filter((e) => e.t >= t0);
    const ls = all.filter((e) => e.inText);
    const cardOnly = all.filter((e) => !e.inText).reduce((s, e) => s + e.value, 0);
    const cls = ls.reduce((s, e) => s + e.value, 0);

    let cfgFail = false;
    for (const s of steps) {
      const closedOk = !s.expectClosed || s.card?.open === false;
      const openOk = s.expectClosed || s.card?.open === true;
      const covers = !s.expectClosed && s.card?.coversWord === true && !vp.mobile;
      const pass = s.max === 0 && closedOk && openOk;
      if (!pass) cfgFail = true;
      s.pass = pass;
      s.warn = covers ? "card covers the tapped word" : "";
    }
    if (cls > 0) cfgFail = true;
    if (cls > 0) log("   layout-shift entries:", JSON.stringify(ls).slice(0, 400));
    if (cfgFail) failures++;
    pendingPanels = true;
    results.push({ label, theme, fontSize: gotSize, cls, cardOnly, clsEntries: ls.length, steps, errors: [...errors] });
    log(`${cfgFail ? "FAIL" : "PASS"} ${label} theme=${theme} font=${gotSize} textCLS=${cls.toFixed(4)} (${ls.length} entries) cardInternalShift=${cardOnly.toFixed(3)} multi="${target.word}"`);
    for (const s of steps) {
      log(`   ${s.pass ? "ok  " : "BAD "} ${s.name.padEnd(36)} maxShift=${s.max}px card=${s.card?.open ? "open" : "closed"}${s.warn ? " WARN:" + s.warn : ""}`);
      if (!s.pass && s.bad.length) log(`        e.g. ${s.bad.slice(0, 3).join(" | ")}`);
    }
    if (!QUICK || cfg.name === "default") failures += await panelsPhase({ page, vp, cfg, label, OUT, results, log, errors });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const maxShift = Math.max(0, ...results.flatMap((r) => r.steps.map((s) => s.max)));
const panelRuns = results.filter((r) => r.label.endsWith('/panels')).length;
const maxCls = Math.max(0, ...results.map((r) => r.cls));
const covers = results.flatMap((r) => r.steps.filter((s) => s.warn).map(() => 1)).length;
log(`\nSUMMARY ${TAG}: ${results.length} runs (${panelRuns} panel runs), ${failures} failing, max shift ${maxShift}px, max CLS ${maxCls.toFixed(4)}, card-covers-word cases ${covers}`);
process.exit(failures ? 1 : 0);
