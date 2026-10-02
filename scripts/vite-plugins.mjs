/**
 * Two small Vite plugins for the static reader.
 *
 * packsFolder(): in `vite` (dev) and `vite preview`, serve the top-level ./packs folder at
 *   /packs/... so "Get books" works while developing. The production build never copies it
 *   (those books are copyrighted; scripts/build-site.mjs can add them on purpose).
 *
 * publicBooks(): the free public-domain classics in ./public-books. Served in dev and preview at
 *   /public-books/... so local and e2e runs need no network. The production build does NOT copy them
 *   into dist/. `npm run build:books` writes them to dist-books/ for the books host.
 *
 * wordLists(): glossary.json, catalog.json, and a resized cover.jpg when the pack has one.
 *   Served in dev and preview. Never an EPUB or a zip. Not copied into dist/.
 *
 * offlineShell(): after the build, write dist/sw.js. It precaches the app shell only (HTML, JS, CSS,
 *   fonts, icons). Book EPUBs and glossaries are cached after the app fetches them, including from
 *   the books host when that response is CORS-readable. It never touches packs/.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { buildGuide } from "./build-guide.mjs";
import { buildWordLists } from "./lib/word-lists.mjs";

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

/**
 * Word lists for the copyrighted books. Dev and preview serve glossary.json, catalog.json, and
 * cover.jpg when the pack has one. The production build does not emit them. Never an EPUB or a zip.
 */
export function wordLists() {
  let packsDir = "";
  return {
    name: "margin-words:word-lists",
    configResolved(config) {
      packsDir = join(config.root, "packs");
    },
    configureServer(server) {
      server.middlewares.use(serveWordLists(() => packsDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveWordLists(() => packsDir));
    },
  };
}

function serveWordLists(dirOf) {
  return (req, res, next) => {
    const url = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!url.startsWith("/word-lists/")) return next();
    const rel = decodeURIComponent(url.slice("/word-lists/".length));
    if (rel.includes("..") || rel.endsWith(".epub") || rel.endsWith(".zip")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const packsDir = dirOf();
    if (rel === "catalog.json") {
      const body = buildWordLists(packsDir).files.find((file) => file.name === "word-lists/catalog.json");
      res.setHeader("content-type", TYPES[".json"]);
      res.setHeader("cache-control", "no-cache");
      res.end(body?.bytes ?? Buffer.from("{}"));
      return;
    }
    const coverMatch = /^([a-z0-9][a-z0-9_-]{0,63})\/cover\.jpg$/.exec(rel);
    if (coverMatch) {
      const body = buildWordLists(packsDir).files.find((file) => file.name === `word-lists/${rel}`);
      if (!body) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("content-type", TYPES[".jpg"]);
      res.setHeader("cache-control", "no-cache");
      res.end(body.bytes);
      return;
    }
    const match = /^([a-z0-9][a-z0-9_-]{0,63})\/glossary\.json$/.exec(rel);
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const file = join(packsDir, match[1], "glossary.json");
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", TYPES[".json"]);
    res.setHeader("cache-control", "no-cache");
    createReadStream(file).pipe(res);
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
  };
}

/**
 * guideFolder(): the tiny offline page at /kit/ (title, a few lines, one Download button) and the download
 * /kit/book-pack-kit.zip. (/guide is the Guide screen of the app, a route of the single-page app.) They are made by scripts/build-guide.mjs and scripts/build-kit.mjs from docs/ and
 * examples/, so the Chinese text never sits in public/. In the build the files are emitted into dist/kit/;
 * in `vite dev` and `vite preview` they are served from memory.
 */
export function guideFolder() {
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".zip": "application/zip" };
  const middleware = async (req, res, next) => {
    const url = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!url.startsWith("/kit")) return next();
    if (url === "/kit") {
      res.statusCode = 301;
      res.setHeader("location", "/kit/");
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

/** Same default as src/lib/books-base.ts. Empty means book files stay on this origin. */
export const DEFAULT_BOOKS_BASE = "https://books.inputread.site";

/** Origin the service worker may cache, or "" when books are same-origin. */
export function booksOriginFromEnv(env, prod) {
  const raw = env?.VITE_BOOKS_BASE;
  if (raw === "" || raw === "." || raw === "./") return "";
  if (typeof raw === "string" && raw.trim()) return raw.trim().replace(/\/+$/, "");
  return prod ? DEFAULT_BOOKS_BASE : "";
}

/** True when this build output is part of the app shell, not book data. */
export function isShellFile(name) {
  if (name.startsWith("public-books/") || name.startsWith("word-lists/")) return false;
  // Instructions for the host (Cloudflare Pages). The host never serves them as files.
  if (name === "_headers" || name === "_redirects") return false;
  return true;
}

export function offlineShell() {
  let publicDir = "";
  let template = "";
  let origin = "";
  return {
    name: "margin-words:offline-shell",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
      template = readFileSync(join(config.root, "scripts", "sw-template.js"), "utf8");
      origin = booksOriginFromEnv(config.env, config.mode === "production");
    },
    generateBundle(_options, bundle) {
      const files = new Set(["./", "./index.html", "./kit/"]);
      // Book EPUBs, glossaries, covers and catalogs are not in the first install.
      // The worker stores a book the first time the app fetches it.
      for (const name of Object.keys(bundle)) {
        if (!isShellFile(name)) continue;
        files.add(`./${name}`);
      }
      for (const name of listFiles(publicDir)) if (name !== "sw.js" && isShellFile(name)) files.add(`./${name}`);
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === "chunk" ? item.code : (item.source ?? ""));
      }
      const version = hash.digest("hex").slice(0, 10);
      const source = template
        .replace("__VERSION__", version)
        .replace("__FILES__", JSON.stringify([...files].sort()))
        .replace("__BOOKS_ORIGIN__", JSON.stringify(origin));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
