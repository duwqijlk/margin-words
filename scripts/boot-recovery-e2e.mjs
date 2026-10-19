#!/usr/bin/env node
/**
 * A page left over from an older deploy must heal itself.
 *
 *   node scripts/boot-recovery-e2e.mjs [baseUrl]
 *   LOOP=1 node scripts/boot-recovery-e2e.mjs [baseUrl]   also check that it does not reload for ever
 *
 * Needs the built app on baseUrl (default http://127.0.0.1:8090/), Playwright and Chrome:
 *   VITE_BOOKS_BASE= npx vite build && npx vite preview --host 127.0.0.1 --port 8090
 *
 * The incident this guards: a reader opened /read/<id> once, the browser kept that day's
 * index.html, the next deploy replaced the chunks it names, and every later visit asked for
 * files that no longer exist. The screen said "the reader is not working in this browser" while
 * incognito worked. The page now reloads itself once with a different URL, which is what makes
 * the browser ask the server instead of its own cache.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://127.0.0.1:8090/").replace(/\/?$/, "/");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});

/** Serve index.html with its entry chunk renamed to a file the server no longer has. */
async function staleHtml() {
  const response = await fetch(`${BASE}index.html`);
  const html = await response.text();
  return html.replace(/(\/assets\/index-[A-Za-z0-9_-]+\.js)/, "/assets/index-GONE.js");
}

/**
 * A request for a page of the app. `?r=` is the retry marker, so it still counts as a page; API
 * calls and files do not, or the first `/api/auth/me` would look like a second stale page.
 */
const isAppPage = (url) =>
  url.origin === new URL(BASE).origin &&
  !url.pathname.startsWith("/assets/") &&
  !url.pathname.startsWith("/api/") &&
  !url.pathname.startsWith("/kit/") &&
  !/\.[a-z0-9]+$/i.test(url.pathname);

const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on("pageerror", (error) => console.log("page error:", error.message));

let staleServed = 0;
let freshServed = 0;
await page.route("**/assets/index-GONE.js", (route) => route.fulfill({ status: 404, body: "not found" }));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (!isAppPage(url)) return route.continue();
  if (url.searchParams.has("r")) {
    freshServed += 1;
    return route.continue();
  }
  staleServed += 1;
  return route.fulfill({ status: 200, contentType: "text/html", body: await staleHtml() });
});

await page.goto(`${BASE}shelf`);
await page.waitForTimeout(3500);

const state = await page.evaluate(() => ({
  url: location.href,
  mounted: (document.querySelector("#root")?.childNodes.length ?? 0) > 0,
  notice: !document.getElementById("boot-help")?.hidden,
}));

check(staleServed === 1, "the stale page is served once", `${staleServed} time(s)`);
check(state.mounted, "the app mounts after the page reloads itself", state.url);
check(/[?&]r=\d+/.test(state.url), "the reload used a fresh URL, not the cached one", state.url);
check(freshServed >= 1, "the second request reached the server", `${freshServed} request(s)`);
check(!state.notice, "the error notice stays hidden");

await page.close();

if (process.env.LOOP === "1") {
  // The deploy really is broken: one retry, then the notice - never a reload loop.
  const stuck = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  let served = 0;
  await stuck.route("**/assets/index-GONE.js", (route) => route.fulfill({ status: 404, body: "not found" }));
  await stuck.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!isAppPage(url)) return route.continue();
    served += 1;
    return route.fulfill({ status: 200, contentType: "text/html", body: await staleHtml() });
  });
  await stuck.goto(`${BASE}shelf`);
  await stuck.waitForTimeout(14000);
  const again = await stuck.evaluate(() => ({
    mounted: (document.querySelector("#root")?.childNodes.length ?? 0) > 0,
    notice: !document.getElementById("boot-help")?.hidden,
  }));
  check(served <= 2, "a broken deploy is not retried in a loop", `${served} page load(s)`);
  check(!again.mounted && again.notice, "a broken deploy ends on the notice, not a blank page");
  await stuck.close();
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
