/* Margin Words offline shell. Written by the build. Do not edit. */
const CACHE = "margin-words-shell-__VERSION__";
// Classics saved after their first download. A separate cache that new app versions keep.
const BOOKS = "margin-words-books-v1";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("margin-words-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const path = url.pathname.slice(scope.length);
  // Book packs are downloaded by the app into IndexedDB. Never keep them here.
  if (path.startsWith("packs/")) return;
  // Word lists: glossary.json and the catalog only. An EPUB under this path is never stored.
  if (path.startsWith("word-lists/")) {
    if (!path.endsWith(".json")) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const copy = response.clone();
            event.waitUntil(caches.open(BOOKS).then((cache) => cache.put(request, copy)).catch(() => undefined));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || Promise.reject(new Error("offline")))),
    );
    return;
  }
  // The free classics (public-books/). Online: always the fresh file, and keep a copy. Offline: the copy.
  // The catalog, covers and the small preinstall books are saved at install. Larger classics are saved when first fetched.
  if (path.startsWith("public-books/") && !path.endsWith(".zip")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const copy = response.clone();
            event.waitUntil(caches.open(BOOKS).then((cache) => cache.put(request, copy)).catch(() => undefined));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || Promise.reject(new Error("offline"))),
        ),
    );
    return;
  }
  if (request.mode === "navigate") {
    // Online: the fresh page. Offline: the saved page.
    event.respondWith(
      fetch(request).catch(() =>
        // the help page at guide/ is saved too; every other page is the app
        (path.startsWith("guide/") ? caches.match(request) : Promise.resolve(undefined)).then(
          (hit) => hit || caches.match("./index.html").then((app) => app || caches.match("./")),
        ),
      ),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
