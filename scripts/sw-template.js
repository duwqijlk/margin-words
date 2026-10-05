/* Margin Words offline shell. Written by the build. Do not edit. */
const CACHE = "margin-words-shell-__VERSION__";

// Set when the page asks the worker to step aside (a chunk failed twice).
let passThrough = false;

self.addEventListener("message", (event) => {
  if (event.data === "cibian-bypass") passThrough = true;
});

self.addEventListener("install", (event) => {
  // Take over immediately. Do not fetch the app files here: that fetch used to be
  // stored with encoding headers, and the next ordinary refresh was a blank page.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The previous worker turned preload on. Leaving it on makes the next
      // ordinary refresh blank, even when this worker does not answer the request.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.disable();
      // Take the page over before deleting caches, so the previous worker is gone.
      await self.clients.claim();
      const keys = await caches.keys();
      // Every cache from this origin, including this name: the old copies are what
      // a normal refresh was serving instead of the real page.
      await Promise.all(keys.filter((key) => key === CACHE || key !== CACHE).map((key) => caches.delete(key)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Never answer. A normal refresh must be the browser's own load, the same path
  // as a hard refresh. Responding from here is what left the screen blank.
  // passThrough is the page's request to step aside; there is nothing to answer.
  if (passThrough) return;
  if (event.request.method !== "GET") return;
});
