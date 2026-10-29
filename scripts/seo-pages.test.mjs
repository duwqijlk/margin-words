// The built pages behind link previews and search results: one per Discover tab and one per
// catalog book (scripts/seo-pages.mjs, scripts/seo-plugin.mjs), and the routes the app gives them
// (src/lib/router.ts, src/lib/page-meta.ts). Chinese is written as \u escapes (AGENTS.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applySeo, pageHtml, readSeo } from "./seo-plugin.mjs";
import { bookPages, bookRow, bookTexts, categoryPages, clip, STATIC_PAGE_SOURCES } from "./seo-pages.mjs";
import { keptTitle, pageMeta, SITE } from "../src/lib/page-meta.ts";
import { parsePath, pathFor } from "../src/lib/router.ts";

const seo = readSeo();
const ROOT = new URL("../", import.meta.url);
const CATALOG = "https://books.inputread.site/public-books/catalog.json";
const alice = {
  ...bookRow(
    { id: "alice", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", lexile: "880L", words: 1639, phrases: 778, cover: { url: "https://books.inputread.site/covers/public-alice.jpg" } },
    "classic",
    CATALOG,
  ),
  blurb: { zh: "\u7231\u4e3d\u4e1d\u6389\u8fdb\u5154\u5b50\u6d1e\u3002", en: "Alice falls down a rabbit hole." },
};
const talk = bookRow({ id: "a_talk", title: "A <Talk>", author: "Someone", category: "speech", cover: null }, "list", CATALOG);
const novel = bookRow({ id: "charlie", title: "Charlie and the Chocolate Factory", author: "Roald Dahl", cover: { url: "../covers/lists-charlie.jpg" } }, "list", CATALOG);
// A built index.html: the same shape the plugin reads back after Vite has added its scripts.
const built = applySeo(read("index.html"), seo).replace("</head>", '<script type="module" src="/assets/index-x.js"></script></head>');
function read(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

test("catalog rows: ids the router accepts, absolute https covers, speech or novel", () => {
  assert.equal(bookRow({ id: "bad id", title: "x" }, "list", CATALOG), null);
  assert.equal(bookRow({ id: "ok", title: "" }, "list", CATALOG), null);
  assert.equal(novel.cover, "https://books.inputread.site/covers/lists-charlie.jpg", "relative covers resolve against the catalog");
  assert.equal(talk.cover, "");
  assert.equal(talk.category, "speech");
  assert.equal(novel.category, "novel");
});

test("a book page has its own title, description, cover preview, canonical address and text", () => {
  const [page] = bookPages(seo, [alice]);
  assert.equal(page.path, "/book/alice/");
  const html = pageHtml(built, seo, page);
  assert.match(html, /<title>Alice&#39;s|<title>Alice's Adventures in Wonderland /);
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/book/alice/" />`));
  assert.ok(html.includes('<meta property="og:image" content="https://books.inputread.site/covers/public-alice.jpg" />'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary" />'), "a portrait cover is a thumbnail, not cropped to 2:1");
  assert.ok(html.includes('<meta property="og:type" content="book" />'));
  assert.ok(html.includes("\u7231\u4e3d\u4e1d\u6389\u8fdb\u5154\u5b50\u6d1e"), "the summary is on the page");
  assert.ok(html.includes('src="/assets/index-x.js"'), "the page is the app: same scripts as index.html");
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((html.match(/name="description"/g) ?? []).length, 1);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Book");
  assert.equal(ld.author.name, "Lewis Carroll");
  assert.equal("isAccessibleForFree" in ld, false, "the site never calls a book free (AGENTS.md)");
});

test("a book without a cover uses the site picture; titles and text are escaped", () => {
  const [page] = bookPages(seo, [talk]);
  const html = pageHtml(built, seo, page);
  assert.ok(html.includes(`<meta property="og:image" content="${SITE}/social/og.png" />`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(html.includes("A &lt;Talk&gt;"));
  assert.doesNotMatch(html, /<Talk>/);
});

test("each kind of book has its own wording, and the description is clipped", () => {
  const titles = [alice, novel, talk].map((book) => bookTexts(seo, book).title);
  assert.equal(new Set(titles.map((title) => title.replace(/^.*?(?= )/, ""))).size, 3, titles.join(" | "));
  for (const book of [alice, novel, talk]) assert.ok([...bookTexts(seo, book).description].length <= 160);
  assert.equal(clip("abcdef", 4), "abc…");
  assert.equal(clip("abc", 4), "abc");
});

test("the Discover pages list their books with links to the book pages", () => {
  const pages = categoryPages(seo, [alice, novel, talk]);
  assert.deepEqual(pages.map((page) => page.path), ["/discover/", "/discover/novels/", "/discover/speeches/"]);
  const novels = pageHtml(built, seo, pages[1]);
  assert.ok(novels.includes('href="/book/alice/"') && novels.includes('href="/book/charlie/"'));
  assert.doesNotMatch(novels, /href="\/book\/a_talk\/"/);
  assert.ok(novels.includes(`<link rel="canonical" href="${SITE}/discover/novels/" />`));
  assert.ok(pageHtml(built, seo, pages[2]).includes('href="/book/a_talk/"'));
});

test("a built page keeps the boot notice and the site title for the app", () => {
  const html = pageHtml(built, seo, bookPages(seo, [alice])[0]);
  assert.ok(html.includes('id="boot-help"'));
  assert.ok(html.includes(`<meta name="mw-home-title" content="`));
  assert.throws(() => pageHtml("<html><head></head><body></body></html>", seo, bookPages(seo, [alice])[0]), /markers/);
});

test("the router reads and writes the tab and book addresses", () => {
  assert.deepEqual(parsePath("/discover/novels/"), { kind: "discover", category: "novel" });
  assert.deepEqual(parsePath("/discover/speeches"), { kind: "discover", category: "speech" });
  assert.equal(parsePath("/discover/poems/"), null);
  assert.deepEqual(parsePath("/book/death_on_the_nile/"), { kind: "book", bookId: "death_on_the_nile" });
  assert.equal(parsePath("/book/"), null);
  assert.equal(pathFor({ kind: "discover", category: "speech" }), "/discover/speeches/");
  assert.equal(pathFor({ kind: "discover" }), "/discover/");
  assert.equal(pathFor({ kind: "book", bookId: "alice" }), "/book/alice/");
});

test("the app gives each new address its title and canonical address", () => {
  assert.deepEqual(pageMeta({ kind: "discover", category: "novel" }), {
    titleKey: "seo.title.discoverNovels",
    canonical: `${SITE}/discover/novels/`,
    index: true,
  });
  assert.equal(pageMeta({ kind: "discover", category: "speech" }).titleKey, "seo.title.discoverSpeeches");
  assert.deepEqual(pageMeta({ kind: "book", bookId: "alice" }), { titleKey: null, canonical: `${SITE}/book/alice/`, index: true });
  // A book keeps the title it landed with; anywhere else, the site's.
  assert.equal(keptTitle("/book/alice", "/book/alice/", "Alice page", "Site"), "Alice page");
  assert.equal(keptTitle("/shelf/", "/book/alice/", "Alice page", "Site"), "Site");
});

test("no rewrite rule hides a built page, and robots lets the book pages be read", () => {
  const rules = read("public/_redirects").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const rule of rules) {
    const [source, , code] = rule.split(/\s+/);
    if (code === "200") assert.ok(!STATIC_PAGE_SOURCES.includes(source), rule);
  }
  const robots = read("public/robots.txt");
  assert.doesNotMatch(robots, /^Disallow: \/(book|discover)\//m);
});
