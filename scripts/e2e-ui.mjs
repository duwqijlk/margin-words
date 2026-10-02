#!/usr/bin/env node
/**
 * Browser end-to-end test of the shelf, the add-book flow and the pack import rules.
 *
 *   node scripts/e2e-ui.mjs [baseUrl] [--shots DIR]
 *
 * Needs: the built site served on baseUrl (default http://127.0.0.1:8090/; serve ./dist, which holds
 * ./public-books/catalog.json), Playwright, and Chrome at $CHROME or /usr/bin/google-chrome.
 * Runs in English and Chinese, at 1280px and 390px. Checks:
 *   - FIRST OPEN: the shelf shows all 12 free classics with covers, a Lexile measure and the
 *     "Free classic" label; one opens and a word can be looked up
 *   - FREE BOOKS: lists all 12 classics with covers and Lexile measures (each already on the shelf = "Read");
 *     Peter and Wendy and Looking-Glass open, a word is looked up, and it all works offline
 *   - deleting a classic keeps it deleted after a reload (the "removed" flag); deleting all gives the empty shelf
 *   - a fresh visit that goes offline after the first load still shows and opens the classics, and a deleted
 *     small classic can be downloaded again from Free books while offline (the service worker keeps it)
 *   - no standalone EPUB input anywhere; the only file inputs take .zip (and .json for a word list)
 *   - empty shelf with 3 steps; one clear "Add book"
 *   - a good pack (the kit's sample pack) imports and opens; title, author and cover come from the EPUB
 *   - a bare .epub (choose and drop) shows the friendly message with the guide link and adds nothing
 *   - bad packs (no list, list for another book, invalid list, two books, not a zip) show a readable error, add nothing
 *   - Free books: the bundled classics download again, the shelf shows cover grid, continue-reading hero and progress bars
 *   - offline: after going offline the app reloads and the book still opens
 *   - no horizontal overflow, tap targets at least 40px high on the shelf and add screens
 * Chinese text is never written in this file: Chinese labels are read from src/lib/i18n-zh.ts.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:8090/").replace(
  /\/?$/,
  "/",
);
const shotsAt = args.indexOf("--shots");
const SHOTS = shotsAt >= 0 ? args[shotsAt + 1] : "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const cshotsAt = args.indexOf("--classic-shots");
const CLASSIC_SHOTS = cshotsAt >= 0 ? args[cshotsAt + 1] : "";
const CLASSICS = [
  { id: "alice", title: /Alice/, lexile: "880L" },
  { id: "treasure-island", title: /Treasure Island/, lexile: "980L" },
  { id: "anne", title: /Anne of Green Gables/, lexile: "970L" },
  { id: "peter-pan", title: /Peter and Wendy/, lexile: "900L" },
  { id: "tom-sawyer", title: /The Adventures of Tom Sawyer/, lexile: "930L" },
  { id: "wind-in-the-willows", title: /The Wind in the Willows/, lexile: "1060L" },
  { id: "little-women", title: /Little Women/, lexile: "1090L" },
  { id: "secret-garden", title: /The Secret Garden/, lexile: "970L" },
  { id: "black-beauty", title: /Black Beauty/, lexile: "1020L" },
  { id: "looking-glass", title: /Through the Looking/, lexile: "840L" },
  { id: "jungle-book", title: /The Jungle Book/, lexile: "1100L" },
  { id: "wizard-of-oz", title: /The Wonderful Wizard of Oz/, lexile: "1030L" },
];
const FREE_COUNT = CLASSICS.length; // 12, all on the shelf from the first start

const dict = (lang) => {
  const src = readFileSync(join(ROOT, "src/lib", `i18n-${lang}.ts`), "utf8");
  return (key) => {
    const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
    if (!m) throw new Error(`no ${lang} text for ${key}`);
    return m[1].replace(/\\"/g, '"');
  };
};
const T = { en: dict("en"), zh: dict("zh") };
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A regex for an aria-label like "Open “{title}”": the text before {title}, then the given title part. */
const labelRe = (template, rest = "") => new RegExp("^" + escapeRe(template.split("{")[0]) + rest);

/* ---- fixtures: built in memory from the sample book and the Alice word list */
const SAMPLE_EPUB = readFileSync(join(ROOT, "examples/sample-book/the-lantern-seller.epub"));
const SAMPLE_LIST = readFileSync(join(ROOT, "examples/sample-book/glossary.json"));
const OTHER_LIST = readFileSync(join(ROOT, "public-books/alice/glossary.json"));
const zipOf = async (files) => {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "nodebuffer" });
};
const FIX = {
  good: await zipOf({ "book.epub": SAMPLE_EPUB, "glossary.json": SAMPLE_LIST }),
  kitNaming: await zipOf({
    "the-lantern-seller.epub": SAMPLE_EPUB,
    "the-lantern-seller.glossary.json": SAMPLE_LIST,
  }),
  noList: await zipOf({ "book.epub": SAMPLE_EPUB }),
  noBook: await zipOf({ "glossary.json": SAMPLE_LIST }),
  wrongList: await zipOf({ "book.epub": SAMPLE_EPUB, "glossary.json": OTHER_LIST }),
  badList: await zipOf({
    "book.epub": SAMPLE_EPUB,
    "glossary.json": '{"version":2,"glossary":{"Bad Word!":{"meaning":"x"}}}',
  }),
  twoBooks: await zipOf({
    "a.epub": SAMPLE_EPUB,
    "b.epub": SAMPLE_EPUB,
    "glossary.json": SAMPLE_LIST,
  }),
  notZip: Buffer.from("this is not a zip"),
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});

let failures = 0;
let checks = 0;
const ok = (cond, message) => {
  checks += 1;
  console.log(`${cond ? "  ok   " : "  FAIL "}${message}`);
  if (!cond) failures += 1;
};

const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 }, mobile: false },
  mobile: { viewport: { width: 390, height: 844 }, mobile: true },
};
/** The app opens on the screen it was on. Tests that want the shelf say so. */
const toShelf = async (page) => {
  await page.evaluate(() =>
    localStorage.setItem("cibian-screen-v2", JSON.stringify({ kind: "shelf" })),
  );
  await page.goto(BASE);
};

const overflow2 = (pg) => pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const toShelfOn = async (pg) => {
  await pg.evaluate(() => localStorage.setItem("cibian-screen-v2", JSON.stringify({ kind: "shelf" })));
  await pg.goto(BASE);
};

async function run(lang, size) {
  const label = `${lang}/${size}`;
  console.log(`\n== ${label}`);
  const { viewport, mobile } = SIZES[size];
  const ctx = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const t = T[lang];
  const shot = async (name) =>
    SHOTS
      ? (await page.evaluate(() => window.scrollTo(0, 0)),
        await page.waitForTimeout(150),
        page.screenshot({
          path: join(SHOTS, `shelf-${name}-${size}-${lang}.png`),
          fullPage: false,
        }))
      : null;
  const classicsShot = async (name) => {
    if (!CLASSIC_SHOTS) return;
    mkdirSync(CLASSIC_SHOTS, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(CLASSIC_SHOTS, `classics11-${name}-${size}-${lang}.png`) });
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const addBtn = () => page.getByRole("button", { name: t("shelf.add"), exact: true }).first();
  const alertText = async () => (await page.locator('[role="alert"]').allInnerTexts()).join(" | ");
  const setFile = (file) => page.locator("#pack-file").setInputFiles(file);
  const goAdd = async () => {
    await toShelf(page);
    await addBtn().click();
    await page.locator("#pack-file").waitFor({ state: "attached" });
  };

  // ---- first visit: all 12 free classics are installed from ./public-books/ and shown on the shelf
  await page.goto(BASE);
  await page.locator("ul li [data-classic-label]").nth(FREE_COUNT - 1).waitFor({ timeout: 90000 });
  ok(
    (await page.locator("ul li [data-classic-label]").count()) === FREE_COUNT,
    `${label}: first open shows ${FREE_COUNT} books with the "${t("shelf.classic")}" label`,
  );
  for (const c of CLASSICS)
    ok(
      (await page.getByRole("button", { name: labelRe(t("shelf.openAria"), c.title.source) }).count()) >= 1,
      `${label}: ${c.id} is on the shelf`,
    );
  ok((await page.locator("ul li").count()) === FREE_COUNT, `${label}: exactly ${FREE_COUNT} books on a first open`);
  ok(
    (await page.locator("ul li img").count()) >= FREE_COUNT,
    `${label}: the classics show cover pictures`,
  );
  ok(
    (await page.getByText(t("shelf.classic"), { exact: true }).count()) === FREE_COUNT,
    `${label}: "${t("shelf.classic")}" label text on ${FREE_COUNT} cards`,
  );
  ok(
    (await page.locator('[data-lexile="880L"]').count()) >= 1,
    `${label}: Alice's card shows its Lexile measure`,
  );
  ok(
    (await page.getAttribute("html", "lang")) === (lang === "zh" ? "zh-CN" : "en"),
    `${label}: page language follows the browser`,
  );
  ok(!(await overflow()), `${label}: no horizontal overflow (shelf with the classics)`);
  await page.evaluate(() => document.fonts.ready);
  await classicsShot("shelf");

  // open one and look up a word
  await page
    .getByRole("button", { name: labelRe(t("shelf.openAria"), "Alice") })
    .first()
    .click();
  await page.waitForSelector("button.book-hard", { timeout: 30000 });
  ok(
    (await page.locator("article.book-body").innerText()).length > 200,
    `${label}: Alice opens and shows text`,
  );
  await page.locator("button.book-hard").first().click();
  await page.locator("[data-word-card]").waitFor();
  const cardText = await page.locator("[data-word-card]").innerText();
  ok(cardText.trim().length > 10, `${label}: looking up a word opens a card ("${cardText.trim().slice(0, 40).replace(/\n/g, " ")}")`);
  await classicsShot("lookup");
  await page.keyboard.press("Escape");

  // delete one: it stays deleted after a reload (and after another start)
  await toShelf(page);
  await page.locator("ul li").nth(2).waitFor();
  await page
    .getByRole("button", { name: labelRe(t("shelf.moreAria"), "Treasure Island") })
    .first()
    .click();
  await page.getByRole("menuitem", { name: t("shelf.menuDelete") }).click();
  await page.getByRole("button", { name: t("common.delete"), exact: true }).last().click();
  await page.waitForFunction(
    (left) => document.querySelectorAll("ul li").length === left,
    FREE_COUNT - 1,
  );
  await page.waitForTimeout(800);
  for (let i = 0; i < 2; i += 1) {
    await page.reload();
    await page.locator("ul li").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500); // the start-up check for missing classics has run by now
  }
  ok(
    (await page.locator("ul li").count()) === FREE_COUNT - 1 &&
      (await page.getByRole("button", { name: labelRe(t("shelf.openAria"), "Treasure Island") }).count()) === 0,
    `${label}: a deleted classic stays deleted after reload`,
  );
  const flag = await page.evaluate(() => localStorage.getItem("cibian-removed-packs-v1"));
  ok(/treasure-island/.test(flag ?? ""), `${label}: the removed flag is stored (${flag})`);
  await classicsShot("after-delete");

  // delete the rest: the empty shelf, which the rest of this test starts from
  while ((await page.locator("ul li").count()) > 0) {
    const left = await page.locator("ul li").count();
    await page.locator("ul li").first().locator("button").last().click();
    await page.getByRole("menuitem", { name: t("shelf.menuDelete") }).click();
    await page.getByRole("button", { name: t("common.delete"), exact: true }).last().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("ul li").length === n,
      left - 1,
    );
  }
  await page.reload();
  await page.getByRole("heading", { name: t("shelf.emptyTitle") }).waitFor();
  await page.waitForTimeout(2000);
  ok(
    (await page.getByRole("heading", { name: t("shelf.emptyTitle") }).count()) === 1,
    `${label}: with every classic deleted the shelf stays empty after reload`,
  );

  ok(
    (await page.getAttribute("html", "lang")) === (lang === "zh" ? "zh-CN" : "en"),
    `${label}: page language follows the browser`,
  );
  ok((await page.locator("ol li").count()) === 3, `${label}: empty shelf shows 3 steps`);
  ok(
    (await addBtn().count()) === 1,
    `${label}: one clear "${t("shelf.add")}" button on the empty shelf`,
  );
  ok(!(await overflow()), `${label}: no horizontal overflow (empty shelf)`);
  await shot("empty");

  // ---- the shelf file input is a pack zip. An EPUB is accepted only on a word-list card (data-own-epub).
  const accepts = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="file"]')].map((i) => ({
      accept: i.getAttribute("accept") ?? "",
      own: i.hasAttribute("data-own-epub"),
    })),
  );
  ok(
    accepts.length > 0 && accepts.every((item) => item.own || !/epub/i.test(item.accept)),
    `${label}: only the word-list control accepts .epub (${accepts.map((item) => item.accept).join(" | ")})`,
  );
  ok(!(await page.locator("text=/upload epub/i").count()), `${label}: no "Upload EPUB" label`);

  // ---- the language switch
  const other = lang === "zh" ? "en" : "zh";
  await page.locator("[data-lang-button]").click();
  await page.getByRole("heading", { name: T[other]("shelf.emptyTitle") }).waitFor();
  ok(true, `${label}: language switch -> ${other}`);
  await page.locator("[data-lang-button]").click();
  await page.getByRole("heading", { name: t("shelf.emptyTitle") }).waitFor();

  // ---- add book screen
  await addBtn().click();
  await page.getByRole("heading", { name: t("add.title"), exact: true }).waitFor();
  ok(
    (await page.locator("[data-guide-link]").count()) >= 1,
    `${label}: add screen links to the guide`,
  );
  ok(!(await overflow()), `${label}: no horizontal overflow (add screen)`);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main button, #root button, #root a")]
      .filter((el) => el.offsetParent !== null && !el.closest("header"))
      .map((el) => ({
        h: el.getBoundingClientRect().height,
        t: (el.textContent || el.getAttribute("aria-label") || "").slice(0, 30),
      }))
      .filter((x) => x.h > 0 && x.h < 40),
  );
  ok(
    small.length === 0,
    `${label}: tap targets >= 40px on the add screen${small.length ? " " + JSON.stringify(small.slice(0, 3)) : ""}`,
  );
  await shot("add");

  // ---- bare EPUB: friendly message, nothing added (choose)
  await setFile({ name: "my-book.epub", mimeType: "application/epub+zip", buffer: SAMPLE_EPUB });
  await page.locator("[data-bare-epub]").waitFor();
  const bare = await page.locator("[data-bare-epub]").innerText();
  ok(
    bare.includes(t("err.bareEpub")),
    `${label}: bare EPUB (choose) -> "${t("err.bareEpub").slice(0, 40)}..."`,
  );
  const guideHref = await page.locator("[data-bare-epub] a").getAttribute("href");
  ok(guideHref === "./guide/", `${label}: bare EPUB message links to ${guideHref}`);
  const guide = await page.request.get(new URL(guideHref, BASE).toString());
  ok(guide.status() === 200, `${label}: ./guide/ answers 200`);
  await page
    .getByRole("button", { name: t("common.close") })
    .first()
    .click();

  // ---- bare EPUB: dropped on the page
  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array([80, 75])], "dropped.epub", { type: "application/epub+zip" }),
    );
    const target = document.querySelector("#root > div");
    target.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  });
  await page.locator("[data-bare-epub]").waitFor({ timeout: 5000 });
  ok(true, `${label}: bare EPUB (drop) -> same friendly message`);
  await page
    .getByRole("button", { name: t("common.close") })
    .first()
    .click();

  // ---- bad packs: readable error, nothing added
  const bad = [
    ["noList", FIX.noList, "err.pack.noList"],
    ["noBook", FIX.noBook, "err.pack.noEpub"],
    ["wrongList", FIX.wrongList, null, /Alice/],
    ["badList", FIX.badList, "err.pack.listBad", /Bad Word/],
    ["twoBooks", FIX.twoBooks, null, /a\.epub, b\.epub/],
    ["notZip", FIX.notZip, "err.notZip"],
  ];
  for (const [name, buffer, key, extra] of bad) {
    await setFile({ name: `${name}.zip`, mimeType: "application/zip", buffer });
    await page.locator('[role="alert"]').first().waitFor({ timeout: 15000 });
    const text = await alertText();
    const good =
      (key ? text.includes(t(key).split("{")[0].trim()) : true) &&
      (extra ? extra.test(text) : true) &&
      !/undefined|\[object|err\.pack/.test(text);
    ok(good, `${label}: bad pack "${name}" -> ${text.slice(0, 110)}`);
    if (lang === "zh") ok(/[\u4e00-\u9fff]/.test(text), `${label}: "${name}" error is in Chinese`);
    await page
      .getByRole("button", { name: t("common.close") })
      .first()
      .click();
  }
  await shot("bad-pack");
  // a .json alone / unknown file
  await setFile({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.locator('[role="alert"]').first().waitFor();
  ok(
    (await alertText()).includes(t("err.notPackFile")),
    `${label}: unknown file -> friendly message`,
  );

  // nothing was added by all of that
  await page
    .getByRole("button", { name: t("nav.shelf"), exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: t("shelf.emptyTitle") }).waitFor();
  ok(true, `${label}: shelf still empty after bare EPUB and bad packs`);

  // ---- good pack (kit naming first, then the standard names: the second is an update of the same book)
  await goAdd();
  await setFile({
    name: "the-lantern-seller.pack.zip",
    mimeType: "application/zip",
    buffer: FIX.kitNaming,
  });
  await page.waitForSelector("button[data-word]", { timeout: 30000 });
  ok(true, `${label}: good pack (<name>.epub + <name>.glossary.json) imported and the book opened`);
  ok(
    (await page.locator("article.book-body").innerText()).length > 200,
    `${label}: book text shown`,
  );
  const hard = await page.locator("button.book-hard").count();
  ok(hard > 3, `${label}: word list applied (${hard} underlined words)`);
  await page.locator("button.book-hard").first().click();
  await page.locator("[data-word-card]").waitFor();
  ok(true, `${label}: tapping a word opens the word card`);
  await page.keyboard.press("Escape");

  // ---- back to the shelf: title and author come from the epub; generated cover
  await toShelf(page);
  await page
    .getByRole("heading", { name: "The Lantern Seller" })
    .first()
    .waitFor({ timeout: 15000 });
  ok(
    await page.getByText("A. Sample Writer").first().isVisible(),
    `${label}: title and author come from the EPUB`,
  );
  ok(
    (await page.locator("section[aria-label]").first().count()) > 0,
    `${label}: continue-reading card is shown`,
  );

  // ---- Free books: download a few packs, offline, shelf with covers
  const want = ["alice", "treasure-island", "anne"];
  await toShelf(page);
  await addBtn().click();
  for (const id of want) {
    const card = page.locator(`[data-pack="${id}"]`);
    await card.getByRole("button", { name: labelRe(t("pack.downloadAria")) }).click();
    await card
      .getByRole("button", { name: labelRe(t("pack.openAria")) })
      .waitFor({ timeout: 90000 });
  }
  ok(true, `${label}: ${want.length} free books downloaded`);
  await page
    .getByRole("button", { name: t("nav.shelf"), exact: true })
    .first()
    .click();
  await page.locator("ul li").nth(3).waitFor();
  ok(
    (await page.locator("ul li").count()) >= 4,
    `${label}: shelf grid has ${await page.locator("ul li").count()} books`,
  );
  ok(
    (await page.locator('[role="progressbar"]').count()) >= 4,
    `${label}: every book has a progress bar`,
  );
  ok(!(await overflow()), `${label}: no horizontal overflow (shelf)`);
  const shelfSmall = await page.evaluate(() =>
    [...document.querySelectorAll("#root button, #root a")]
      .filter((el) => el.offsetParent !== null && !el.closest("li") && !el.closest("header"))
      .map((el) => ({
        h: el.getBoundingClientRect().height,
        t: (el.textContent || el.getAttribute("aria-label") || "").slice(0, 30),
      }))
      .filter((x) => x.h > 0 && x.h < 40),
  );
  ok(
    shelfSmall.length === 0,
    `${label}: tap targets >= 40px on the shelf${shelfSmall.length ? " " + JSON.stringify(shelfSmall.slice(0, 3)) : ""}`,
  );
  await shot("with-books");

  // ---- read a bit -> continue reading with progress
  await page
    .getByRole("button", { name: labelRe(t("shelf.openAria"), "Alice") })
    .first()
    .click();
  await page.waitForSelector("button[data-word]", { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("cibian-progress-v1"));
    const id = Object.keys(raw.state.items).sort(
      (a, b) => raw.state.items[b].updatedAt - raw.state.items[a].updatedAt,
    )[0];
    raw.state.items[id].chapter = 3;
    raw.state.items[id].chapters = Math.max(raw.state.items[id].chapters, 12);
    raw.state.items[id].scroll = 0.4;
    localStorage.setItem("cibian-progress-v1", JSON.stringify(raw));
  });
  await toShelf(page);
  await page.locator("section[aria-label] h2").first().waitFor();
  const hero = await page.locator("section[aria-label] h2").first().innerText();
  ok(/Alice/.test(hero), `${label}: continue-reading hero shows the last book (${hero})`);
  ok(
    (await page
      .locator("section[aria-label] [role=progressbar]")
      .first()
      .getAttribute("aria-valuenow")) !== "0",
    `${label}: hero shows progress`,
  );
  await shot("continue");

  // ---- notebook + settings look
  await page
    .getByRole("button", { name: t("nav.notebook"), exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: t("nb.title"), exact: true }).waitFor();
  ok(!(await overflow()), `${label}: no horizontal overflow (notebook)`);
  await shot("notebook");
  await page.getByRole("button", { name: t("nav.settings"), exact: true }).click();
  await page.getByRole("dialog").waitFor();
  ok(
    (await page.locator("[data-settings-language]").count()) === 1 &&
      (await page.locator("[data-settings-theme]").count()) === 1,
    `${label}: settings has language and theme`,
  );
  await shot("settings");
  await page.getByRole("button", { name: t("rs.theme.dark"), exact: true }).click();
  ok((await page.getAttribute("html", "data-theme")) === "dark", `${label}: dark theme applies`);
  await shot("dark");
  await page.getByRole("button", { name: t("rs.theme.light"), exact: true }).click();
  await page.keyboard.press("Escape");

  // ---- offline: the app and the books still work
  if (size === "desktop") {
    await toShelf(page);
    await page.waitForTimeout(2500); // service worker installs
    await ctx.setOffline(true);
    await page.reload();
    await page.locator("section[aria-label] h2").first().waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: labelRe(t("shelf.openAria"), "Alice") })
      .first()
      .click();
    await page.waitForSelector("button[data-word]", { timeout: 30000 });
    ok(true, `${label}: offline reload works and the book opens`);
    await ctx.setOffline(false);
  }

  // ---- a fresh visitor: first load online, then offline. The classics are on the shelf and open;
  //      a classic that was deleted can be downloaded again while offline (public-books/ is in the service worker cache)
  if (size === "desktop") {
    const fresh = await browser.newContext({
      viewport,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    });
    const fp = await fresh.newPage();
    const ferrors = [];
    fp.on("pageerror", (e) => ferrors.push(String(e).slice(0, 200)));
    await fp.goto(BASE);
    await fp.locator("ul li [data-classic-label]").nth(FREE_COUNT - 1).waitFor({ timeout: 90000 });
    await fp.evaluate(() => navigator.serviceWorker.ready);
    await fp.waitForFunction(
      async () => {
        const hit = await caches.match("./public-books/anne/book.epub");
        const cat = await caches.match("./public-books/catalog.json");
        return Boolean(hit && cat);
      },
      null,
      { timeout: 30000 },
    );
    ok(true, `${label}: service worker cached public-books/ (catalog + books)`);
    await fresh.setOffline(true);
    await fp.reload();
    await fp.locator("ul li [data-classic-label]").nth(FREE_COUNT - 1).waitFor({ timeout: 30000 });
    await fp.getByRole("button", { name: labelRe(t("shelf.openAria"), "Treasure Island") }).first().click();
    await fp.waitForSelector("button.book-hard", { timeout: 30000 });
    await fp.locator("button.book-hard").first().click();
    await fp.locator("[data-word-card]").waitFor();
    ok(true, `${label}: offline after the first load: shelf shows the classics, one opens, a word is looked up`);
    await fp.keyboard.press("Escape");
    // delete Anne, then bring her back from Free books while offline
    await fp.evaluate(() => localStorage.setItem("cibian-screen-v2", JSON.stringify({ kind: "shelf" })));
    await fp.reload();
    await fp.locator("ul li").nth(FREE_COUNT - 1).waitFor();
    await fp.getByRole("button", { name: labelRe(t("shelf.moreAria"), "Anne of Green Gables") }).first().click();
    await fp.getByRole("menuitem", { name: t("shelf.menuDelete") }).click();
    await fp.getByRole("button", { name: t("common.delete"), exact: true }).last().click();
    await fp.waitForFunction(
      (left) => document.querySelectorAll("ul li").length === left,
      FREE_COUNT - 1,
    );
    await fp.getByRole("button", { name: t("shelf.add"), exact: true }).first().click();
    const anne = fp.locator('[data-pack="anne"]');
    await anne.getByRole("button", { name: labelRe(t("pack.downloadAria")) }).click();
    await anne.getByRole("button", { name: labelRe(t("pack.openAria")) }).waitFor({ timeout: 60000 });
    ok(true, `${label}: a deleted classic downloads again from Free books while offline`);
    await fp.setViewportSize(viewport);
    await fresh.setOffline(false);
    ok(ferrors.length === 0, `${label}: no page errors in the fresh visit${ferrors.length ? " " + ferrors[0] : ""}`);
    await fresh.close();
  }

  // ---- Free books lists all 12 classics with covers. They are already on the shelf.
  //      Open Peter and Wendy and the shrunk Looking-Glass, look up a word, then go offline.
  {
    const vctx = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    });
    const vp = await vctx.newPage();
    const verrors = [];
    vp.on("pageerror", (e) => verrors.push(String(e).slice(0, 200)));
    const vshot = async (name, fullPage = false) => {
      if (!CLASSIC_SHOTS) return;
      mkdirSync(CLASSIC_SHOTS, { recursive: true });
      await vp.evaluate(() => window.scrollTo(0, 0));
      await vp.waitForTimeout(500);
      await vp.screenshot({ path: join(CLASSIC_SHOTS, `classics11-${name}-${size}-${lang}.png`), fullPage });
    };
    const openFree = async () => {
      await vp.getByRole("button", { name: t("shelf.add"), exact: true }).first().click();
      await vp.locator("[data-pack]").first().waitFor({ timeout: 30000 });
    };
    await vp.goto(BASE);
    await vp.locator("ul li [data-classic-label]").nth(FREE_COUNT - 1).waitFor({ timeout: 90000 });
    await vp.waitForTimeout(1500);
    ok((await vp.locator("ul li").count()) === FREE_COUNT, `${label}: first run installs all ${FREE_COUNT} classics`);
    await vp.evaluate(() => navigator.serviceWorker.ready);
    await openFree();
    ok(
      (await vp.locator("[data-pack]").count()) === FREE_COUNT,
      `${label}: Free books lists ${FREE_COUNT} classics (${await vp.locator("[data-pack]").count()})`,
    );
    // covers are loaded lazily: scroll down the list so that all of them come into view
    for (let y = 0; y < 8000; y += 400) {
      await vp.evaluate((top) => window.scrollTo(0, top), y);
      await vp.waitForTimeout(120);
    }
    await vp.waitForFunction(
      () => [...document.querySelectorAll("[data-pack] img")].every((i) => i.complete && i.naturalWidth > 0),
      null,
      { timeout: 30000 },
    );
    ok(
      (await vp.locator("[data-pack] img").count()) === FREE_COUNT,
      `${label}: every classic in Free books shows its cover`,
    );
    ok((await vp.locator("[data-free-hint]").count()) === 1, `${label}: Free books explains the classics`);
    for (const c of CLASSICS) {
      const card = vp.locator(`[data-pack="${c.id}"]`);
      ok(
        (await card.getByRole("button", { name: labelRe(t("pack.openAria")) }).count()) === 1,
        `${label}: ${c.id} is already on the shelf (Read)`,
      );
      ok(
        (await card.locator(`[data-lexile="${c.lexile}"]`).count()) === 1,
        `${label}: ${c.id} shows Lexile ${c.lexile}`,
      );
    }
    ok(!(await overflow2(vp)), `${label}: no horizontal overflow (Free books with 12)`);
    await vp.evaluate(() => document.fonts.ready);
    await vshot("free-list", true);

    await vp.getByRole("button", { name: t("nav.shelf"), exact: true }).first().click();
    await vp.locator("ul li").nth(FREE_COUNT - 1).waitFor();
    ok((await vp.locator("ul li").count()) === FREE_COUNT, `${label}: shelf still has all ${FREE_COUNT} classics`);
    ok(
      (await vp.locator("ul li [data-classic-label]").count()) === FREE_COUNT,
      `${label}: every classic carries the "${t("shelf.classic")}" label`,
    );
    await vshot("shelf-12");

    await vp.getByRole("button", { name: labelRe(t("shelf.openAria"), "Peter and Wendy") }).first().click();
    await vp.waitForSelector("button.book-hard", { timeout: 30000 });
    await vp.locator("button.book-hard").first().click();
    await vp.locator("[data-word-card]").waitFor();
    ok(
      (await vp.locator("[data-word-card]").innerText()).trim().length > 10,
      `${label}: Peter and Wendy opens and a word lookup works`,
    );
    await vshot("peter-lookup");
    await vp.keyboard.press("Escape");

    // Looking-Glass (shrunk epub): opens and its illustrations load
    await toShelfOn(vp);
    await vp.getByRole("button", { name: labelRe(t("shelf.openAria"), "Through the Looking") }).first().click();
    await vp.waitForSelector("button.book-hard", { timeout: 30000 });
    await vp.waitForFunction(() => document.querySelectorAll("article.book-body img").length > 0, null, { timeout: 30000 });
    await vp.waitForFunction(
      () => [...document.querySelectorAll("article.book-body img")].some((i) => i.complete && i.naturalWidth > 0),
      null,
      { timeout: 30000 },
    );
    ok(true, `${label}: Through the Looking-Glass (shrunk) opens and shows its illustrations`);

    // offline after the download: reload, open Peter and Wendy, look up a word; Free books still lists 12
    await vctx.setOffline(true);
    await toShelfOn(vp);
    await vp.locator("ul li").nth(FREE_COUNT - 1).waitFor({ timeout: 30000 });
    await vp.getByRole("button", { name: labelRe(t("shelf.openAria"), "Peter and Wendy") }).first().click();
    await vp.waitForSelector("button.book-hard", { timeout: 30000 });
    await vp.locator("button.book-hard").first().click();
    await vp.locator("[data-word-card]").waitFor();
    ok(true, `${label}: offline: Peter and Wendy opens and a word is looked up`);
    await vp.keyboard.press("Escape");
    await toShelfOn(vp);
    await openFree();
    ok(
      (await vp.locator("[data-pack]").count()) === FREE_COUNT,
      `${label}: offline, Free books still lists ${FREE_COUNT}`,
    );
    await vctx.setOffline(false);
    ok(verrors.length === 0, `${label}: no page errors on the Free books visit${verrors.length ? " " + verrors[0] : ""}`);
    await vctx.close();
  }

  ok(errors.length === 0, `${label}: no page errors${errors.length ? " " + errors[0] : ""}`);
  await ctx.close();
}

for (const lang of ["en", "zh"]) for (const size of ["desktop", "mobile"]) await run(lang, size);

await browser.close();
console.log(
  `\n${failures === 0 ? "E2E OK" : "E2E FAILED"}: ${checks - failures}/${checks} checks passed`,
);
process.exit(failures ? 1 : 0);
