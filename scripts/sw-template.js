/* Margin Words offline shell. Written by the build. Do not edit. */
const CACHE = "margin-words-shell-__VERSION__";
// Books saved after the app fetches them. A separate cache that new app versions keep.
const BOOKS = "margin-words-books-v1";
const FILES = __FILES__;
// "" when book files are on this origin. Otherwise the books host (CORS responses only).
const BOOKS_ORIGIN = __BOOKS_ORIGIN__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    // "reload" skips the HTTP cache, so a new version never precaches an old copy of a file.
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const path = bookPath(url);
  if (path === null) return;
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
            event.waitUntil(caches.open(BOOKS).then((cache) => cache.put(request, copy)).catch(() => undefined));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || Promise.reject(new Error("offline")))),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The browser asks for these itself. They must never come from an old copy.
  if (path === "sw.js" || path === "manifest.webmanifest") return;
  if (request.mode === "navigate") {
    // Online: the fresh page, checked with the server every time (never an old HTTP-cached index.html).
    // Offline: the saved page.
    event.respondWith(
      fetch(request, { cache: "no-cache" }).catch(() =>
        // the kit page at kit/ is saved too; every other address (/shelf, /read/...) is the app
        (path.startsWith("kit/") ? caches.match(request) : Promise.resolve(undefined)).then(
          (hit) => hit || caches.match("./index.html").then((app) => app || caches.match("./")),
        ),
      ),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
