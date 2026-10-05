/**
 * Files that tell Cloudflare Pages how to serve the app, and the service worker that keeps it fresh.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isShellFile } from "./vite-plugins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** { "/path": ["Header: value", ...] } from a Pages _headers file. */
function headers() {
  const out = {};
  let at = "";
  for (const raw of read("public/_headers").split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      at = raw.trim();
      out[at] = [];
    } else out[at].push(raw.trim());
  }
  return out;
}

test("the page, the service worker and the manifest are always checked with the server", () => {
  const h = headers();
  for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest"]) {
    assert.ok(h[path]?.includes("Cache-Control: no-cache"), `${path} must be Cache-Control: no-cache`);
  }
});

test("hashed files under /assets are cached for good", () => {
  assert.ok(headers()["/assets/*"]?.some((line) => /immutable/.test(line) && /max-age=31536000/.test(line)));
});

test("_redirects sends every other address to index.html, last, and leaves real files alone", () => {
  const rules = read("public/_redirects")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.equal(rules.at(-1), "/* /index.html 200");
  for (const rule of rules.slice(0, -1)) assert.doesNotMatch(rule, /\/assets|\/fonts|\/icons|\/sw\.js|\/manifest/);
  // Cloudflare Pages serves a real file before it looks at a catch-all rule, so /assets/x.js stays a file.
  assert.equal(rules.filter((rule) => rule.startsWith("/*")).length, 1);
});

test("files the reader never opens are not in the site folder", () => {
  // The service worker caches every file in public/. These two were cached on first visit
  // and nothing in the app asked for them.
  assert.equal(existsSync(join(ROOT, "public/og.jpg")), false);
  assert.equal(existsSync(join(ROOT, "public/data/basic-words.txt")), false);
});

test("the host files are not part of the offline shell (they are not served as files)", () => {
  assert.equal(isShellFile("_headers"), false);
  assert.equal(isShellFile("_redirects"), false);
  assert.equal(isShellFile("_routes.json"), false);
  assert.equal(isShellFile("assets/index-abc.js"), true);
  assert.equal(isShellFile("index.html"), true);
});

test("the service worker never answers its own address or the manifest from a cache", () => {
  const sw = read("scripts/sw-template.js");
  assert.match(sw, /path === "sw\.js" \|\| path === "manifest\.webmanifest"/);
  assert.match(sw, /path\.startsWith\("api\/"\)/);
  assert.match(sw, /cache: "reload"/);
  assert.match(
    sw,
    /fetch\(request\.url, \{ cache: "reload", credentials: "same-origin", redirect: "follow", headers \}\)/,
    "a page is always checked with the server, and not by reusing the navigation request",
  );
  assert.doesNotMatch(sw, /caches\.match\(/, "a book being saved must not block a lookup of the app shell");
  assert.match(sw, /caches\.open\(CACHE\)/);
  assert.doesNotMatch(sw, /margin-words-books/, "book files are not written into Cache Storage");
  assert.match(sw, /if \(isBookFile\(path\)\) return;/);
  assert.match(sw, /cibian-bypass/);
  assert.match(sw, /text\/html/);
  assert.match(sw, /key !== CACHE\)/, "every old cache, including a saved book cache, is deleted when a new version starts");
  assert.doesNotMatch(sw, /key !== BOOKS/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
});

test("the app registers the worker from the site root and checks for a new one", () => {
  const main = read("src/main.tsx");
  assert.match(main, /register\("\/sw\.js"/);
  assert.match(main, /updateViaCache: "none"/);
  assert.match(main, /registration\.update\(\)/);
  assert.match(main, /vite:preloadError/);
  assert.match(main, /reloadPlan/);
  assert.match(main, /if \(chunkFailed\) return/, "a healthy load may clear the mark; a failed chunk must not");
});
