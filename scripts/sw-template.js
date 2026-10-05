/* Margin Words offline shell. Written by the build. Do not edit. */
const CACHE = "margin-words-shell-__VERSION__";
const FILES = __FILES__;

// Set when the page asks this worker to step aside (a chunk failed twice). The next
// navigation then goes to the network, the same as a hard refresh.
let passThrough = false;

self.addEventListener("message", (event) => {
  if (event.data === "cibian-bypass") passThrough = true;
});

function isShellCode(name) {
  return /\.(?:js|mjs|css|woff2?)$/.test(String(name).split("?")[0]);
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // "reload" skips the HTTP cache, so a new version never precaches an old copy of a file.
      // A code file that comes back as the app page (the host's catch-all) must not be stored:
      // the browser would keep parsing HTML as JavaScript and the page would refresh forever.
      await Promise.all(
        FILES.map(async (file) => {
          const response = await fetch(new Request(file, { cache: "reload" }));
          if (!response.ok) throw new Error(file);
          if (isShellCode(file) && isHtml(response)) throw new Error(file);
          await cache.put(file, response);
        }),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // Every other cache on this origin is old: earlier shells, and the book cache
          // this worker used to fill. Saving a book there froze the page.
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function scopePath(url) {
  if (url.origin !== self.location.origin) return null;
  const scope = new URL(self.registration.scope).pathname;
  return url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname.replace(/^\//, "");
}

function isBookFile(path) {
  return path.startsWith("public-books/") || path.startsWith("word-lists/");
}

function openShell() {
  return caches.open(CACHE);
}

function savedPage(path, request) {
  return openShell().then((cache) => {
    const first = path.startsWith("kit/") ? cache.match(request) : Promise.resolve(undefined);
    return first.then((hit) => hit || cache.match("./index.html").then((app) => app || cache.match("./")));
  });
}

self.addEventListener("fetch", (event) => {
  if (passThrough) return;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const path = scopePath(url);
  if (path === null) return;
  // Account API calls must go to the network. A cached copy would serve stale sync data.
  if (path.startsWith("api/")) return;
  // Book packs the user sideloads are stored in IndexedDB. Never keep them here.
  if (path.startsWith("packs/")) return;
  // Catalogs, covers, EPUBs and word lists. The page fetches these itself and keeps an
  // added book in IndexedDB. Writing the response into Cache Storage holds every other
  // lookup, including the app shell, so a new book or a new word list left the page blank.
  if (isBookFile(path)) return;
  // The browser asks for these itself. They must never come from an old copy.
  if (path === "sw.js" || path === "manifest.webmanifest") return;
  if (request.mode === "navigate") {
    // A fresh GET, not the navigation request itself. Reusing that request can come back
    // empty, and the page stays blank until a hard refresh skips this worker.
    // Online: checked with the server every time. Offline: the saved page.
    const headers = new Headers();
    const accept = request.headers.get("Accept");
    if (accept) headers.set("Accept", accept);
    event.respondWith(
      fetch(request.url, { cache: "reload", credentials: "same-origin", redirect: "follow", headers })
        .then((response) => (response && response.ok ? response : savedPage(path, request)))
        .catch(() => savedPage(path, request))
        .then((response) => response || Response.error()),
    );
    return;
  }
  event.respondWith(
    openShell().then((cache) =>
      cache.match(request).then((hit) => {
        if (hit && !(isShellCode(path) && isHtml(hit))) return hit;
        return fetch(request);
      }),
    ),
  );
});
