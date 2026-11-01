#!/usr/bin/env node
/**
 * Draws public/social/og.png, the 1200x630 picture a chat app or search engine shows for a link to
 * inputread.site (docs/seo.json "ogImage"; book pages use the book's cover instead).
 *
 * The words come from docs/seo.json "ogImageText" (Chinese lives only in docs/). Run it again after
 * changing them, and commit the PNG:
 *
 *   node scripts/make-og-image.mjs
 *
 * Needs Playwright's Chromium (CHROME=/path/to/chrome to choose one).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { escapeHtml, readSeo } from "./seo-plugin.mjs";

const root = new URL("../", import.meta.url);
const seo = readSeo();
const words = seo.ogImageText;
const font = (name) => readFileSync(new URL(`public/fonts/${name}`, root)).toString("base64");
const sentence = escapeHtml(words.sentence).replace(
  escapeHtml(words.word),
  `<span class="hit">${escapeHtml(words.word)}</span>`,
);

const mark = readFileSync(new URL("public/brand/inputread-mark.svg", root)).toString("base64");

// The design system "Keep reading": white paper, the brand green, the interface face (Atkinson
// Hyperlegible) for the words about the site and Literata for the book's own words; the tapped word
// is lit by the highlighter and its card shows the meaning, as in the app.
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Literata; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata-normal.woff2")}) format("woff2"); }
@font-face { font-family: Atkinson; font-weight: 400; src: url(data:font/woff2;base64,${font("atkinson-hyperlegible-normal-400.woff2")}) format("woff2"); }
@font-face { font-family: Atkinson; font-weight: 700; src: url(data:font/woff2;base64,${font("atkinson-hyperlegible-normal-700.woff2")}) format("woff2"); }
@font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${font("inter-normal.woff2")}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #ffffff; color: #111513; font-family: Atkinson, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; position: relative; overflow: hidden; }
.left { position: absolute; left: 80px; top: 84px; width: 540px; }
.brand { display: flex; align-items: center; gap: 16px; font-family: Literata, Georgia, serif; font-size: 44px; font-weight: 600; letter-spacing: -0.02em; }
.brand img { width: 52px; height: 52px; }
.headline { margin-top: 30px; font-size: 92px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; }
.sub { margin-top: 22px; font-size: 36px; font-weight: 700; color: #17804f; }
.line { margin-top: 22px; font-size: 28px; line-height: 1.5; color: #4a524e; }
.site { position: absolute; left: 80px; bottom: 60px; font-size: 26px; font-weight: 700; color: #6b726e; }
.right { position: absolute; right: 64px; top: 0; bottom: 0; width: 500px; display: grid; align-content: center; }
.sheet { background: #f3f5f4; border-radius: 28px; padding: 40px 36px 36px; }
.text { font-family: Literata, Georgia, serif; font-size: 31px; line-height: 1.6; }
.hit { background: #f5e9cf; border-radius: 3px; padding: 0 3px; font-weight: 600; }
.card { margin-top: 24px; background: #ffffff; border-radius: 20px; padding: 22px 26px 24px; box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 24px 48px -16px rgba(0,0,0,.25); }
.word { font-family: Literata, Georgia, serif; font-size: 42px; font-weight: 700; }
.ipa { margin-top: 4px; font-family: Inter, sans-serif; font-size: 23px; color: #4a524e; }
.ipa b { font-family: Atkinson, sans-serif; font-size: 16px; color: #6b726e; margin-right: 8px; }
.meaning { margin-top: 12px; font-family: Literata, Georgia, serif; font-size: 26px; line-height: 1.45; }
</style><body>
<div class="left"><div class="brand"><img src="data:image/svg+xml;base64,${mark}" alt="">inputread</div><div class="headline">${escapeHtml(words.headline)}</div>
<div class="sub">${escapeHtml(words.sub)}</div><div class="line">${escapeHtml(words.line)}</div></div>
<div class="right"><div class="sheet"><p class="text" lang="en">${sentence}</p>
<div class="card"><div class="word" lang="en">${escapeHtml(words.word)}</div><div class="ipa"><b>UK</b>${escapeHtml(words.ipa)}</div>
<p class="meaning" lang="en">${escapeHtml(words.meaning)}</p></div></div></div>
<div class="site">inputread.site</div></body>`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const out = fileURLToPath(new URL(seo.ogImage.replace(/^\//, "public/"), root));
writeFileSync(out, await page.screenshot({ type: "png" }));
await browser.close();
console.log(`wrote ${out}`);
