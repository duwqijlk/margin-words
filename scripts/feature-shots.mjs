#!/usr/bin/env node
/**
 * Screenshots of the four features of this branch, against a local build:
 *   npm run build:local && npx vite preview --host 127.0.0.1 --port 8090
 *   node scripts/feature-shots.mjs [--out DIR]
 * Needs Playwright and Chrome at $CHROME or /usr/bin/google-chrome. The account API and the
 * catalog are mocked in the page (no server of ours is called):
 *   1. Discover signed out: the button says "Sign in to add", and it opens the sign-in dialog.
 *   2. The empty shelf points to Discover.
 *   3. The reader with the permanent paragraph bulbs, at 1280px and at 390px.
 *   4. The quiet "Word lists updated for 1 book." notice after a catalog rev bump.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:8090/";
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const OUT = outAt >= 0 ? args[outAt + 1] : join(ROOT, "shots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
});

/** Mock the same-origin account API: /api/auth/me answers, /api/sync is empty. */
async function mockAccount(context, signedIn) {
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({ json: signedIn ? { user: { email: "demo@example.com" } } : { user: null } }),
  );
  await context.route("**/api/sync**", (route) => route.fulfill({ json: { items: [] } }));
}

async function fresh({ width, height, signedIn }) {
  const context = await browser.newContext({ viewport: { width, height } });
  await mockAccount(context, signedIn);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name), fullPage: false });
  console.log(`shot ${name}`);
}

async function addAlice(page) {
  await page.goto(BASE + "discover");
  await page.waitForSelector('[data-pack="alice"] [data-shelf-add]');
  const state = await page.getAttribute('[data-pack="alice"] [data-shelf-add]', "data-shelf-state");
  if (state === "off") {
    await page.click('[data-pack="alice"] [data-shelf-add]');
  }
  await page.waitForSelector('[data-pack="alice"] [data-shelf-add][data-shelf-state="on"]');
}

/* ---- 1. Discover signed out: the add buttons say "Sign in to add" */
{
  const { context, page } = await fresh({ width: 1280, height: 800, signedIn: false });
  await page.goto(BASE + "discover");
  await page.waitForSelector("[data-shelf-add][data-requires-signin]");
  const label = (await page.textContent("[data-shelf-add][data-requires-signin]"))?.trim();
  if (!label?.startsWith("Sign in to add")) throw new Error(`button says "${label}"`);
  // Bring the first row's buttons into the picture.
  await page.evaluate(() => document.querySelector("[data-shelf-add]")?.scrollIntoView({ block: "center" }));
  await shot(page, "discover-signed-out-1280.png");
  await page.click("[data-shelf-add][data-requires-signin]");
  await page.waitForSelector("[role='dialog']");
  await shot(page, "discover-sign-in-dialog-1280.png");
  await context.close();
}

/* ---- 2. The empty shelf points to Discover */
{
  const { context, page } = await fresh({ width: 1280, height: 800, signedIn: false });
  await page.goto(BASE + "shelf");
  await page.waitForSelector("[data-first-book-add]");
  await shot(page, "shelf-empty-1280.png");
  await context.close();
}

/* ---- 3. Signed in: add Alice, open it, show the permanent bulbs at 1280 and 390 */
async function readerShot(width, height, name) {
  const { context, page } = await fresh({ width, height, signedIn: true });
  await addAlice(page);
  await page.click('[data-pack="alice"] button[aria-label^="Open"]');
  await page.waitForURL("**/read/**");
  await page.waitForSelector("article");
  // Scroll until a permanent bulb is on screen (chapter 1 owns notes on paragraphs 4 and 15).
  for (let step = 0; step < 40; step += 1) {
    const count = await page.$$eval("button[data-para-marker]", (els) => els.length);
    if (count > 0) break;
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.7)));
    await page.waitForTimeout(250);
  }
  const bulbs = await page.$$eval("button[data-para-marker]", (els) => els.length);
  if (bulbs < 1) throw new Error(`${name}: no permanent bulb came on screen`);
  console.log(`${name}: ${bulbs} bulb(s) on screen`);
  // Let the "on your shelf" toast go away so the text is clear.
  await page
    .waitForFunction(() => !document.body.textContent?.includes("is on your shelf"), undefined, { timeout: 12000 })
    .catch(() => undefined);
  await shot(page, name);
  await context.close();
}
await readerShot(1280, 800, "reader-bulbs-1280.png");
await readerShot(390, 844, "reader-bulbs-390.png");

/* ---- 4. The quiet word-lists-updated notice (catalog rev bumped, same files) */
{
  const { context, page } = await fresh({ width: 1280, height: 800, signedIn: true });
  await addAlice(page);
  // The same catalog with a bumped rev for Alice: only the word list should be fetched again.
  const catalog = JSON.parse(readFileSync(join(ROOT, "public-books/catalog.json"), "utf8"));
  for (const pack of catalog.packs) if (pack.id === "alice") pack.rev = `${pack.rev}-next`;
  await context.route("**/public-books/catalog.json*", (route) => route.fulfill({ json: catalog }));
  await page.goto(BASE + "shelf");
  await page.waitForSelector("[data-lists-updated]");
  console.log("notice:", (await page.textContent("[data-lists-updated]"))?.trim());
  await shot(page, "word-lists-updated-1280.png");
  await context.close();
}

await browser.close();
console.log(`done -> ${OUT}`);
