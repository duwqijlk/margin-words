// What search engines read: the head and introduction built into index.html (scripts/seo-plugin.mjs),
// robots.txt, the sitemap, and the title / canonical / index rule of each screen (src/lib/page-meta.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applySeo, escapeHtml, INTRO_ID, readSeo, sitemapXml } from "./seo-plugin.mjs";
import { pageMeta, SITE } from "../src/lib/page-meta.ts";
import { en } from "../src/lib/i18n-en.ts";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const seo = readSeo();
// Chinese is written as \u escapes: no Chinese in scripts/ (AGENTS.md).
const html = applySeo(read("index.html"), seo);

test("the keywords lead with English reader, then original books, then comprehensible input", () => {
  assert.deepEqual(seo.keywords.slice(0, 3), ["\u82f1\u8bed\u9605\u8bfb\u5668", "\u82f1\u8bed\u539f\u8457\u9605\u8bfb\u5668", "\u53ef\u7406\u89e3\u8f93\u5165\u9605\u8bfb\u5668"]);
  assert.ok(seo.title.startsWith("\u82f1\u8bed\u9605\u8bfb\u5668"), seo.title);
  for (const word of ["\u82f1\u8bed\u539f\u8457\u9605\u8bfb\u5668", "\u53ef\u7406\u89e3\u8f93\u5165\u9605\u8bfb\u5668"]) assert.ok(seo.title.includes(word), word);
  for (const word of ["\u82f1\u8bed\u9605\u8bfb\u5668", "\u82f1\u8bed\u539f\u8457\u9605\u8bfb\u5668", "\u53ef\u7406\u89e3\u8f93\u5165\u9605\u8bfb\u5668"]) assert.ok(seo.description.includes(word), word);
});

test("index.html carries the title, description, keywords and Open Graph tags", () => {
  assert.match(html, /<html lang="zh-CN"/);
  assert.ok(html.includes(`<title>${escapeHtml(seo.title)}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${escapeHtml(seo.description)}" />`));
  assert.ok(html.includes(`<meta name="keywords" content="${escapeHtml(seo.keywords.join(","))}" />`));
  assert.ok(html.includes(`<meta property="og:url" content="${SITE}/" />`));
  assert.equal((html.match(/<meta\s+name="description"/g) ?? []).length, 1, "one description");
  // Every address answers with this file: a fixed canonical would make /discover/ a copy of home.
  assert.doesNotMatch(html, /rel="canonical"/);
});

test("the JSON-LD parses and names the site and the web app", () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(raw, "JSON-LD present");
  const ld = JSON.parse(raw);
  const types = ld["@graph"].map((node) => node["@type"]);
  assert.deepEqual(types, ["WebSite", "WebApplication"]);
  for (const node of ld["@graph"]) {
    assert.equal(node.url, `${SITE}/`);
    assert.ok(node.alternateName.includes("\u82f1\u8bed\u539f\u8457\u9605\u8bfb\u5668"));
  }
  assert.equal(ld["@graph"][1].offers.price, "0");
});

test("the introduction sits inside #root with one h1, headings and links to the public pages", () => {
  const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)?.[1] ?? "";
  assert.ok(root.includes(`id="${INTRO_ID}"`), "introduction inside #root (React replaces it)");
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((root.match(/<h2[\s>]/g) ?? []).length, seo.intro.sections.length);
  for (const href of ["/discover/", "/guide/", "/dashboard/"]) assert.ok(root.includes(`href="${href}"`), href);
  // A browser that runs scripts never paints it; the boot notice does not take it for the app.
  assert.ok(html.includes(`html[data-js] #${INTRO_ID}{display:none}`));
  assert.ok(html.includes('document.documentElement.setAttribute("data-js","")'));
  assert.ok(html.includes('!document.getElementById("seo-intro")'), "mounted() ignores the introduction");
});

test("text is escaped and a changed index.html fails the build instead of shipping without SEO", () => {
  assert.equal(escapeHtml('a<b>"c"&'), "a&lt;b&gt;&quot;c&quot;&amp;");
  assert.throws(() => applySeo("<html><head></head><body></body></html>", seo), /index\.html has no/);
});

test("the sitemap lists the public pages and robots.txt points to it", () => {
  const xml = sitemapXml(seo, "2026-10-29");
  for (const path of ["/", "/discover/", "/guide/", "/dashboard/"]) {
    assert.ok(xml.includes(`<loc>${SITE}${path}</loc><lastmod>2026-10-29</lastmod>`), path);
  }
  assert.doesNotMatch(xml, /\/(words|review|read|admin)\//);
  const robots = read("public/robots.txt");
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, "m"));
  for (const path of ["/api/", "/admin/", "/words/", "/review/", "/read/"]) assert.match(robots, new RegExp(`^Disallow: ${path}$`, "m"));
  assert.doesNotMatch(robots, /^Disallow: \/$/m, "the site itself is open");
});

test("each screen has its title, canonical address and index rule", () => {
  assert.deepEqual(pageMeta({ kind: "shelf" }), { titleKey: null, canonical: `${SITE}/`, index: true });
  assert.deepEqual(pageMeta({ kind: "discover" }), { titleKey: "seo.title.discover", canonical: `${SITE}/discover/`, index: true });
  assert.deepEqual(pageMeta({ kind: "guide" }), { titleKey: "seo.title.guide", canonical: `${SITE}/guide/`, index: true });
  assert.deepEqual(pageMeta({ kind: "dashboard" }), { titleKey: "seo.title.dashboard", canonical: `${SITE}/dashboard/`, index: true });
  for (const route of [{ kind: "words", bookId: null }, { kind: "review", bookId: "x" }, { kind: "admin" }, { kind: "read", bookId: "x" }]) {
    const meta = pageMeta(route);
    assert.equal(meta.index, false, route.kind);
    assert.equal(meta.canonical, null, route.kind);
    assert.ok(meta.titleKey && meta.titleKey in en, route.kind);
  }
  assert.equal(pageMeta({ kind: "read", bookId: "x" }, true).titleKey, "seo.title.read");
});
