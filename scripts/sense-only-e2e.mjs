#!/usr/bin/env node
/**
 * Browser end-to-end test of `senseOnly` word-list entries, with a real pack (the sample book + a real
 * glossary.json that has senseOnly entries for "light", "stood" and "run"; see scripts/lib/sense-only-fixture.mjs).
 *
 *   node scripts/sense-only-e2e.mjs [baseUrl]      (default http://127.0.0.1:8090/, same server as e2e-ui.mjs)
 *
 * Checks: the pack imports; the flag survives the word-list loader into the IndexedDB copy of the book
 * and survives a reload; only the named positions are underlined (not every use); tapping an
 * underlined position gives the meaning, tapping another use of the same word does not; a plain
 * entry of the same list is still underlined; a second route (a .json list added to the book) keeps the flag too.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SAMPLE_EPUB_PATH, ROOT, SENSE_ONLY_MEANINGS, senseOnlyGlossary } from "./lib/sense-only-fixture.mjs";

const require = createRequire(`${ROOT}/package.json`);
const JSZip = require("jszip");
const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");

let checks = 0;
let failures = 0;
function ok(condition, message) {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
}

const listText = JSON.stringify(senseOnlyGlossary());
const zip = new JSZip();
zip.file("book.epub", readFileSync(SAMPLE_EPUB_PATH));
zip.file("glossary.json", listText);
const packBytes = await zip.generateAsync({ type: "nodebuffer" });

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

/** Underlined uses of `word` on the page: their 1-based number among all uses of that word in the chapter. */
const underlined = (word) =>
  page.evaluate(
    (w) => [...document.querySelectorAll("article.book-body button.book-hard")].filter((b) => b.dataset.word.toLowerCase() === w).map((b) => Number(b.dataset.n)),
    word,
  );
const uses = (word) =>
  page.evaluate((w) => [...document.querySelectorAll("article.book-body button[data-word]")].filter((b) => b.dataset.word.toLowerCase() === w).length, word);

async function goToChapter(title) {
  for (let i = 0; i < 6; i += 1) {
    const text = await page.locator("article.book-body").innerText();
    if (text.includes(title)) return;
    await page.getByRole("button", { name: "Next chapter" }).first().click();
    await page.waitForTimeout(250);
  }
  throw new Error(`chapter ${title} not found`);
}
async function backToFirstChapter() {
  for (let i = 0; i < 6; i += 1) {
    const prev = page.getByRole("button", { name: "Previous chapter" }).first();
    if (!(await prev.isVisible()) || (await prev.isDisabled())) return;
    await prev.click();
    await page.waitForTimeout(150);
  }
}
async function tapUse(word, nth) {
  await page.locator(`article.book-body button[data-word][data-n="${nth}"]`).evaluateAll(
    (list, w) => list.find((b) => b.dataset.word.toLowerCase() === w)?.click(),
    word,
  );
  await page.locator("[data-word-card]").waitFor();
  const text = await page.locator("[data-word-card]").innerText();
  await page.keyboard.press("Escape");
  return text;
}
/** The copy of the word list kept in IndexedDB: the "gloss:<bookId>" record of the notes store. */
const storedGlossary = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("cibian-books");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("notes", "readonly").objectStore("notes");
          const all = store.getAll();
          const keys = store.getAllKeys();
          all.onsuccess = () => {
            keys.onsuccess = () => {
              const at = all.result.findIndex((v, i) => String(keys.result[i]).startsWith("gloss:") && v?.title === "The Lantern Seller");
              resolve(at < 0 ? null : all.result[at].glossary);
            };
          };
        };
      }),
  );
const toShelf = async () => {
  await page.evaluate(() => localStorage.setItem("cibian-screen-v2", JSON.stringify({ kind: "shelf" })));
  await page.goto(BASE);
};

async function checkReader(label) {
  await page.waitForSelector("button[data-word]", { timeout: 30000 });
  await backToFirstChapter();
  await goToChapter("The Fair");
  ok((await underlined("stood")).length === 0 && (await uses("stood")) === 1, `${label}: chapter 1, "stood" (not named here) is not underlined`);
  ok((await underlined("shabby")).length === 1, `${label}: chapter 1, a plain entry ("shabby") is underlined`);
  await goToChapter("The Blue Flame");
  const lightUses = await uses("light");
  ok(lightUses === 1 && (await underlined("light")).length === 0, `${label}: chapter 2, "light" is used ${lightUses}x and not underlined`);
  ok(JSON.stringify(await underlined("stood")) === "[1]", `${label}: chapter 2, "stood" is underlined at the named place only`);
  ok(JSON.stringify(await underlined("ran")) === "[1]", `${label}: chapter 2, "ran" is underlined through the entry "run"`);
  const meaning = await tapUse("stood", 1);
  ok(meaning.includes(SENSE_ONLY_MEANINGS.stood), `${label}: tapping the named "stood" shows its meaning`);
  await goToChapter("The Road Home");
  const total = await uses("light");
  const marked = await underlined("light");
  ok(total === 3 && JSON.stringify(marked) === "[2]", `${label}: chapter 3, "light" is used ${total}x, underlined only at use ${JSON.stringify(marked)}`);
  const hit = await tapUse("light", 2);
  ok(hit.includes(SENSE_ONLY_MEANINGS.light), `${label}: tapping the named "light" shows its meaning`);
  const miss = await tapUse("light", 1);
  ok(!miss.includes(SENSE_ONLY_MEANINGS.light), `${label}: tapping another "light" does not show the entry`);
}

await page.goto(BASE);
await page.waitForSelector("main, section, [data-discover]", { timeout: 20000 });
await page.waitForTimeout(1500);

console.log("pack import");
await page.locator("#pack-file").setInputFiles({ name: "lantern.pack.zip", mimeType: "application/zip", buffer: packBytes });
await checkReader("after import");

const stored = await storedGlossary();
ok(stored?.light?.senseOnly === true && stored?.stood?.senseOnly === true && stored?.run?.senseOnly === true, "IndexedDB copy keeps senseOnly on all three entries");
ok(stored?.shabby && stored.shabby.senseOnly === undefined, "IndexedDB copy: a plain entry has no senseOnly");
ok(Array.isArray(stored?.light?.senses) && stored.light.senses[0].anchors?.[0]?.occurrence === 2, "IndexedDB copy keeps the sense anchors");

console.log("reload");
await page.reload();
await checkReader("after reload");

console.log("a .json list added to the book");
// The same list, but "light" is now named at its 3rd use instead of its 2nd. It goes in through the other
// route (glossary-import), which must keep senseOnly too and must really replace the old places.
const moved = senseOnlyGlossary();
moved.glossary.light.senses[0].anchors = [{ chapter: 2, occurrence: 3, context: "until the last light had gone out" }];
await toShelf();
await page.getByRole("button", { name: /More actions for .*Lantern Seller/ }).first().click();
await page.getByRole("menuitem", { name: "Add word list" }).click();
await page.locator("#list-file").setInputFiles({ name: "list.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(moved)) });
await page.getByRole("radio", { name: /Replace/ }).check();
const done = page.getByRole("button", { name: /Replace/ }).last();
await done.waitFor({ timeout: 15000 });
await done.click();
await page.waitForTimeout(1500);
const again = await storedGlossary();
ok(again?.light?.senseOnly === true && again?.run?.senseOnly === true && again?.stood?.senseOnly === true, "after adding a .json list, IndexedDB still has senseOnly");
ok(again?.light?.senses?.[0]?.anchors?.[0]?.occurrence === 3, "after adding a .json list, the new place replaced the old one");
await page.getByRole("button", { name: /Open “The Lantern Seller”/ }).first().click();
await page.waitForSelector("button[data-word]", { timeout: 30000 });
await backToFirstChapter();
await goToChapter("The Road Home");
const movedMarks = await underlined("light");
ok(JSON.stringify(movedMarks) === "[3]", `after .json list: chapter 3, "light" is underlined only at use ${JSON.stringify(movedMarks)}`);

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
