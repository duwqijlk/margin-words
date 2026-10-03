#!/usr/bin/env node
/**
 * Browser check of the paragraph lightbulb with the sample book and three notes: one on the heading, one on a
 * one-line dialogue, and one whose short `context` ("Mira") is found in several paragraphs. The bulb must show on
 * those three paragraphs only (no 8-word minimum, no borrowing), and the bulb's panel must show the note.
 *
 *   node scripts/lightbulb-e2e.mjs [baseUrl]    (same preview server as e2e-ui.mjs)
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
const note = (paragraph, context, idea) => ({
  chapter: 0,
  paragraph,
  context,
  mainIdea: idea,
  simple: `${idea} This is a plain retelling of the line.`,
  hardWords: [],
});
list.paragraphs = [
  note(0, "The Fair", "The title of the first chapter."),
  note(3, "Mira", "Mira stops in front of a stall."),
  note(4, "Do they really work", "Mira asks if the lanterns work."),
  // chapter 9 does not exist in this book (an imported edition numbers its chapters differently): the note must
  // still land on the one paragraph of chapter 2 that holds its context, and nowhere else
  { ...note(2, "I do not want your coins", "Tobias refuses the coins."), chapter: 9 },
];
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(new URL("add", BASE).toString());
await page.locator("#pack-file").waitFor({ state: "attached" });
await page.waitForTimeout(1500);
await page.locator("#pack-file").setInputFiles({ name: "p.zip", mimeType: "application/zip", buffer });
await page.waitForSelector("article.book-body", { timeout: 60000 });
await page.waitForTimeout(1500);

async function scan() {
  const blocks = page.locator("article.book-body :is(p, h1, h2, h3, blockquote, li)");
  const count = await blocks.count();
  const found = [];
  for (let i = 0; i < count; i += 1) {
    const block = blocks.nth(i);
    await block.scrollIntoViewIfNeeded();
    const box = await block.boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + Math.min(box.width / 2, 60), box.y + Math.min(box.height / 2, 10));
    await page.waitForTimeout(350);
    if ((await page.locator("[data-para-marker]").count()) > 0) found.push((await block.innerText()).slice(0, 24));
  }
  return found;
}
const shown = await scan();
console.log("bulbs on:", JSON.stringify(shown));
ok(shown.length === 3, `exactly three paragraphs have a bulb (got ${shown.length})`);
ok(shown.some((t) => t.startsWith("The Fair")), "the heading with a note has a bulb");
ok(shown.some((t) => /Do they really work/.test(t)), "the one-line dialogue with a note has a bulb");
ok(shown.some((t) => t.startsWith("Mira, a girl")), "the paragraph that owns the 'Mira' note has a bulb");
ok(!shown.some((t) => t.startsWith("Every autumn")), "a paragraph without a note has no bulb");

const dialogue = page.locator("article.book-body p", { hasText: "Do they really work" }).first();
await dialogue.scrollIntoViewIfNeeded();
const box = await dialogue.boundingBox();
await page.mouse.move(box.x + 40, box.y + 8);
await page.waitForTimeout(400);
await page.locator("[data-para-marker]").first().click();
await page.waitForTimeout(700);
ok((await page.locator("body").innerText()).includes("Mira asks if the lanterns work."), "the bulb on the dialogue opens its own note");
await page.getByRole("button", { name: "Next chapter" }).first().click();
await page.waitForTimeout(1500);
const second = await scan();
console.log("bulbs on (next chapter):", JSON.stringify(second));
ok(second.length === 1 && /want your coin/.test(second[0]), "a note with a wrong chapter number lights exactly the one paragraph that holds its context");
await browser.close();
console.log(failures ? `\nFAILED: ${failures}` : "\nLIGHTBULB E2E OK");
process.exit(failures ? 1 : 0);
