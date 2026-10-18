#!/usr/bin/env node
/**
 * The build an engine WITHOUT `<script type="module">` gets (the Kindle browser).
 *
 *   node scripts/legacy-boot-e2e.mjs [baseUrl]
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 *
 * Such an engine ignores every `type="module"` script, so it runs only the `nomodule` build.
 * This script serves the page with the module tags removed and the `nomodule` ones made plain -
 * exactly the scripts that engine would run - and checks that the app mounts with no error.
 * Without that build the page stayed white: the app never started, and the `<noscript>` line is
 * hidden because JavaScript is on.
 */
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");
const SHOT = join(process.env.SHOT_DIR ?? tmpdir(), "legacy-boot-e2e.png");

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.route("**/", async (route) => {
  const response = await route.fetch();
  const html = (await response.text())
    .replace(/<script type="module"[^>]*><\/script>/g, "")
    .replace(/<script type="module">[\s\S]*?<\/script>/g, "")
    .replace(/<link rel="modulepreload"[^>]*>/g, "")
    .replace(/<script nomodule/g, "<script");
  await route.fulfill({ status: 200, contentType: "text/html", body: html });
});

await page.goto(BASE + "shelf", { waitUntil: "load" });
await page.waitForTimeout(4000);

const state = await page.evaluate(() => ({
  children: document.getElementById("root")?.childElementCount ?? -1,
  text: (document.getElementById("root")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
  entry: document.getElementById("vite-legacy-entry")?.getAttribute("data-src") ?? "",
  helpShown: document.getElementById("boot-help")?.hidden === false,
}));

console.log(`${state.children > 0 ? "ok  " : "FAIL"} the app mounts from the nomodule build - ${state.children} child, "${state.text}"`);
console.log(`${state.entry ? "ok  " : "FAIL"} the page carries a legacy entry - ${state.entry || "none"}`);
console.log(`${state.helpShown ? "FAIL" : "ok  "} the "did not start" notice stays hidden`);
console.log(`${errors.length === 0 ? "ok  " : "FAIL"} no page errors - ${errors.length ? errors.join(" | ") : "none"}`);

await page.screenshot({ path: SHOT });
await browser.close();
process.exit(state.children > 0 && !state.helpShown && errors.length === 0 ? 0 : 1);
