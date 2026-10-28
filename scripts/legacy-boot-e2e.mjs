#!/usr/bin/env node
/**
 * The two builds, and who gets which one.
 *
 *   node scripts/legacy-boot-e2e.mjs [baseUrl]
 *   BUILD_DIR=local-exports/ipa-word-card/preview node scripts/legacy-boot-e2e.mjs [baseUrl]
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 *
 * Checks:
 *   1. the modern bundle is compiled for the floor in `modernTargets` (Chrome 69): no `?.`,
 *      `??` or private class fields, or the e-ink WebView cannot parse the entry at all
 *   2. the page carries no `import.meta.resolve` probe (Chrome 105+): it used to send every
 *      Chrome 69-104 device to the ES5 build on top of the modern one - two React roots in
 *      `#root`, which is the broken wide-screen layout those readers showed
 *   3. a normal browser loads the modern build alone (SystemJS never starts)
 *   4. an engine without `<script type="module">` (the Kindle browser) still mounts the app from
 *      the `nomodule` build; that engine ignores every module script, which is exactly what the
 *      second pass serves
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const BUILD = join(ROOT, process.env.BUILD_DIR ?? "dist");
const SHOT = join(process.env.SHOT_DIR ?? tmpdir(), "legacy-boot-e2e.png");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ---- 1 and 2: straight from the built files */
let html = "";
try {
  html = readFileSync(join(BUILD, "index.html"), "utf8");
} catch {
  console.log(`FAIL ${BUILD}/index.html not found - build first (see the comment at the top of this file)`);
  process.exit(1);
}
check(!html.includes("__vite_is_modern_browser"), "the page carries no import.meta.resolve probe");
check(/<script nomodule[^>]*polyfills-legacy/.test(html), "the page carries the nomodule polyfills");
check(/<script nomodule[^>]*vite-legacy-entry/.test(html), "the page carries the nomodule entry");

// The probe also went INSIDE the entry chunk as a guard import, which ran before the app did:
// that is what killed Chrome 83 ("Uncaught Error: import.meta.resolve not supported").
const assets = join(BUILD, "assets");
const chunks = readdirSync(assets).filter((name) => name.endsWith(".js") && !name.includes("legacy"));
const guarded = chunks.filter((name) => {
  const code = readFileSync(join(assets, name), "utf8");
  return /import\s*'data:text\/javascript/.test(code) || code.includes("if(!import.meta.resolve)");
});
check(guarded.length === 0, "no chunk boots on an import.meta.resolve probe", guarded.join(", ") || "none");

const entry = (html.match(/<script type="module"[^>]*src="([^"]+)"/) ?? [])[1] ?? "";
if (!entry) {
  check(false, "the page carries the modern entry");
} else {
  const code = readFileSync(join(BUILD, entry.replace(/^\//, "")), "utf8");
  const optional = (code.match(/\?\.[A-Za-z_[(]/g) ?? []).length;
  const nullish = (code.match(/\?\?/g) ?? []).length;
  const fields = /\bclass [^{]*\{[^}]*#[A-Za-z_]\w*\s*[=;(]/.test(code);
  check(
    optional === 0 && nullish === 0 && !fields,
    "the modern entry parses on Chrome 69 (no ?., ?? or private class fields)",
    `${optional} optional, ${nullish} nullish${fields ? ", private field" : ""}`,
  );
}

/* ---- 3 and 4: the two engines */
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});

async function boot(noModules) {
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (noModules) {
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text())
        .replace(/<script type="module"[^>]*><\/script>/g, "")
        .replace(/<script type="module">[\s\S]*?<\/script>/g, "")
        .replace(/<link rel="modulepreload"[^>]*>/g, "")
        .replace(/<script nomodule/g, "<script");
      await route.fulfill({ status: 200, contentType: "text/html", body });
    });
  }
  await page.goto(BASE + "shelf", { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => ({
    // The search-engine introduction (scripts/seo-plugin.mjs) is not the app: it must be gone.
    children: document.getElementById("seo-intro") ? 0 : document.getElementById("root")?.childElementCount ?? -1,
    text: (document.getElementById("root")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    systemLoaded: typeof window.System !== "undefined",
    helpShown: document.getElementById("boot-help")?.hidden === false,
    legacyEntry: document.getElementById("vite-legacy-entry")?.getAttribute("data-src") ?? "",
  }));
  if (noModules) await page.screenshot({ path: SHOT });
  await page.close();
  return { ...state, errors };
}

const modern = await boot(false);
check(modern.children > 0 && !modern.helpShown, "a normal browser mounts the app", `${modern.children} child, "${modern.text}"`);
check(!modern.systemLoaded, "a normal browser never starts the legacy loader");
check(modern.errors.length === 0, "a normal browser has no page errors", modern.errors.join(" | ") || "none");

const legacy = await boot(true);
check(legacy.children > 0 && !legacy.helpShown, "an engine without module scripts mounts the app from nomodule", `${legacy.children} child, "${legacy.text}"`);
check(Boolean(legacy.legacyEntry), "that engine has a legacy entry to load", legacy.legacyEntry || "none");
check(legacy.errors.length === 0, "that engine has no page errors", legacy.errors.join(" | ") || "none");

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
