#!/usr/bin/env node
/**
 * Browser test of the global wordbook, the file-independent reading place, and the About page.
 *
 *   node scripts/wordbook-e2e.mjs [baseUrl] [--shots DIR]
 *
 * Needs the local build and preview server of scripts/e2e-ui.mjs (npm run build:local && npx vite preview --port 8090).
 * Runs in English and Chinese, at 1280px and 390px. Checks:
 *   - a new shelf is empty and points to Discover; Alice is added like any other book
 *   - saving words from two books gives ONE list; a word saved in both books is one card with two sources
 *   - data of the older per-book version migrates (review state kept, sources made), also after a reload
 *   - the notebook: book filter, search, due count; the review card shows the sentence, book and chapter on reveal
 *   - "Go to this place" opens the book at that sentence
 *   - taking a book off the shelf keeps its words
 *   - a reading place saved by another copy of the book (other chapter, other paragraph number) still opens in
 *     the right place, because the word list's paragraph id plus a quote is used, not the raw position
 *   - the About page: every section, the contact line, the wavy-line explanation
 * Chinese text is never written in this file: Chinese labels are read from src/lib/i18n-zh.ts.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSZip = createRequire(join(ROOT, "package.json"))("jszip");
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const at = (path) => new URL(path.replace(/^\//, ""), BASE).toString();
const shotsAt = args.indexOf("--shots");
const SHOTS = shotsAt >= 0 ? args[shotsAt + 1] : "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const dict = (lang) => {
  const src = readFileSync(join(ROOT, "src/lib", `i18n-${lang}.ts`), "utf8");
  return (key) => {
    const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
    if (!m) throw new Error(`no ${lang} text for ${key}`);
    return m[1].replace(/\\"/g, '"');
  };
};
const T = { en: dict("en"), zh: dict("zh") };
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const lantern = new JSZip();
lantern.file("book.epub", readFileSync(join(ROOT, "examples/sample-book/the-lantern-seller.epub")));
lantern.file("glossary.json", readFileSync(join(ROOT, "examples/sample-book/glossary.json")));
const LANTERN_ZIP = await lantern.generateAsync({ type: "nodebuffer" });

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });

let checks = 0;
let failures = 0;
const ok = (cond, message) => {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`${cond ? "  ok   " : "  FAIL "}${message}`);
};

const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 }, mobile: false },
  phone: { viewport: { width: 390, height: 844 }, mobile: true },
};

async function scenario(lang, size) {
  const label = `${lang}/${size}`;
  console.log(`\n== ${label}`);
  const t = T[lang];
  const { viewport, mobile } = SIZES[size];
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: lang === "zh" ? "zh-CN" : "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const shot = async (name) => {
    if (!SHOTS) return;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${name}-${size}-${lang}.png`) });
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem("cibian-notebook-v1") || "{}").state ?? { books: [], words: [] });
  const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem("cibian-progress-v1") || "{}").state?.items ?? {});
  const bookIdOf = async (re) => (await store()).books.find((b) => re.test(b.title))?.id;

  // ---- 1. empty shelf, then Discover
  await page.goto(at("shelf"));
  await page.getByRole("heading", { name: t("shelf.emptyTitle") }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  ok((await page.locator("ul li").count()) === 0, `${label}: a new shelf is empty (no forced Alice)`);
  ok((await page.locator("[data-empty-discover]").count()) === 1, `${label}: the empty shelf points to Discover`);
  ok(!(await overflow()), `${label}: no horizontal overflow (empty shelf)`);
  await shot("empty-shelf");
  await page.locator("[data-empty-discover]").click();
  await page.locator('[data-pack="alice"]').waitFor({ timeout: 30000 });
  await page.locator('[data-pack="alice"]').scrollIntoViewIfNeeded();
  ok(
    (await page.locator('[data-pack="alice"] [data-shelf-add]').getAttribute("data-shelf-state")) === "off",
    `${label}: Discover offers Alice like any other book ("${t("discover.add")}")`,
  );
  await shot("discover-add-alice");
  await page.locator('[data-pack="alice"] [data-shelf-add]').click();
  await page.locator('[data-pack="alice"] [data-shelf-state="on"]').waitFor({ timeout: 90000 });
  ok(true, `${label}: Alice added from Discover`);

  // ---- 2. a second book, from a pack
  await page.goto(at("add"));
  await page.locator("#pack-file").waitFor({ state: "attached" });
  await page.waitForTimeout(1500); // the start-up work (shelf repair, cover refresh) must be done before a file is chosen
  await page.locator("#pack-file").setInputFiles({ name: "lantern.zip", mimeType: "application/zip", buffer: LANTERN_ZIP });
  await page.waitForSelector("article.book-body", { timeout: 60000 });
  const lanternId = await bookIdOf(/Lantern/);
  ok(Boolean(lanternId), `${label}: the second book (The Lantern Seller) is on the shelf`);

  // ---- 3. save words from both books through the reader
  const saveWords = async (count) => {
    const saved = [];
    const buttons = page.locator("article.book-body button.book-hard");
    const total = await buttons.count();
    for (let i = 0; i < total && saved.length < count; i += 3) {
      const button = buttons.nth(i);
      const word = (await button.getAttribute("data-word")) ?? "";
      if (saved.some((w) => w.toLowerCase() === word.toLowerCase())) continue;
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.locator("[data-word-card]").waitFor();
      const toggle = page.locator("[data-word-card] button[aria-pressed]");
      if ((await toggle.getAttribute("aria-pressed")) === "false" && (await toggle.isEnabled())) {
        await toggle.click();
        saved.push(word);
      }
      await page.keyboard.press("Escape");
    }
    return saved;
  };
  const lanternWords = await saveWords(2);
  ok(lanternWords.length === 2, `${label}: saved ${lanternWords.length} words from The Lantern Seller (${lanternWords.join(", ")})`);
  const aliceId = await bookIdOf(/Alice/);
  await page.goto(at(`read/${aliceId}`));
  await page.waitForSelector("button.book-hard", { timeout: 60000 });
  const aliceWords = await saveWords(3);
  ok(aliceWords.length === 3, `${label}: saved ${aliceWords.length} words from Alice (${aliceWords.join(", ")})`);
  let state = await store();
  ok(state.words.length === 5, `${label}: one list holds the words of both books (${state.words.length})`);
  const sample = state.words.find((w) => w.sources.some((s) => s.title.includes("Alice")));
  const src = sample?.sources[0];
  ok(
    Boolean(src && src.sentence && src.book && src.title && src.chapter !== undefined && src.at && src.at.quote),
    `${label}: a saved word keeps its book, chapter, sentence and a file-independent place`,
  );
  ok(Boolean(src?.at && typeof src.at.paragraph === "number"), `${label}: the place holds the paragraph id (${src?.at?.paragraph}) and a quote`);

  // ---- 4. the progress holds the canonical anchor next to the old hint
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(1200);
  const prog = (await progress())[aliceId];
  ok(Boolean(prog?.anchor?.quote) && typeof prog.anchor.paragraph === "number", `${label}: reading progress stores an anchor (paragraph ${prog?.anchor?.paragraph})`);
  ok(typeof prog?.chapter === "number" && typeof prog?.scroll === "number", `${label}: and still the old chapter and scroll hint`);

  // ---- 5. the older per-book version's data migrates: rewrite storage to the old shape, with the same lemma in both books
  const shared = state.words.find((w) => w.sources.some((s) => s.title.includes("Alice")));
  await page.evaluate(
    ({ aliceId, lanternId, shared }) => {
      const raw = JSON.parse(localStorage.getItem("cibian-notebook-v1"));
      const old = [];
      for (const word of raw.state.words) {
        for (const source of word.sources) {
          const book = source.title.includes("Alice") ? aliceId : lanternId;
          const { sources: _drop, ...rest } = word;
          old.push({ ...rest, id: `${word.id}-${book}`, bookId: book, sentence: source.sentence, surface: source.surface });
        }
      }
      const base = old.find((w) => w.lemma === shared.lemma && w.bookId === aliceId);
      // the same lemma was also saved in The Lantern Seller, and reviewed there
      old.push({ ...base, id: "dup-in-lantern", bookId: lanternId, sentence: "The old lantern seller lit the first lamp.", reps: 4, stage: 3, dueAt: Date.now() - 1000, lastReviewedAt: Date.now() - 86400000 });
      raw.state.words = old;
      localStorage.setItem("cibian-notebook-v1", JSON.stringify(raw));
    },
    { aliceId, lanternId, shared },
  );
  await page.goto(at("words"));
  await page.reload();
  await page.locator("h1").first().waitFor();
  state = await store();
  const merged = state.words.filter((w) => w.lemma === shared.lemma);
  ok(merged.length === 1, `${label}: migration: the same lemma from two books is one card (${merged.length})`);
  ok(merged[0]?.sources.length === 2, `${label}: migration: it keeps both books as sources`);
  ok(merged[0]?.stage === 3 && merged[0]?.reps === 4, `${label}: migration: the review state is kept (stage ${merged[0]?.stage}, reps ${merged[0]?.reps})`);
  ok(state.words.length === 5, `${label}: migration: no other word is lost (${state.words.length})`);
  ok(state.words.every((w) => w.sources.length >= 1 && w.sources.every((s) => s.book && s.title)), `${label}: migration: every word has titled sources`);

  // ---- 6. the notebook
  await page.locator("[data-word-sources]").first().waitFor();
  ok((await page.locator("main ul > li, ul.grid > li").count()) >= 5, `${label}: the notebook lists all words in one list`);
  ok(!(await overflow()), `${label}: no horizontal overflow (notebook)`);
  await shot("wordbook-list");
  const searchBox = page.getByRole("searchbox");
  await searchBox.fill(shared.lemma);
  await page.waitForTimeout(200);
  const cardsAfterSearch = await page.locator("h3[lang=en]").allInnerTexts();
  ok(cardsAfterSearch.length === 1 && cardsAfterSearch[0].toLowerCase() === shared.lemma.toLowerCase(), `${label}: search finds the word`);
  ok((await page.locator("[data-word-source]").count()) === 2, `${label}: the shared word shows both of its places`);
  await searchBox.fill("");
  await page.locator("#word-book").selectOption(aliceId);
  await page.waitForTimeout(200);
  const aliceOnly = (await page.locator("h3[lang=en]").allInnerTexts()).length;
  await page.locator("#word-book").selectOption(lanternId);
  await page.waitForTimeout(200);
  const lanternOnly = (await page.locator("h3[lang=en]").allInnerTexts()).length;
  ok(aliceOnly === 3 && lanternOnly === 3, `${label}: the book filter narrows the list (Alice ${aliceOnly}, Lantern ${lanternOnly}; the shared word is in both)`);
  await page.locator("#word-book").selectOption("");
  const dueText = await page.getByRole("button", { name: new RegExp(escapeRe(t("nb.startReview")).replace("\\{n\\}", "\\d+")) }).innerText();
  ok(/\d/.test(dueText), `${label}: the review button shows how many are due ("${dueText.trim()}")`);

  // ---- 7. one review queue across both books, source on reveal
  await page.goto(at("review"));
  await page.locator("h1").first().waitFor();
  await page.getByRole("button", { name: new RegExp(escapeRe(t("rv.startToday")).replace("\\{n\\}", "\\d+")) }).click();
  await page.locator("article h1[lang=en]").waitFor();
  ok((await page.locator("[data-word-sources]").count()) === 0, `${label}: the review card first shows only the word`);
  await page.getByRole("button", { name: t("rv.showMeaning") }).click();
  await page.locator("[data-word-sources]").waitFor();
  const marks = await page.locator("[data-word-source] mark").count();
  const bookLine = await page.locator("[data-word-source]").first().innerText();
  ok(marks >= 1, `${label}: on reveal the word is highlighted in its sentence`);
  ok(/Alice|Lantern/.test(bookLine), `${label}: and the book is named ("${bookLine.replace(/\n/g, " | ").slice(0, 70)}")`);
  ok(!(await overflow()), `${label}: no horizontal overflow (review card)`);
  await shot("review-card-source");

  // ---- 8. jump back to the sentence
  await page.goto(at("words"));
  await page.locator("#word-book").selectOption(aliceId);
  const target = page.locator("li:has([data-word-source]) [data-source-open]").first();
  await target.waitFor();
  const sentenceBefore = await target.locator("xpath=ancestor::li[@data-word-source]//p[1]").innerText();
  await target.click();
  await page.waitForSelector("article.book-body", { timeout: 60000 });
  ok(new URL(page.url()).pathname === `/read/${aliceId}`, `${label}: "Go to this place" opens the book`);
  await page.waitForTimeout(1500);
  const where = await page.evaluate((needle) => {
    const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const want = flat(needle).slice(0, 40);
    const blocks = [...document.querySelectorAll("article.book-body p, article.book-body li, article.book-body blockquote")];
    const hit = blocks.find((b) => flat(b.textContent ?? "").includes(want));
    if (!hit) return null;
    const top = hit.getBoundingClientRect().top;
    return { top, flash: hit.classList.contains("book-flash"), height: innerHeight };
  }, sentenceBefore);
  ok(Boolean(where) && where.top > -50 && where.top < where.height * 0.6, `${label}: the sentence is on screen (top ${Math.round(where?.top ?? -1)}px)`);
  ok(Boolean(where?.flash), `${label}: and the paragraph is flashed so the eye finds it`);

  // ---- 9. a place from another copy of the book (other chapter number, other paragraph number) opens in the right place
  const cur = (await progress())[aliceId];
  const probe = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll("article.book-body p")].filter((p) => (p.textContent ?? "").length > 90);
    const p = blocks[Math.min(5, blocks.length - 1)];
    return { text: (p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70) };
  });
  const chapterNow = cur.chapter;
  await page.evaluate(
    ({ aliceId, quote, chapterNow }) => {
      const raw = JSON.parse(localStorage.getItem("cibian-progress-v1"));
      raw.state.items[aliceId] = {
        chapter: chapterNow + 1,
        chapters: raw.state.items[aliceId].chapters,
        scroll: 0.05,
        updatedAt: Date.now() + 5000,
        anchor: { chapter: chapterNow + 1, paragraph: 99, quote, offset: 0 },
      };
      localStorage.setItem("cibian-progress-v1", JSON.stringify(raw));
    },
    { aliceId, quote: probe.text, chapterNow },
  );
  await page.goto(at(`read/${aliceId}`));
  await page.reload();
  await page.waitForSelector("article.book-body", { timeout: 60000 });
  await page.waitForTimeout(1500);
  const landed = await page.evaluate((needle) => {
    const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const want = flat(needle).slice(0, 40);
    const hit = [...document.querySelectorAll("article.book-body p")].find((b) => flat(b.textContent ?? "").includes(want));
    return hit ? hit.getBoundingClientRect().top : null;
  }, probe.text);
  ok(landed !== null && landed > -60 && landed < 400, `${label}: a place saved by another copy (wrong chapter, wrong paragraph number) still lands on its text (top ${Math.round(landed ?? -1)}px)`);
  const after = (await progress())[aliceId];
  ok(after.chapter === chapterNow || after.anchor?.chapter === chapterNow, `${label}: the reader moved to the chapter that really holds the text`);

  // a position saved before anchors existed gets one
  await page.evaluate((aliceId) => {
    const raw = JSON.parse(localStorage.getItem("cibian-progress-v1"));
    const item = raw.state.items[aliceId];
    delete item.anchor;
    item.updatedAt = Date.now() + 9000;
    localStorage.setItem("cibian-progress-v1", JSON.stringify(raw));
  }, aliceId);
  await page.reload();
  await page.waitForSelector("article.book-body", { timeout: 60000 });
  await page.waitForTimeout(2500);
  ok(Boolean((await progress())[aliceId]?.anchor?.quote), `${label}: an older saved position gets its anchor after the book opens`);

  // ---- 10. taking a book off the shelf keeps its words
  const wordsBefore = (await store()).words.length;
  await page.goto(at("shelf"));
  const moreAria = (title) => t("shelf.moreAria").replace("{title}", title);
  await page.getByRole("button", { name: moreAria("Alice's Adventures in Wonderland") }).first().click();
  await page.getByRole("menuitem", { name: t("discover.remove") }).click();
  const dialog = page.getByRole("alertdialog");
  if (await dialog.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    ok((await dialog.innerText()).length > 20, `${label}: removing a book that was read asks first`);
    await dialog.getByRole("button", { name: t("discover.removeConfirm"), exact: true }).click();
  }
  await page.waitForFunction(async (id) => !JSON.parse(localStorage.getItem("cibian-notebook-v1")).state.books.some((b) => b.id === id), aliceId, { timeout: 15000 });
  await page.waitForTimeout(500);
  ok((await store()).words.length === wordsBefore, `${label}: removing Alice from the shelf keeps all ${wordsBefore} saved words`);
  await page.goto(at("words"));
  await page.locator("[data-word-sources]").first().waitFor();
  ok((await page.getByText(t("src.notOnShelf")).count()) >= 1, `${label}: the words say their book is not on the shelf (no broken link)`);
  await shot("wordbook-after-remove");

  // ---- 11. About
  await page.goto(at("about"));
  await page.locator("[data-about-page]").waitFor();
  ok((await page.locator("[data-about-section]").count()) === 9, `${label}: the About page has all nine sections`);
  ok((await page.locator("[data-about-contact]").count()) === 1, `${label}: and a contact line`);
  ok((await page.getByText(t("about.markTricky")).count()) === 1, `${label}: and the wavy-line explanation`);
  ok(!(await overflow()), `${label}: no horizontal overflow (About)`);
  ok((await page.locator("nav [aria-current=page]").count()) >= 1, `${label}: the About tab is marked as the current page`);
  await shot("about");
  await page.goto(at("guide"));
  await page.locator("[data-guide-page]").waitFor();
  ok((await page.getByText(t("guide.trickyBody")).count()) === 1, `${label}: the guide explains the wavy line too`);

  ok(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors[0]})` : ""}`);
  await ctx.close();
}

const only = args.find((a) => /^(en|zh)\/(desktop|phone)$/.test(a));
for (const lang of ["en", "zh"])
  for (const size of ["desktop", "phone"]) if (!only || only === `${lang}/${size}`) await scenario(lang, size);

await browser.close();
console.log(failures === 0 ? `\nWORDBOOK E2E OK: ${checks}/${checks} checks passed` : `\nWORDBOOK E2E FAILED: ${failures} of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
