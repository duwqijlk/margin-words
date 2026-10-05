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

// A decoded body must not keep the encoded length or encoding, or the browser
// shows a blank page.
function responseWithBody(response, body) {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key === "content-encoding" || key === "content-length") return;
    headers.set(key, value);
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

// cache: "reload" on a navigation can come back as status 200 with an empty body.
// A hard refresh skips this worker, so that page looks fine, and the next ordinary
// refresh is blank. An empty body is a miss.
async function usable(response) {
  if (!response || !response.ok) return null;
  try {
    const body = await response.arrayBuffer();
    if (body.byteLength === 0) return null;
    return responseWithBody(response, body);
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // "reload" skips the HTTP cache, so a new version never precaches an old copy of a file.
      // A code file that comes back as the app page (the host's catch-all) must not be stored:
      // the browser would keep parsing HTML as JavaScript and the page would refresh forever.
      // An empty 200 must not be stored either: the next ordinary refresh would be blank.
      await Promise.all(
        FILES.map(async (file) => {
          let stored = null;
          for (const cacheMode of ["reload", "no-store"]) {
            const response = await fetch(new Request(file, { cache: cacheMode }));
            if (!response.ok) continue;
            if (isShellCode(file) && isHtml(response)) continue;
            stored = await usable(response);
            if (stored) break;
          }
          if (!stored) throw new Error(file);
          await cache.put(file, stored);
        }),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The browser starts the document request. Using that response avoids a second
      // fetch that can come back empty on an ordinary refresh.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      // Take the page over before deleting caches. The previous worker saved books into
      // a large cache; deleting that first left it in charge, and a normal refresh stayed blank.
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    })(),
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

async function freshPage(request) {
  const headers = new Headers();
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  // no-store, not reload: reload is the mode that returns an empty 200 on refresh.
  // A new request, not the navigation itself: reusing that request can also come back empty.
  const response = await fetch(request.url, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "follow",
    headers,
  });
  return usable(response);
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
    // Online: the document from the network, when it actually has HTML.
    // An empty 200 is ignored, and the saved page is used instead.
    // Offline: the saved page.
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          const fromPreload = await usable(preload);
          if (fromPreload) return fromPreload;
        } catch {
          // Preload is off, or this navigation has none.
        }
        try {
          const fresh = await freshPage(request);
          if (fresh) return fresh;
        } catch {
          // Offline, or the network returned nothing usable.
        }
        const saved = await savedPage(path, request);
        return saved || Response.error();
      })(),
    );
    return;
  }
  // Scripts and styles: the network first. A cached copy is only for offline.
  // Serving the cache first left a bad copy on screen after a hard refresh had
  // already loaded the real files.
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok && !(isShellCode(path) && isHtml(response))) {
          const length = response.headers.get("content-length");
          if (length !== "0") return response;
        }
      } catch {
        // Offline.
      }
      const cache = await openShell();
      const hit = await cache.match(request);
      if (hit && !(isShellCode(path) && isHtml(hit))) return hit;
      return Response.error();
    })(),
  );
});
