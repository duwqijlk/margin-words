#!/usr/bin/env node
/**
 * Browser test of: one URL per page, the notice bar, the word panel, one card per book (every way a book
 * can reach the shelf, and old data that already has two cards), the cover repair on start, and series stacks.
 *
 *   node scripts/routes-e2e.mjs [baseUrl]
 *
 * Needs the same local build as scripts/e2e-ui.mjs:  npm run build:local && npx vite preview --port 8090
 * Chinese text is never written in this file: Chinese labels are read from src/lib/i18n-zh.ts.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSZip = createRequire(join(ROOT, "package.json"))("jszip");
const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const at = (path) => new URL(path.replace(/^\//, ""), BASE).toString();

const dict = (lang) => {
  const src = readFileSync(join(ROOT, "src/lib", `i18n-${lang}.ts`), "utf8");
  return (key) => {
    const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
    if (!m) throw new Error(`no ${lang} text for ${key}`);
    return m[1].replace(/\\"/g, '"');
  };
};
const T = { en: dict("en"), zh: dict("zh") };

const packZip = async (id) => {
  const zip = new JSZip();
  zip.file("book.epub", readFileSync(join(ROOT, "packs", id, "book.epub")));
  zip.file("glossary.json", readFileSync(join(ROOT, "packs", id, "glossary.json")));
  return zip.generateAsync({ type: "nodebuffer" });
};
const ZIPS = { twits: await packZip("twits"), matilda: await packZip("matilda"), george: await packZip("george") };

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

const newPage = async ({ width = 1280, height = 800, mobile = false, lang = "en", ctx: existing } = {}) => {
  const ctx =
    existing ??
    (await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  return { ctx, page, errors };
};

/** A new shelf is empty. Alice is added from Discover, like any other book. */
async function ensureAlice(page) {
  await page.goto(at("discover"));
  await page.locator("[data-discover]").waitFor({ timeout: 30000 });
  const add = page.locator('[data-pack="alice"] [data-shelf-add]');
  await add.waitFor({ timeout: 60000 });
  if ((await add.getAttribute("data-shelf-state")) !== "on") await add.click();
  await page.locator('[data-pack="alice"] [data-shelf-state="on"]').waitFor({ timeout: 90000 });
  await page.goto(at("shelf"));
  await page.locator("li.book-card").first().waitFor({ timeout: 90000 });
}

/** The cards on the shelf (stacks and single cards), not the books inside an open stack. */
const cards = (page) => page.locator("li.book-card");
const titleOf = (card) => card.locator("h3, button[lang=en]").first().innerText();

/** Scroll Discover until a card that is not on the first page is mounted. */
async function revealDiscover(page, selector) {
  await page.locator("[data-discover-matches], [role=alert]").first().waitFor({ timeout: 30000 });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if ((await page.locator(selector).count()) > 0) return;
    if ((await page.locator("[data-discover-more]").count()) === 0) break;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(120);
  }
}

/** Add a word list from Discover (card "needs your e-book"), then close the dialog that asks for the e-book. */
async function addFromDiscover(page, id) {
  await page.goto(at("discover"));
  await page.locator("[data-discover]").waitFor({ timeout: 30000 });
  await revealDiscover(page, `[data-word-list="${id}"]`);
  const card = page.locator(`[data-word-list="${id}"]`);
  await card.waitFor({ timeout: 30000 });
  await card.locator("[data-shelf-add]").click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

async function importZip(page, buffer) {
  await page.goto(at("add"));
  await page.locator("#pack-file").setInputFiles({ name: "pack.zip", mimeType: "application/zip", buffer });
}

/** A raw look into IndexedDB (cibian-books): the notes store and the covers store. */
const idb = (page, fn, arg) =>
  page.evaluate(
    ([source, input]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("cibian-books");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          // eslint-disable-next-line no-new-func
          new Function("db", "input", `return (${source})(db, input)`)(db, input).then(
            (value) => (db.close(), resolve(value)),
            (reason) => (db.close(), reject(reason)),
          );
        };
      }),
    [fn.toString(), arg],
  );

const readNotes = (page) =>
  idb(page, (db) =>
    new Promise((resolve) => {
      const tx = db.transaction("notes", "readonly");
      const store = tx.objectStore("notes");
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => resolve(keys.result.map((key, i) => [key, values.result[i]]));
    }),
  );

/** Wait until a card has a stored cover (a picture, not a 1-pixel stand-in). */
const waitCover = (page, id) =>
  page.waitForFunction(
    async (bookId) => {
      const open = indexedDB.open("cibian-books");
      const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
      const value = await new Promise((r) => {
        const get = db.transaction("covers").objectStore("covers").get(bookId);
        get.onsuccess = () => r(get.result);
      });
      db.close();
      return typeof value === "string" && value.length > 1000;
    },
    id,
    { timeout: 30000 },
  );

const shelfState = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1") || "{}").state ?? { books: [], words: [] });

/* ------------------------------------------------------------------ pages and URLs */
async function routes(lang) {
  console.log(`\n== routes (${lang})`);
  const { ctx, page, errors } = await newPage({ lang });
  const t = T[lang];
  await page.goto(BASE);
  await page.locator("[data-empty-discover]").waitFor({ timeout: 60000 });
  ok(new URL(page.url()).pathname === "/shelf", `${lang}: "/" goes to /shelf (${new URL(page.url()).pathname})`);
  ok((await page.evaluate(() => history.length)) <= 2, `${lang}: the redirect from "/" adds no history entry`);

  await ensureAlice(page);
  const tab = (name) => page.getByRole("button", { name, exact: true }).first();
  for (const [name, path, probe] of [
    [t("nav.discover"), "/discover", "[data-discover]"],
    [t("nav.notebook"), "/words", "h1, h2"],
    [t("nav.dashboard"), "/dashboard", "[data-dashboard]"],
    [t("nav.shelf"), "/shelf", "li.book-card"],
  ]) {
    await tab(name).click();
    await page.locator(probe).first().waitFor({ timeout: 30000 });
    ok(new URL(page.url()).pathname === path, `${lang}: the "${name}" tab opens ${path}`);
    ok(
      (await page.locator("[aria-current=page]").count()) >= 1,
      `${lang}: ${path} marks its place as the current page`,
    );
  }

  await page.goBack();
  await page.locator("[data-dashboard]").waitFor();
  ok(new URL(page.url()).pathname === "/dashboard", `${lang}: back goes to /dashboard`);
  await page.goBack();
  ok(new URL(page.url()).pathname === "/words", `${lang}: back again goes to /words`);
  await page.goForward();
  ok(new URL(page.url()).pathname === "/dashboard", `${lang}: forward goes to /dashboard`);

  for (const path of ["/discover", "/dashboard", "/guide", "/words"]) {
    await page.goto(at(path));
    await page.reload();
    await page.locator("header").first().waitFor();
    ok(new URL(page.url()).pathname === path, `${lang}: a deep link and a refresh stay on ${path}`);
  }
  await page.goto(at("discover"));
  await page.locator("[data-discover]").waitFor({ timeout: 30000 });
  await page.locator("[data-pack], [data-word-list]").first().waitFor({ timeout: 30000 });
  ok((await page.locator("[data-pack], [data-word-list]").count()) >= 5, `${lang}: /discover opened straight shows the book list`);

  await page.goto(at("no-such-page"));
  await page.locator("li.book-card").first().waitFor({ timeout: 30000 });
  ok(new URL(page.url()).pathname === "/shelf", `${lang}: an unknown address goes to /shelf`);

  // Open the first book: /read/<id>. A refresh and the back button keep working.
  await page.locator("li.book-card button[aria-label]").first().click();
  await page.waitForSelector("article.book-body", { timeout: 30000 });
  const readPath = new URL(page.url()).pathname;
  ok(/^\/read\/[A-Za-z0-9_-]+$/.test(readPath), `${lang}: a book has its own address (${readPath})`);
  await page.reload();
  await page.waitForSelector("article.book-body", { timeout: 30000 });
  ok(new URL(page.url()).pathname === readPath, `${lang}: refreshing the book stays on ${readPath}`);
  await page.goto(at("read/not-a-book-here"));
  await page.locator("li.book-card").first().waitFor({ timeout: 30000 });
  ok(new URL(page.url()).pathname === "/shelf", `${lang}: a book address that does not exist goes to /shelf`);

  // Static files are never rewritten to the page.
  const js = await page.evaluate(async () => {
    const src = [...document.scripts].map((s) => s.src).find((s) => /\/assets\//.test(s));
    const res = await fetch(src);
    return { type: res.headers.get("content-type") || "", head: (await res.text()).slice(0, 15) };
  });
  ok(/javascript/.test(js.type) && !js.head.includes("<!doctype"), `${lang}: /assets files are served as files`);
  const sw = await page.request.get(at("sw.js"));
  ok(sw.status() === 200 && /javascript/.test(sw.headers()["content-type"] ?? ""), `${lang}: /sw.js is a file`);
  ok(errors.length === 0, `${lang}: no page errors${errors[0] ? " " + errors[0] : ""}`);
  await ctx.close();
}

/* ------------------------------------------------------------------ notice bar */
async function notice(lang) {
  console.log(`\n== notice bar (${lang})`);
  const { ctx, page } = await newPage({ lang });
  const t = T[lang];
  await page.goto(at("shelf"));
  const bar = page.locator("[data-notice-bar]");
  await bar.waitFor({ timeout: 30000 });
  ok(
    (await bar.innerText()).replace(/\s+/g, " ").trim() === `${t("notice.text")} ${t("notice.link")}`,
    `${lang}: the notice says the right text and links to the Guide`,
  );
  ok((await bar.locator("[data-notice-about]").getAttribute("href")) === "/guide", `${lang}: the notice links to the Guide`);
  const box = await bar.boundingBox();
  ok(box !== null && box.y <= 1 && box.height < 80, `${lang}: the notice is a slim bar at the top (${Math.round(box?.height ?? 0)}px)`);
  for (const path of ["discover", "guide", "words"]) {
    await page.goto(at(path));
    ok((await bar.count()) === 1, `${lang}: the notice is on /${path}`);
  }
  await page.goto(at("about"));
  await page.waitForURL((url) => new URL(url).pathname === "/guide", { timeout: 30000 });
  await page.locator("[data-guide-page]").waitFor({ timeout: 30000 });
  ok(new URL(page.url()).pathname === "/guide", `${lang}: /about opens the Guide`);
  ok((await bar.count()) === 1, `${lang}: the notice is still there after /about`);
  await page.goto(at("shelf"));
  await page.locator("[data-notice-close]").click();
  ok((await bar.count()) === 0, `${lang}: the close button hides the notice`);
  await page.reload();
  await page.locator("header").first().waitFor({ timeout: 30000 });
  ok((await bar.count()) === 0, `${lang}: the notice stays hidden after a reload`);
  await page.goto(at("discover"));
  ok((await bar.count()) === 0, `${lang}: and on the other pages`);
  await ctx.close();
}

/* ------------------------------------------------------------------ side panel */
async function panel(label, size) {
  console.log(`\n== side panel (${label})`);
  const { ctx, page, errors } = await newPage(size);
  await page.goto(at("shelf"));
  await ensureAlice(page);
  await page.locator("li.book-card button[aria-label]").first().click();
  await page.waitForSelector("button.book-hard", { timeout: 30000 });
  const words = page.locator("article.book-body button.book-hard");
  const count = await words.count();
  const phone = size.width < 768;
  const wide = size.width >= 1024;
  const seen = [];
  const articleBox = () => page.evaluate(() => {
    const r = document.querySelector("article.book-body").getBoundingClientRect();
    return [r.x + scrollX, r.y + scrollY, r.width, r.height].map((n) => Math.round(n * 10) / 10);
  });
  const before = await articleBox();
  for (const i of [0, Math.floor(count / 3), Math.floor(count / 2), count - 1, 1, Math.floor(count * 0.75)]) {
    const word = words.nth(i);
    await word.scrollIntoViewIfNeeded();
    await word.click();
    await page.locator("[data-word-card]").waitFor();
    await page.waitForTimeout(350);
    const geo = await page.evaluate(() => {
      const card = document.querySelector("[data-word-card]").getBoundingClientRect();
      const art = document.querySelector("article.book-body").getBoundingClientRect();
      const on = document.querySelector("article.book-body button.book-on");
      const w = on ? on.getBoundingClientRect() : null;
      const overlap = w
        ? !(w.right <= card.left + 0.5 || w.left >= card.right - 0.5 || w.bottom <= card.top + 0.5 || w.top >= card.bottom - 0.5)
        : null;
      const gap = w
        ? Math.min(
            Math.abs(card.top - w.bottom),
            Math.abs(w.top - card.bottom),
            Math.abs(card.left - w.right),
            Math.abs(w.left - card.right),
          )
        : null;
      const bar = document.querySelector("header div.mx-auto");
      const barBox = bar ? bar.getBoundingClientRect() : art;
      return {
        card: [card.left, card.top, card.width, card.bottom].map(Math.round),
        right: card.right,
        left: card.left,
        top: card.top,
        bottom: card.bottom,
        artRight: art.right,
        artWidth: art.width,
        vw: document.documentElement.clientWidth,
        vh: innerHeight,
        overlap,
        gap,
        centerDelta: Math.abs((art.left + art.right) / 2 - (barBox.left + barBox.right) / 2),
      };
    });
    seen.push(geo);
    if (phone) ok(Math.abs(geo.bottom - geo.vh) <= 1 && geo.left <= 1 && geo.right >= geo.vw - 1, `${label}: word ${i}: the card is a bottom sheet across the screen`);
    else if (!wide) ok(geo.left >= geo.artRight - 0.5, `${label}: word ${i}: the panel is right of the text column (card ${Math.round(geo.left)} >= text ${Math.round(geo.artRight)})`);
    else {
      ok(geo.left >= -1 && geo.top >= -1 && geo.right <= geo.vw + 1 && geo.bottom <= geo.vh + 1, `${label}: word ${i}: the floating card stays in the viewport`);
      ok(geo.overlap === false, `${label}: word ${i}: the floating card does not cover the tapped word`);
      ok(geo.gap !== null && geo.gap <= 20, `${label}: word ${i}: the floating card sits next to the word (gap ${geo.gap})`);
      ok(geo.centerDelta <= 8, `${label}: word ${i}: the reading column stays centered (off by ${geo.centerDelta.toFixed(1)}px)`);
    }
    await page.keyboard.press("Escape");
    await page.locator("[data-word-card]").waitFor({ state: "hidden" });
  }
  if (!wide) {
    const first = JSON.stringify(seen[0].card.slice(0, 3));
    ok(seen.every((s) => JSON.stringify(s.card.slice(0, 3)) === first), `${label}: the panel is in the same place for every tapped word (${seen[0].card.slice(0, 3)})`);
  }
  const after = await articleBox();
  ok(JSON.stringify(before) === JSON.stringify(after), `${label}: the text column did not move or change size across all taps`);
  if (wide) {
    ok(Math.abs(seen[0].artWidth - 39 * 16) <= 2, `${label}: the column uses the text-width setting (${Math.round(seen[0].artWidth)}px)`);
    ok((await page.locator("[data-side-placeholder]").count()) === 0 || (await page.locator("[data-side-placeholder]").evaluate((el) => getComputedStyle(el).display)) === "none", `${label}: a wide screen has no empty side column`);
    const word = words.nth(2);
    await word.scrollIntoViewIfNeeded();
    await word.click();
    await page.locator("[data-word-card]").waitFor();
    await page.waitForFunction(() => {
      const card = document.querySelector("[data-word-card]");
      return Boolean(card && card.contains(document.activeElement));
    });
    ok(true, `${label}: opening the card moves keyboard focus into it`);
    await page.keyboard.press("Tab");
    ok(await page.evaluate(() => {
      const card = document.querySelector("[data-word-card]");
      return Boolean(card && card.contains(document.activeElement));
    }), `${label}: Tab stays inside the card`);
    await page.keyboard.press("Escape");
    await page.locator("[data-word-card]").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.matches?.("article.book-body button[data-word]") === true);
    ok(true, `${label}: Escape returns focus to the word`);
    await page.getByRole("button", { name: "Reading settings: font, size, theme" }).click();
    await page.locator("[data-reader-width]").evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, "30");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const narrowed = await page.evaluate(() => {
      const art = document.querySelector("article.book-body").getBoundingClientRect();
      const bar = document.querySelector("header div.mx-auto").getBoundingClientRect();
      return { width: art.width, center: Math.abs((art.left + art.right) / 2 - (bar.left + bar.right) / 2) };
    });
    ok(Math.abs(narrowed.width - 30 * 16) <= 2, `${label}: the text-width slider changes the column (${Math.round(narrowed.width)}px)`);
    ok(narrowed.center <= 8, `${label}: a narrower column stays centered`);
  } else if (!phone) {
    ok(
      (await page.locator("[data-side-placeholder]").count()) === 1,
      `${label}: with no word open the same place holds a quiet hint`,
    );
    const hint = await page.evaluate(() => document.querySelector("[data-side-placeholder]").getBoundingClientRect().left);
    ok(Math.abs(hint - seen[0].left) <= 1, `${label}: the hint sits where the card opens`);
  } else {
    ok((await page.locator("[data-side-placeholder]").evaluate((el) => getComputedStyle(el).display)) === "none", `${label}: no empty side area on a phone`);
  }
  ok(errors.length === 0, `${label}: no page errors${errors[0] ? " " + errors[0] : ""}`);
  await ctx.close();
}

/* ------------------------------------------------------------------ one book = one card */
async function oneCard(lang) {
  console.log(`\n== one card per book (${lang})`);
  const t = T[lang];
  const needsLabel = t("shelf.needsEpub");

  {
    // A. Discover first, then import a pack from the shelf's own import page.
    const { ctx, page, errors } = await newPage({ lang });
    await addFromDiscover(page, "twits");
    await page.goto(at("shelf"));
    await page.locator("li.book-card [data-needs-epub]").waitFor({ timeout: 30000 });
    const alice = await cards(page).count();
    await importZip(page, ZIPS.twits);
    await page.waitForSelector("article.book-body", { timeout: 60000 });
    await page.goto(at("shelf"));
    await cards(page).first().waitFor();
    const twits = await page.locator('li.book-card:has-text("Twits")').count();
    ok(twits === 1, `${lang}: A. Discover, then import: one card for The Twits (${twits})`);
    ok((await cards(page).count()) === alice, `${lang}: A. the shelf has the same number of cards as before the import`);
    ok((await page.locator("li.book-card [data-needs-epub]").count()) === 0, `${lang}: A. no card says "${needsLabel}" any more`);
    await page.goto(at("discover"));
    await revealDiscover(page, '[data-word-list="twits"]');
    const state = await page.locator('[data-word-list="twits"] [data-shelf-state]').getAttribute("data-shelf-state");
    ok(state === "on", `${lang}: A. Discover shows The Twits as on the shelf (${state})`);
    await page.reload();
    await revealDiscover(page, '[data-word-list="twits"]');
    await page.locator('[data-word-list="twits"]').waitFor({ timeout: 30000 });
    await page.goto(at("shelf"));
    await cards(page).first().waitFor();
    ok((await page.locator('li.book-card:has-text("Twits")').count()) === 1, `${lang}: A. still one card after a reload`);
    ok(errors.length === 0, `${lang}: A. no page errors${errors[0] ? " " + errors[0] : ""}`);
    await ctx.close();
  }

  {
    // B. Import first, then add the same book from Discover.
    const { ctx, page } = await newPage({ lang });
    await importZip(page, ZIPS.matilda);
    await page.waitForSelector("article.book-body", { timeout: 60000 });
    await page.goto(at("discover"));
    await revealDiscover(page, '[data-word-list="matilda"]');
    const card = page.locator('[data-word-list="matilda"]');
    await card.waitFor({ timeout: 30000 });
    const before = await card.locator("[data-shelf-state]").getAttribute("data-shelf-state");
    ok(before === "on", `${lang}: B. an imported book already shows as on the shelf in Discover (${before})`);
    if (before !== "on") await card.locator("[data-shelf-add]").click();
    await page.waitForTimeout(500);
    await page.goto(at("shelf"));
    await cards(page).first().waitFor();
    ok((await page.locator('li.book-card:has-text("Matilda")').count()) === 1, `${lang}: B. import, then Discover: one card for Matilda`);
    ok((await page.locator("li.book-card [data-needs-epub]").count()) === 0, `${lang}: B. no "${needsLabel}" card`);
    await ctx.close();
  }

  {
    // B2. The e-book is on the shelf but nothing links it to the catalog (an older version, or a record that was lost):
    // pressing Add in Discover must open the card it already has, not make a second one.
    const { ctx, page } = await newPage({ lang });
    await importZip(page, ZIPS.george);
    await page.waitForSelector("article.book-body", { timeout: 60000 });
    await idb(page, (db) =>
      new Promise((resolve) => {
        const tx = db.transaction("notes", "readwrite");
        const store = tx.objectStore("notes");
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) if (typeof key === "string" && key.startsWith("pack:")) store.delete(key);
        };
        tx.oncomplete = () => resolve(true);
      }),
    );
    await page.goto(at("discover"));
    await revealDiscover(page, '[data-word-list="george"]');
    const card = page.locator('[data-word-list="george"]');
    await card.waitFor({ timeout: 30000 });
    ok((await card.locator("[data-shelf-state]").getAttribute("data-shelf-state")) === "off", `${lang}: B2. Discover cannot tell that George is on the shelf (no pack record)`);
    await card.locator("[data-shelf-add]").click();
    await page.waitForSelector("article.book-body", { timeout: 30000 });
    await page.goto(at("shelf"));
    await cards(page).first().waitFor();
    ok((await page.locator("li.book-card:has-text(\"George\")").count()) === 1, `${lang}: B2. adding it from Discover opens the card it already has (one card)`);
    await page.goto(at("discover"));
    await revealDiscover(page, '[data-word-list="george"]');
    ok((await page.locator('[data-word-list="george"] [data-shelf-state]').getAttribute("data-shelf-state")) === "on", `${lang}: B2. and Discover now shows it as on the shelf`);
    await ctx.close();
  }

  {
    // C. Data an older version left behind: a "needs your e-book" card AND an imported card of the same book.
    const { ctx, page, errors } = await newPage({ lang });
    await importZip(page, ZIPS.twits);
    await page.waitForSelector("article.book-body", { timeout: 60000 });
    const real = await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.books.find((b) => /Twits/.test(b.title)).id);
    // a saved word and a reading place on the imported card
    await page.evaluate((id) => {
      const raw = JSON.parse(localStorage.getItem("cibian-notebook-v1"));
      const now = Date.now();
      raw.state.words.push({ id: "w-real", bookId: id, surface: "grunt", lemma: "grunt", pos: "verb", meaning: "make a low sound", whyHard: "", stage: 2, dueAt: now, createdAt: now, reps: 3, lapses: 0 });
      // the leftover duplicate: a card made by Discover, with its own saved word
      raw.state.books.push({ id: "dup-card", title: "The Twits", author: "Roald Dahl", cloth: "cloth", source: "notes", needsEpub: true, createdAt: now - 5000, updatedAt: now - 5000 });
      raw.state.words.push({ id: "w-dup", bookId: "dup-card", surface: "beastly", lemma: "beastly", pos: "adjective", meaning: "very unpleasant", whyHard: "", stage: 0, dueAt: now, createdAt: now, reps: 0, lapses: 0 });
      localStorage.setItem("cibian-notebook-v1", JSON.stringify(raw));
      const progress = JSON.parse(localStorage.getItem("cibian-progress-v1") || '{"state":{"items":{}},"version":0}');
      progress.state.items[id] = { chapter: 2, chapters: 9, scroll: 0.4, updatedAt: now };
      localStorage.setItem("cibian-progress-v1", JSON.stringify(progress));
    }, real);
    await idb(page, (db) =>
      new Promise((resolve) => {
        const tx = db.transaction("notes", "readwrite");
        tx.objectStore("notes").put({ packId: "twits", bookId: "dup-card", rev: "x", sha256: "", installedAt: Date.now() }, "pack:dup-card");
        tx.oncomplete = () => resolve(true);
      }),
    );
    await page.goto(at("shelf"));
    await page.reload();
    await cards(page).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const state = await shelfState(page);
    const twits = state.books.filter((b) => /Twits/.test(b.title));
    ok(twits.length === 1, `${lang}: C. old data with two Twits cards becomes one (${twits.length})`);
    ok(twits[0]?.id === real && !twits[0]?.needsEpub, `${lang}: C. the card with the imported e-book is the one that stays`);
    ok(state.words.some((w) => w.id === "w-real" && w.bookId === real), `${lang}: C. its saved word is kept`);
    ok(state.words.some((w) => w.id === "w-dup" && w.bookId === real), `${lang}: C. the saved word of the other card moved over`);
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-progress-v1")).state.items);
    ok(Object.keys(progress).length === 1 && progress[real]?.chapter === 2, `${lang}: C. the reading place is kept`);
    const notes = await readNotes(page);
    ok(!notes.some(([key]) => key === "pack:dup-card"), `${lang}: C. the leftover pack record is gone`);
    ok(
      notes.some(([key, value]) => key === `pack:${real}` && value.packId === "twits"),
      `${lang}: C. the kept card carries the catalog id "twits", so Discover knows it`,
    );
    ok((await page.locator("li.book-card [data-needs-epub]").count()) === 0, `${lang}: C. no "${needsLabel}" card is left`);
    await page.locator(`li.book-card:has-text("Twits") button[aria-label]`).first().click();
    await page.waitForSelector("article.book-body", { timeout: 30000 });
    ok(true, `${lang}: C. the imported e-book still opens`);
    ok(errors.length === 0, `${lang}: C. no page errors${errors[0] ? " " + errors[0] : ""}`);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ covers repaired on start */
async function covers(lang) {
  console.log(`\n== covers (${lang})`);
  const { ctx, page, errors } = await newPage({ lang });
  await addFromDiscover(page, "charlie");
  await page.goto(at("shelf"));
  await page.locator("li.book-card [data-needs-epub]").waitFor({ timeout: 30000 });
  const listed = await (await page.request.get(at("word-lists/catalog.json"))).json();
  const sha = listed.lists.find((l) => l.id === "charlie").cover.sha256;

  const coverState = () =>
    idb(page, (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(["covers", "notes"], "readonly");
        const keys = tx.objectStore("covers").getAllKeys();
        const values = tx.objectStore("covers").getAll();
        const infoKeys = tx.objectStore("notes").getAllKeys(IDBKeyRange.bound("coverinfo:", "coverinfo:\uffff"));
        const infoValues = tx.objectStore("notes").getAll(IDBKeyRange.bound("coverinfo:", "coverinfo:\uffff"));
        tx.oncomplete = () =>
          resolve({
            covers: Object.fromEntries(keys.result.map((k, i) => [k, values.result[i].length])),
            info: Object.fromEntries(infoKeys.result.map((k, i) => [k.slice(10), infoValues.result[i]])),
          });
      }),
    );
  const bookId = await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.books.find((b) => /Chocolate/.test(b.title)).id);
  let state = await coverState();
  ok(state.covers[bookId] > 1000 && state.info[bookId]?.ref === sha, `${lang}: a card added from Discover keeps its cover and the catalog cover version`);

  // 1. the stored cover is missing (as for a card made by an older version)
  await idb(page, (db, id) => new Promise((resolve) => {
    const tx = db.transaction(["covers", "notes"], "readwrite");
    tx.objectStore("covers").delete(id);
    tx.objectStore("notes").delete(`coverinfo:${id}`);
    tx.oncomplete = () => resolve(true);
  }), bookId);
  await page.goto(at("shelf"));
  await page.reload();
  await waitCover(page, bookId);
  await page.waitForTimeout(300);
  state = await coverState();
  ok(state.covers[bookId] > 1000, `${lang}: a missing cover is fetched again on start`);
  ok(state.info[bookId]?.ref === sha, `${lang}: and the catalog cover version is saved with it`);

  // 2. the stored cover is an old picture of an older catalog version
  await idb(page, (db, id) => new Promise((resolve) => {
    const tx = db.transaction(["covers", "notes"], "readwrite");
    const tiny = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    tx.objectStore("covers").put(tiny, id);
    tx.objectStore("notes").put({ source: "catalog", ref: "0".repeat(64) }, `coverinfo:${id}`);
    tx.oncomplete = () => resolve(true);
  }), bookId);
  await page.reload();
  await waitCover(page, bookId);
  await page.waitForTimeout(300);
  state = await coverState();
  ok(state.info[bookId]?.ref === sha, `${lang}: a cover from an older catalog version is replaced by the current one`);

  // 3. an old cover saved before versions existed (no cover version at all) is checked against the catalog
  await idb(page, (db, id) => new Promise((resolve) => {
    const tx = db.transaction(["covers", "notes"], "readwrite");
    tx.objectStore("covers").put("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", id);
    tx.objectStore("notes").delete(`coverinfo:${id}`);
    tx.oncomplete = () => resolve(true);
  }), bookId);
  await page.reload();
  await waitCover(page, bookId);
  ok(true, `${lang}: a cover with no recorded version is replaced when it is not the catalog picture`);

  // 4. an imported e-book whose stored cover is empty gets the catalog cover back
  await importZip(page, ZIPS.george);
  await page.waitForSelector("article.book-body", { timeout: 60000 });
  const george = await page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.books.find((b) => /George/.test(b.title)).id);
  await idb(page, (db, id) => new Promise((resolve) => {
    const tx = db.transaction(["covers", "notes"], "readwrite");
    tx.objectStore("covers").delete(id);
    tx.objectStore("notes").delete(`coverinfo:${id}`);
    tx.oncomplete = () => resolve(true);
  }), george);
  await page.goto(at("shelf"));
  await page.reload();
  await waitCover(page, george);
  ok(true, `${lang}: an imported book with no cover gets its cover back on start`);
  ok(errors.length === 0, `${lang}: no page errors${errors[0] ? " " + errors[0] : ""}`);
  await ctx.close();
}

/* ------------------------------------------------------------------ one card per book */
async function separateBooks(lang, size) {
  console.log(`\n== separate books (${lang}/${size.name})`);
  const { ctx, page, errors } = await newPage({ ...size, lang });
  // Alice, two books of one series, added in the "wrong" order, and one standalone book.
  await page.goto(at("shelf"));
  await ensureAlice(page);
  await addFromDiscover(page, "wof2");
  await addFromDiscover(page, "wof1");
  await addFromDiscover(page, "twits");
  await page.goto(at("shelf"));
  await page.locator("li.book-card").nth(3).waitFor({ timeout: 30000 });
  const titles = await page.locator("li.book-card button[lang=en]").allInnerTexts();
  ok((await page.locator("[data-series-stack]").count()) === 0, `${lang}: books of one series are not folded together`);
  ok((await cards(page).count()) === 4, `${lang}: Alice, two Wings of Fire books and The Twits are 4 cards`);
  ok(titles.some((text) => /Dragonet/i.test(text)) && titles.some((text) => /Lost Heir/i.test(text)), `${lang}: both books of the series are on the shelf`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(!overflow, `${lang}: no horizontal overflow`);

  // the series filter still works. On a phone it lives in the filter overlay.
  const menu = page.locator("[data-filter-menu]");
  if (await menu.isVisible()) await menu.click();
  const grouped = page.locator("[data-series-filter]:visible");
  if ((await grouped.count()) > 0) {
    await grouped.selectOption("grouped");
    await page.locator("[data-series-group]").first().waitFor();
    ok((await page.locator("[data-series-stack]").count()) === 0, `${lang}: grouping still shows one card per book`);
    ok((await cards(page).count()) === 4, `${lang}: grouping does not hide a book`);
  }
  ok(errors.length === 0, `${lang}: no page errors${errors[0] ? " " + errors[0] : ""}`);
  await ctx.close();
}

for (const lang of ["en", "zh"]) {
  await routes(lang);
  await notice(lang);
}
await panel("desktop 1280", { width: 1280, height: 800 });
await panel("tablet 820", { width: 820, height: 1100 });
await panel("phone 390", { width: 390, height: 844, mobile: true });
for (const lang of ["en", "zh"]) {
  await oneCard(lang);
  await covers(lang);
}
await separateBooks("en", { name: "desktop", width: 1280, height: 800 });
await separateBooks("zh", { name: "phone", width: 390, height: 844, mobile: true });

await browser.close();
console.log(failures === 0 ? `\nROUTES E2E OK: ${checks}/${checks} checks passed` : `\nROUTES E2E FAILED: ${failures} of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
