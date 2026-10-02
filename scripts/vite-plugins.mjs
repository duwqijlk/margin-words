/**
 * Two small Vite plugins for the static reader.
 *
 * packsFolder(): in `vite` (dev) and `vite preview`, serve the top-level ./packs folder at
 *   /packs/... so "Get books" works while developing. The production build never copies it
 *   (those books are copyrighted; scripts/build-site.mjs can add them on purpose).
 *
 * publicBooks(): the free public-domain classics in ./public-books are the ONLY books the app ships with.
 *   They are served in dev/preview at /public-books/... and emitted into dist/public-books/ by the build
 *   (catalog.json, <id>/book.epub, glossary.json, cover.jpg, and the pack zips).
 *
 * offlineShell(): after the build, write dist/sw.js, a tiny service worker that keeps the app
 *   shell (HTML, JS, CSS, fonts, icons) plus, from public-books/, the catalog, the covers and the
 *   "preinstall" books, so the reader opens with no network. Other classics are cached on first download. It never touches
 *   packs/ or anything from another site. Book data lives in IndexedDB, not in this cache.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { buildGuide } from "./build-guide.mjs";

const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".epub": "application/epub+zip",
  ".zip": "application/zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function serveFrom(dir, prefix = "/packs/") {
  return (req, res, next) => {
    const url = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!url.startsWith(prefix)) return next();
    let rel;
    try {
      rel = decodeURIComponent(url.slice(prefix.length));
    } catch {
      return next();
    }
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader("content-type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("content-length", String(statSync(file).size));
    res.setHeader("cache-control", "no-cache");
    createReadStream(file).pipe(res);
  };
}

export function packsFolder() {
  let dir = "";
  return {
    name: "margin-words:packs-folder",
    configResolved(config) {
      dir = join(config.root, "packs");
    },
    configureServer(server) {
      server.middlewares.use(serveFrom(dir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveFrom(dir));
    },
  };
}

export function publicBooks() {
  let dir = "";
  return {
    name: "margin-words:public-books",
    configResolved(config) {
      dir = join(config.root, "public-books");
    },
    configureServer(server) {
      server.middlewares.use(serveFrom(dir, "/public-books/"));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveFrom(dir, "/public-books/"));
    },
    generateBundle() {
      for (const name of listFiles(dir).filter((n) => n !== "README.md")) {
        this.emitFile({ type: "asset", fileName: `public-books/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

/**
 * guideFolder(): the tiny offline page at ./guide/ (title, a few lines, one Download button) and the download
 * ./guide/book-pack-kit.zip. They are made by scripts/build-guide.mjs and scripts/build-kit.mjs from docs/ and
 * examples/, so the Chinese text never sits in public/. In the build the files are emitted into dist/guide/;
 * in `vite dev` and `vite preview` they are served from memory.
 */
export function guideFolder() {
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".zip": "application/zip" };
  const middleware = async (req, res, next) => {
    const url = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!url.startsWith("/guide")) return next();
    if (url === "/guide") {
      res.statusCode = 301;
      res.setHeader("location", "/guide/");
      return res.end();
    }
    const rel = decodeURIComponent(url.slice(1)).replace(/\/$/, "/index.html");
    const hit = (await buildGuide()).get(rel);
    if (hit === undefined) return next();
    res.setHeader("content-type", MIME[extname(rel)] ?? "application/octet-stream");
    res.setHeader("cache-control", "no-cache");
    res.end(hit);
  };
  return {
    name: "margin-words:guide",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    async generateBundle() {
      for (const [fileName, source] of await buildGuide()) this.emitFile({ type: "asset", fileName, source });
    },
  };
}

function listFiles(dir, base = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), `${base}${entry.name}/`)
      : [`${base}${entry.name}`],
  );
}

/** Files of public-books/ that are saved by the service worker at install time. */
export function publicBooksPrecache(bundle) {
  const out = new Set();
  const catalogItem = bundle["public-books/catalog.json"];
  if (!catalogItem) return out;
  out.add("public-books/catalog.json");
  let packs = [];
  try {
    packs = JSON.parse(String(catalogItem.source)).packs ?? [];
  } catch {
    return out;
  }
  for (const pack of packs) {
    if (pack.cover?.url) out.add(`public-books/${pack.cover.url}`);
    if (pack.preinstall === true) {
      if (pack.epub?.url) out.add(`public-books/${pack.epub.url}`);
      if (pack.glossary?.url) out.add(`public-books/${pack.glossary.url}`);
    }
  }
  return new Set([...out].filter((name) => name in bundle));
}

export function offlineShell() {
  let publicDir = "";
  let template = "";
  return {
    name: "margin-words:offline-shell",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
      template = readFileSync(join(config.root, "scripts", "sw-template.js"), "utf8");
    },
    generateBundle(_options, bundle) {
      const files = new Set(["./", "./index.html", "./guide/"]);
      // Not public-books/: it holds ~25 MB of epubs, too heavy for the first load. Of it we precache only the
      // catalog, every cover, and the books marked "preinstall" (epub + word list). Any other classic is kept
      // by the service worker the first time the app downloads it (see sw-template.js).
      for (const name of Object.keys(bundle)) if (!name.startsWith("public-books/")) files.add(`./${name}`);
      for (const name of publicBooksPrecache(bundle)) files.add(`./${name}`);
      for (const name of listFiles(publicDir)) if (name !== "sw.js") files.add(`./${name}`);
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === "chunk" ? item.code : (item.source ?? ""));
      }
      const version = hash.digest("hex").slice(0, 10);
      const source = template
        .replace("__VERSION__", version)
        .replace("__FILES__", JSON.stringify([...files].sort()));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
