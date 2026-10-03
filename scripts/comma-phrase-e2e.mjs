#!/usr/bin/env node
/**
 * Browser check that a phrase entry written with a comma ("a deep, calm blue") opens its phrase card when a
 * word inside it is tapped, in the built app (same behaviour as the unit tests of help-match.test.mjs, but
 * through the real reader). Uses the sample book with one extra phrase entry.
 *
 *   node scripts/comma-phrase-e2e.mjs [baseUrl]    (same preview server as e2e-ui.mjs)
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSZip = createRequire(join(ROOT, "package.json"))("jszip");
const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");

const list = JSON.parse(readFileSync(join(ROOT, "examples/sample-book/glossary.json"), "utf8"));
const MEANING = "Deep and quiet in colour.";
list.phrases = { ...list.phrases, "a deep, calm blue": { meaning: MEANING, pos: "phrase" } };
const zip = new JSZip();
zip.file("book.epub", readFileSync(join(ROOT, "examples/sample-book/the-lantern-seller.epub")));
zip.file("glossary.json", JSON.stringify(list));
const buffer = await zip.generateAsync({ type: "nodebuffer" });

let failures = 0;
const ok = (cond, message) => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${message}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(new URL("add", BASE).toString());
await page.locator("#pack-file").waitFor({ state: "attached" });
await page.waitForTimeout(1500);
await page.locator("#pack-file").setInputFiles({ name: "p.zip", mimeType: "application/zip", buffer });
await page.waitForSelector("article.book-body", { timeout: 60000 });
for (let i = 0; i < 6; i++) {
  if ((await page.locator("article.book-body").innerText()).includes("a deep, calm blue")) break;
  await page.getByRole("button", { name: "Next chapter" }).first().click();
  await page.waitForTimeout(500);
}
for (const word of ["deep", "calm", "blue"]) {
  const clicked = await page.evaluate((w) => {
    const PHRASE = "a deep, calm blue";
    const paragraph = [...document.querySelectorAll("article.book-body p")].find((p) => p.textContent.includes(PHRASE));
    if (!paragraph) return null;
    const target = paragraph.textContent.indexOf(PHRASE) + PHRASE.indexOf(w);
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (target < seen + n.data.length) {
        const range = document.createRange();
        range.setStart(n, target - seen);
        range.setEnd(n, Math.min(n.data.length, target - seen + w.length));
        const r = range.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      seen += n.data.length;
    }
    return null;
  }, word);
  ok(Boolean(clicked), `"${word}" found in the text`);
  if (!clicked) continue;
  await page.mouse.click(clicked.x, clicked.y);
  await page.waitForTimeout(700);
  const body = await page.locator("body").innerText();
  ok(body.includes(MEANING), `tapping "${word}" inside "a deep, calm blue" opens the phrase card`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}
await browser.close();
console.log(failures ? `\nFAILED: ${failures}` : "\nCOMMA PHRASE E2E OK");
process.exit(failures ? 1 : 0);
