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

test("every address of the app is listed in _redirects, and no rule catches the files", () => {
  const rules = read("public/_redirects")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const sources = rules.map((rule) => rule.split(/\s+/)[0]);
  // No catch-all. It would also catch a missing /assets/<hash>.js and answer with index.html and
  // status 200, and /assets is cached for a year: the browser then keeps a page where a script
  // should be, and every refresh stays blank.
  assert.equal(sources.filter((source) => source === "/*").length, 0, "no catch-all rule");
  assert.deepEqual(
    sources.filter((source) => /^\/(assets|fonts|icons)\b/.test(source)),
    [],
    "files are served by Pages, never rewritten",
  );
  // A screen without a line here answers 404 instead of opening the app.
  const heads = new Set([...read("src/lib/router.ts").matchAll(/case "([a-z]+)":/g)].map((match) => match[1]));
  for (const head of heads) {
    assert.ok(
      sources.includes(`/${head}`) || sources.includes(`/${head}/*`),
      `/${head} is a route of the app and needs a line in _redirects`,
    );
  }
  assert.ok(sources.includes("/"), "the root still opens the app");
  assert.ok(sources.includes("/read/*"), "the reader address carries a book id");
});

test("files the reader never opens are not in the site folder", () => {
  // These two used to be copied into the site and stored on the first visit.
  // Nothing in the app asks for them.
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

test("the service worker does not answer a request", () => {
  const sw = read("scripts/sw-template.js");
  // Answering from here is what left a normal refresh blank: a cached file kept gzip
  // headers on an already-decoded body, and onLine was false for the page only.
  assert.doesNotMatch(sw, /respondWith/);
  assert.doesNotMatch(sw, /self\.navigator\.onLine/);
  assert.doesNotMatch(sw, /navigationPreload\.enable/, "preload must stay off or the next refresh is blank");
  assert.match(sw, /navigationPreload\.disable/);
  assert.doesNotMatch(sw, /caches\.match\(/);
  assert.doesNotMatch(sw, /caches\.open\(/);
  assert.doesNotMatch(sw, /margin-words-books/);
  assert.doesNotMatch(sw, /cache:\s*"reload"/);
  assert.doesNotMatch(sw, /cache:\s*"no-store"/);
  assert.match(sw, /cibian-bypass/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /caches\.keys\(\)/);
  assert.match(sw, /key === CACHE \|\| key !== CACHE/, "every cache, including this shell name, is deleted");
  const claim = sw.indexOf("await self.clients.claim()");
  const del = sw.indexOf("caches.delete");
  assert.ok(claim !== -1 && del !== -1 && claim < del, "the new worker takes over before old caches are deleted");
});

test("static files never start a Function", () => {
  const routes = JSON.parse(read("public/_routes.json"));
  // Every Function call is billed and has a CPU budget; a page view loads a dozen chunks, and
  // they used to run through functions/assets/[[path]].ts one invocation each.
  assert.deepEqual(routes.include, ["/api/*"]);
  assert.equal(existsSync(join(ROOT, "functions/assets/[[path]].ts")), false, "the asset guard must be gone");
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
