#!/usr/bin/env node
/**
 * Offline Books-admin regression against a finished build. Never starts a server.
 * E2E_URL=http://127.0.0.1:8090 CHROME=/path/to/chrome node scripts/admin-book-upload-e2e.mjs
 * Only the original CC0 sample files and disposable mock admin contexts are used.
 * Every API/catalog/book request is intercepted; only static assets reach localhost.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = new URL(process.env.E2E_URL || process.argv[2] || "http://127.0.0.1:8090/");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(BASE.hostname), "only a local finished build is allowed");
const at = (path) => new URL(path, BASE).href;
const EPUB = readFileSync(fileURLToPath(new URL("../examples/sample-book/the-lantern-seller.epub", import.meta.url)));
const GLOSSARY = readFileSync(fileURLToPath(new URL("../examples/sample-book/glossary.json", import.meta.url)));
const ID = "the-lantern-seller";
const PUBLIC_ROW = { id: ID, title: "The Lantern Seller", category: "speech", series: "Public Fixture Series", seriesNumber: 9 };
const PRIVATE_ROW = { id: ID, title: "The Lantern Seller", series: "Private Fixture Series", seriesNumber: 3 };
const TEXT = {
  en: {
    budget: "Public-book publishing is paused until the server CPU budget is confirmed. No files were published. Contact the site maintainer.",
    partial: "The word list was published, but the book upload did not finish. Check the current files before retrying.",
    catalog: "The selected catalog could not be read. Try again before uploading.", retry: "Try again",
  },
  zh: {
    budget: "\u516c\u7248\u4e66\u7c4d\u53d1\u5e03\u5df2\u6682\u505c\uff0c\u9700\u5148\u786e\u8ba4\u670d\u52a1\u5668 CPU \u9884\u7b97\u3002\u672a\u53d1\u5e03\u4efb\u4f55\u6587\u4ef6\u3002\u8bf7\u8054\u7cfb\u7f51\u7ad9\u7ef4\u62a4\u8005\u3002",
  },
};
let checks = 0;
const check = (label) => { checks += 1; console.log(`  ok ${label}`); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function eventually(read, expected, label) {
  const deadline = Date.now() + 10000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (expected(value)) return value;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.fail(`${label}; last value ${JSON.stringify(value)}`);
}

async function newCase(browser, locale = "en") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
  const state = { unexpected: [], errors: [], writes: [], publicReads: 0, privateReads: 0, catalogGate: null, catalogFail: false, uploadGate: null, uploadStatus: 200, uploadError: "server" };
  await context.addInitScript((language) => localStorage.setItem("cibian-locale-v1", language), locale);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      const fixtureHost = url.origin === BASE.origin || url.origin === "https://books.inputread.site";
      if (fixtureHost && path === "/public-books/catalog.json") {
        state.publicReads += 1;
        if (state.catalogGate) await state.catalogGate.promise;
        return state.catalogFail ? json({ error: "fixture-unavailable" }, 503) : json({ format: 1, packs: [PUBLIC_ROW] });
      }
      if (fixtureHost && path === "/word-lists/catalog.json") {
        state.privateReads += 1;
        return json({ format: 1, lists: [PRIVATE_ROW] });
      }
      if (fixtureHost && path === "/contributors.json") return json({ people: [], books: {} });
      if (fixtureHost && path === "/word-lists/discover-rails.json") return json({ rails: [] });
      if (fixtureHost && path === "/word-lists/glossary-work.json") return json({ items: [] });
      if (url.origin === BASE.origin && path.startsWith("/api/")) {
        if (path === "/api/auth/me") return json({ user: { id: "offline-fixture-admin", email: "admin@example.invalid", nickname: "CC0 fixture admin", role: "admin", emailVerified: true, publicId: "abcdef123456" } });
        if (path === "/api/sync") return json({ items: [] });
        if (path === "/api/admin/sponsorships") return json({ requests: [] });
        if (path === "/api/admin/glossary-work" && request.method() === "GET") return json({ items: [] });
        if (path === "/api/qq-groups") return json({ saved: true, groups: [] });
        if (path === "/api/analytics/word-taps") return json({ ok: true });
        if (request.method() === "POST" && path === "/api/admin/word-lists") {
          const bytes = request.postDataBuffer();
          assert.deepEqual(bytes, GLOSSARY, "raw request keeps original glossary bytes");
          state.writes.push({ type: "raw", url: url.href, bytes });
          if (url.searchParams.get("catalog") === "public") return json({ error: "publish-budget-unconfirmed" }, 503);
          return json({ row: PRIVATE_ROW, lists: 1 });
        }
        if (request.method() === "POST" && path === "/api/admin/books") {
          const body = await new Request(url, { method: "POST", headers: request.headers(), body: request.postDataBuffer() }).formData();
          assert.deepEqual(Buffer.from(await body.get("glossary").arrayBuffer()), GLOSSARY, "multipart keeps original glossary bytes");
          assert.deepEqual(Buffer.from(await body.get("epub").arrayBuffer()), EPUB, "multipart keeps original EPUB bytes");
          state.writes.push({ type: "form", url: url.href });
          if (state.uploadGate) await state.uploadGate.promise;
          return state.uploadStatus === 200 ? json({ kind: url.searchParams.get("kind"), row: PUBLIC_ROW, rev: "fixture-rev" }) : json({ error: state.uploadError }, state.uploadStatus);
        }
      }
      const staticAsset = /^(?:\/assets\/|\/src\/|\/node_modules\/|\/@vite\/|\/@id\/|\/@fs\/|\/@react-refresh$)/.test(path)
        || /\.(?:js|mjs|css|woff2?|ttf|ico|svg|png|webmanifest)$/.test(path);
      if (url.origin === BASE.origin && !/^\/(?:api|word-lists|public-books|packs)(?:\/|$)/.test(path)
        && (["/", "/admin", "/shelf"].includes(path) || staticAsset)) return route.continue();
      state.unexpected.push(`${request.method()} ${url.href}`);
      return route.abort("blockedbyclient");
    } catch (error) {
      state.errors.push(error.stack || String(error));
      return json({ error: "fixture-route-assertion" }, 500);
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.goto(at("/admin"));
  await page.locator('[data-admin-tab="books"]').click();
  await page.locator("[data-admin-books]").waitFor();
  await page.waitForLoadState("networkidle");
  return { context, page, state, locale };
}
async function chooseFiles(c, kind = "public") {
  await c.page.locator('input[name="book-kind"]').nth(kind === "public" ? 1 : 0).check();
  await c.page.locator("[data-admin-books-glossary]").setInputFiles({ name: `${ID}.glossary.json`, mimeType: "application/json", buffer: GLOSSARY });
  await c.page.locator("[data-admin-books-epub]").setInputFiles({ name: "original-cc0-sample.epub", mimeType: "application/epub+zip", buffer: EPUB });
  await c.page.locator("[data-admin-books-detected]").waitFor();
}
const publish = (c) => c.page.locator("[data-admin-books-publish]");
async function ready(c) { await eventually(() => publish(c).isEnabled(), Boolean, "publish becomes ready"); }
async function clean(c) {
  assert.deepEqual(c.state.errors, [], "no page errors or request-body assertions");
  assert.deepEqual(c.state.unexpected, [], "no unmocked API/book/external requests");
  await c.context.close();
}

async function run(browser) {
  {
    const c = await newCase(browser);
    try {
      c.state.catalogGate = deferred();
      const reads = c.state.publicReads;
      await chooseFiles(c);
      await eventually(() => c.state.publicReads, (value) => value > reads, "selected public metadata request starts");
      assert.equal(await publish(c).isEnabled(), false, "catalog pending disables publish");
      await publish(c).dispatchEvent("click");
      assert.deepEqual(c.state.writes, [], "programmatic click cannot bypass pending metadata guard");
      c.state.catalogGate.resolve();
      await ready(c);
      assert.equal(await c.page.locator("[data-admin-books-series-name]").inputValue(), PUBLIC_ROW.series);
      assert.equal(await c.page.locator("[data-admin-books-series-number]").inputValue(), String(PUBLIC_ROW.seriesNumber));
      assert.equal(await c.page.locator('[data-admin-books-category-option="speech"]').isChecked(), true);
      check("public metadata comes from public catalog; pending metadata blocks all publishing");
      await c.page.locator("[data-admin-books-isbn]").fill("9780062285768");
      c.state.uploadGate = deferred();
      await publish(c).evaluate((button) => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await eventually(() => c.state.writes.length, (value) => value === 1, "public multipart request starts");
      assert.equal(await publish(c).isEnabled(), false);
      await publish(c).dispatchEvent("click");
      await c.page.waitForTimeout(120);
      assert.equal(c.state.writes.length, 1, "duplicate clicks remain single-flight");
      c.state.uploadGate.resolve();
      await ready(c);
      assert.deepEqual(c.state.writes.map((item) => item.type), ["form"], "public never sends raw word-list upload");
      const params = new URL(c.state.writes[0].url).searchParams;
      assert.equal(params.get("kind"), "public");
      assert.equal(params.get("id"), ID);
      assert.equal(params.get("category"), "speech");
      assert.equal(params.get("isbn"), "9780062285768");
      assert.equal(params.get("series"), PUBLIC_ROW.series);
      assert.equal(params.get("seriesNumber"), "9");
      check("public publishes one multipart with exact source bytes and metadata; duplicate clicks are single-flight");
    } finally { c.state.catalogGate?.resolve(); c.state.uploadGate?.resolve(); await clean(c); }
  }
  {
    const c = await newCase(browser);
    try {
      c.state.catalogFail = true;
      await chooseFiles(c);
      await c.page.getByText(TEXT.en.catalog, { exact: true }).waitFor();
      assert.equal(await publish(c).isEnabled(), false);
      await publish(c).dispatchEvent("click");
      assert.deepEqual(c.state.writes, []);
      const reads = c.state.publicReads;
      c.state.catalogFail = false;
      await c.page.locator('[data-admin-books] [role="alert"] button').click();
      await eventually(() => c.state.publicReads, (value) => value > reads, "retry re-fetches catalog");
      await ready(c);
      assert.equal(await c.page.locator("[data-admin-books-series-name]").inputValue(), PUBLIC_ROW.series);
      await publish(c).click();
      await eventually(() => c.state.writes.length, (value) => value === 1, "retry allows later publish");
      await ready(c);
      assert.deepEqual(c.state.writes.map((item) => item.type), ["form"]);
      check("catalog failure is fail-closed and retry refetches metadata before publishing");
    } finally { await clean(c); }
  }
  for (const locale of ["en", "zh"]) {
    const c = await newCase(browser, locale);
    try {
      await chooseFiles(c);
      await ready(c);
      c.state.uploadStatus = 503;
      c.state.uploadError = "publish-budget-unconfirmed";
      await publish(c).click();
      await c.page.getByRole("alert").filter({ hasText: TEXT[locale].budget }).waitFor();
      assert.deepEqual(c.state.writes.map((item) => item.type), ["form"]);
      assert.equal(await c.page.getByRole("alert").count(), 1);
      check(`${locale}: 503 budget denial shows the translated no-files-published message without partial success`);
    } finally { await clean(c); }
  }
  {
    const c = await newCase(browser);
    try {
      await chooseFiles(c, "private");
      await ready(c);
      assert.equal(await c.page.locator("[data-admin-books-series-name]").inputValue(), PRIVATE_ROW.series);
      assert.equal(await c.page.locator("[data-admin-books-series-number]").inputValue(), "3");
      assert.equal(await c.page.locator('[data-admin-books-category-option="novel"]').isChecked(), true);
      await c.page.locator("[data-admin-books-isbn]").fill("");
      c.state.uploadStatus = 500;
      await publish(c).click();
      await c.page.getByRole("alert").filter({ hasText: TEXT.en.partial }).waitFor();
      assert.deepEqual(c.state.writes.map((item) => item.type), ["raw", "form"]);
      for (const [index, item] of c.state.writes.entries()) {
        const params = new URL(item.url).searchParams;
        assert.equal(params.get("id"), ID);
        assert.equal(params.get("category"), "novel");
        assert.equal(params.get("isbn"), "", "explicit empty ISBN reaches both private steps");
        assert.equal(params.get("series"), PRIVATE_ROW.series);
        assert.equal(params.get("seriesNumber"), "3");
        assert.equal(params.get("kind"), index === 0 ? null : "private");
      }
      check("private uses its own catalog and raw-then-multipart order; second-step failure clearly reports partial success");
    } finally { await clean(c); }
  }
  {
    const c = await newCase(browser);
    try {
      await c.page.locator('[data-admin-tab="lists"]').click();
      const rowUpload = c.page.locator('[data-admin-list-upload]').filter({ visible: true });
      await eventually(() => rowUpload.count(), (value) => value === 2, "both catalog rows load in lists tab");
      await c.page.locator("[data-admin-list-file]").setInputFiles({ name: `${ID}.glossary.json`, mimeType: "application/json", buffer: GLOSSARY });
      await c.page.locator(`[data-admin-list-book="${ID}"]`).selectOption(`public:${ID}`);
      await c.page.locator("[data-admin-list-publish]").click();
      await eventually(async () => ({ text: await c.page.locator("[data-admin-lists]").innerText(), writes: c.state.writes }), (value) => value.text.includes(TEXT.en.budget), "public list budget message");
      assert.deepEqual(c.state.writes.map((item) => item.type), ["raw"]);
      const url = new URL(c.state.writes[0].url);
      assert.equal(url.searchParams.get("catalog"), "public");
      assert.equal(url.searchParams.get("id"), ID);
      check("public word-list tab shows the specific CPU-budget denial and keeps raw source bytes");
    } finally { await clean(c); }
  }

  {
    const c = await newCase(browser);
    try {
      await c.page.locator('[data-admin-tab="lists"]').click();
      const publicUpload = c.page.locator(`[data-admin-list-upload="public:${ID}"]`);
      await publicUpload.waitFor();
      const chooser = c.page.waitForEvent("filechooser");
      await publicUpload.click();
      await (await chooser).setFiles({ name: `${ID}.glossary.json`, mimeType: "application/json", buffer: GLOSSARY });
      await c.page.locator(`[data-admin-list-note="public:${ID}"]`).filter({ hasText: TEXT.en.budget }).waitFor();
      assert.deepEqual(c.state.writes.map((item) => item.type), ["raw"]);
      const url = new URL(c.state.writes[0].url);
      assert.equal(url.searchParams.get("catalog"), "public");
      assert.equal(url.searchParams.get("id"), ID);
      check("public row upload captures the chosen file before reset and displays CPU-budget denial");
    } finally { await clean(c); }
  }

}
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), chromiumSandbox: true,
});
try {
  await run(browser);
  console.log(`\nPASS: ${checks} admin-book upload checks; all API/content fixtures stayed offline.`);
} finally { await browser.close(); }
