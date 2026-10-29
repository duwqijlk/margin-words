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

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Literata; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata-normal.woff2")}) format("woff2"); }
@font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${font("inter-normal.woff2")}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #f8f6f0; color: #181715; font-family: Inter, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; position: relative; overflow: hidden; }
.band { position: absolute; inset: 0 0 auto 0; height: 14px; background: #235948; }
.left { position: absolute; left: 80px; top: 92px; width: 560px; }
.brand { font-family: Literata, Georgia, serif; font-size: 44px; font-weight: 700; color: #235948; letter-spacing: -0.5px; }
.headline { margin-top: 18px; font-size: 92px; font-weight: 800; line-height: 1.05; }
.sub { margin-top: 22px; font-size: 36px; font-weight: 600; color: #235948; }
.line { margin-top: 26px; font-size: 28px; line-height: 1.5; color: #4d4a44; }
.site { position: absolute; left: 80px; bottom: 64px; font-size: 26px; font-weight: 600; color: #6b665e; }
.right { position: absolute; right: 72px; top: 96px; width: 470px; }
.page { background: #fff; border: 1px solid #e3ded2; border-radius: 22px; padding: 30px 32px 26px; box-shadow: 0 18px 50px rgba(24,23,21,.10); }
.text { font-family: Literata, Georgia, serif; font-size: 30px; line-height: 1.6; }
.hit { border-bottom: 3px solid #235948; background: #e3efe9; border-radius: 4px; padding: 0 2px; }
.card { margin: 22px -12px 0; background: #fdfcf9; border: 1px solid #e3ded2; border-radius: 18px; padding: 20px 24px; }
.word { font-family: Literata, Georgia, serif; font-size: 40px; font-weight: 700; }
.ipa { margin-left: 12px; font-size: 24px; color: #6b665e; }
.meaning { margin-top: 10px; font-size: 25px; line-height: 1.45; }
</style><body><div class="band"></div>
<div class="left"><div class="brand">inputread</div><div class="headline">${escapeHtml(words.headline)}</div>
<div class="sub">${escapeHtml(words.sub)}</div><div class="line">${escapeHtml(words.line)}</div></div>
<div class="right"><div class="page"><p class="text" lang="en">${sentence}</p>
<div class="card"><span class="word" lang="en">${escapeHtml(words.word)}</span><span class="ipa">${escapeHtml(words.ipa)}</span>
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
