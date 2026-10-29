#!/usr/bin/env node
/**
 * Draws the PNG app icons from public/brand/inputread-app-icon.svg (design system Logo: the dark
 * green square with three lines of text, one word lit by the highlighter; full bleed, the system
 * rounds the corners). Run it again after changing the SVG, and commit the PNGs:
 *
 *   node scripts/make-app-icons.mjs
 *
 * Needs Playwright's Chromium (CHROME=/path/to/chrome to choose one).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const svg = readFileSync(new URL("public/brand/inputread-app-icon.svg", root), "utf8");
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  writeFileSync(fileURLToPath(new URL(`public/icons/icon-${size}.png`, root)), await page.screenshot({ type: "png" }));
  await page.close();
}
await browser.close();
