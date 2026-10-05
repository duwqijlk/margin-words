/* Margin Words offline shell. Written by the build. Do not edit. */
const CACHE = "margin-words-shell-__VERSION__";
// Books saved after the app fetches them. A separate cache that new app versions keep.
const BOOKS = "margin-words-books-v1";
const FILES = __FILES__;
// "" when book files are on this origin. Otherwise the books host (CORS responses only).
const BOOKS_ORIGIN = __BOOKS_ORIGIN__;

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
          // Every cache of this origin that is not the current shell or the saved books is old
          // (older shells, and leftovers of earlier workers). Nothing stale may answer a request.
          keys.filter((key) => key !== CACHE && key !== BOOKS).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function bookPath(url) {
  if (url.origin === self.location.origin) {
    const scope = new URL(self.registration.scope).pathname;
    const path = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname.replace(/^\//, "");
    return path;
  }
  if (BOOKS_ORIGIN && url.origin === BOOKS_ORIGIN) return url.pathname.replace(/^\//, "");
  return null;
}

function isBookData(path) {
  if (!path) return false;
  if (path.startsWith("word-lists/")) return path.endsWith(".json");
  if (path.startsWith("public-books/")) return !path.endsWith(".zip");
  return false;
}

// Open one cache by name. Saving a new word list (a large EPUB or glossary) holds the books
// cache; a lookup that also opens that cache freezes the page scripts until the save finishes,
// so a refresh after a dictionary update stays blank or reloads.
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
  const path = bookPath(url);
  if (path === null) return;
  // Account API calls must go to the network. A cached copy would serve stale sync data.
  if (path.startsWith("api/")) return;
  // Book packs the user sideloads are stored in IndexedDB. Never keep them here.
  if (path.startsWith("packs/")) return;
  // Classics and word lists: network first, then the copy saved after a successful fetch.
  // Install does not download these. Opaque (non-CORS) responses are not stored.
  if (isBookData(path)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.status === 200 && response.type !== "opaque") {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(BOOKS)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined),
            );
          }
          return response;
        })
        .catch(() =>
          caches.open(BOOKS).then((cache) =>
            cache.match(request).then((hit) => hit || Promise.reject(new Error("offline"))),
          ),
        ),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
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
