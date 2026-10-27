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
 * offlineShell(): after the build, write dist/sw.js. The worker does not precache and does not
 *   answer requests, so a normal refresh is the browser's own load. On activate it turns
 *   navigation preload off and deletes every cache. Old copies kept a decoded body with gzip
 *   headers, and a normal refresh was a blank page. Book files are not cached. It never touches packs/.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import postcss from "postcss";
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
 * in `vite dev` they are served from watched source. Preview serves only the built dist/kit files.
 */
export function guideFolder({ build = buildGuide } = {}) {
  let generated = null;
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip",
  };
  const middleware = async (req, res, next) => {
    const url = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!url.startsWith("/kit")) return next();
    if (url === "/kit") {
      res.statusCode = 301;
      res.setHeader("location", "/kit/");
      return res.end();
    }
    const rel = decodeURIComponent(url.slice(1)).replace(/\/$/, "/index.html");
    // Cache only within dev; file events invalidate even an in-flight build for the next request.
    if (!generated) generated = build().catch((error) => { generated = null; throw error; });
    const hit = (await generated).get(rel);
    if (hit === undefined) return next();
    res.setHeader("content-type", MIME[extname(rel)] ?? "application/octet-stream");
    res.setHeader("cache-control", "no-cache");
    res.end(hit);
  };
  return {
    name: "margin-words:guide",
    configureServer(server) {
      const inputs = [resolve(server.config.root, "docs"), resolve(server.config.root, "examples/sample-book")];
      const invalidate = (file) => {
        if (inputs.some((dir) => {
          const path = relative(dir, resolve(file));
          return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
        })) generated = null;
      };
      server.watcher.add(inputs);
      server.watcher.on("add", invalidate).on("change", invalidate).on("unlink", invalidate);
      server.httpServer?.once("close", () => {
        for (const event of ["add", "change", "unlink"]) server.watcher.off(event, invalidate);
      });
      server.middlewares.use(middleware);
    },
    async generateBundle() {
      for (const [fileName, source] of await build()) this.emitFile({ type: "asset", fileName, source });
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

/** True when this build output is part of the app shell, not book data. */
export function isShellFile(name) {
  if (name.startsWith("public-books/") || name.startsWith("word-lists/")) return false;
  // Instructions for the host (Cloudflare Pages). The host never serves them as files.
  if (name === "_headers" || name === "_redirects" || name === "_routes.json") return false;
  return true;
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
      const files = new Set(["./", "./index.html", "./kit/"]);
      // Book EPUBs, glossaries, covers and catalogs are not part of the shell.
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
        .replace("__FILES__", JSON.stringify([...files].sort()));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/**
 * `dvh` needs Chrome 108. Tailwind 3 has no `dvh` in its spacing scale, but the components use
 * arbitrary values such as `max-h-[52dvh]`, so the built CSS still carries it. This writes a
 * `vh` line before every `dvh` one: on an engine that does not know `dvh`, a panel keeps a
 * height limit instead of growing to cover the screen.
 *
 * (Tailwind 3 writes no `@layer` at all, so the layer unwrapping this replaced is gone.)
 */
export function dvhFallbacks() {
  return {
    name: "margin-words:dvh-fallbacks",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !String(file.fileName).endsWith(".css")) continue;
        file.source = withVhFallbacks(String(file.source));
      }
    },
  };
}

/**
 * Drop the `import.meta.resolve` probes that @vitejs/plugin-legacy puts in the page AND in the
 * entry chunk.
 *
 * The plugin writes two inline MODULE scripts: one sets `__vite_is_modern_browser` when the
 * browser knows `import.meta.resolve`, the other loads the ES5 build when it does not. It also
 * prepends a "legacy guard" to the entry chunk:
 *
 *     import 'data:text/javascript,...;if(!import.meta.resolve)throw Error(...)';
 *     export function __vite_legacy_guard() { ... }
 *
 * That method only exists from Chrome 105. The inline pair therefore sent EVERY engine between
 * our floor (Chrome 69) and 104 into the ES5 build on top of the modern one (two React roots in
 * `#root`), and the guard import makes it far worse: it is evaluated before the entry runs, so
 * the modern app never starts at all. Chrome 83 on the Moaan e-reader died on exactly that line
 * ("Uncaught Error: import.meta.resolve not supported (index-*.js)").
 *
 * Both are removed here. The legacy chunks are still emitted and the `nomodule` tags are the
 * whole fallback: a browser without module support runs exactly those, and a browser with module
 * support runs the modern build alone - the arrangement before the legacy build existed.
 *
 * The one `import.meta.resolve` that stays is inside the CSS preload helper, where it is a
 * guarded ternary (`import.meta.resolve ? ... : new URL(...)`) and runs on no engine's boot path.
 */
export function legacyOnlyWithoutModules() {
  const PROBE = "__vite_is_modern_browser";
  const GUARD_IMPORT = /import\s*'data:text\/javascript,[^']*';?/g;
  return {
    name: "margin-words:legacy-without-probe",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<script type="module">([\s\S]*?)<\/script>/g, (whole, body) =>
          String(body).includes(PROBE) ? "" : whole,
        );
      },
    },
    generateBundle(_options, bundle) {
      // `renderChunk` already stripped the guard; this is only the last line of defence for a
      // chunk the plugin wrote after that hook.
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk" || file.fileName.includes("legacy")) continue;
        file.code = stripLegacyGuard(file.code, GUARD_IMPORT);
      }
    },
    renderChunk(code, chunk) {
      if (chunk.fileName.includes("legacy")) return null;
      const stripped = stripLegacyGuard(code, GUARD_IMPORT);
      // Returning the new code here (and not in `generateBundle`) keeps the file hash honest:
      // `/assets/*` is served `immutable` for a year, so two builds must never share a name.
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

/** Remove the guard import and its exported probe from one chunk. Returns the code unchanged when absent. */
function stripLegacyGuard(code, guardImport) {
  let out = code.replace(guardImport, "");
  const at = out.indexOf("export function __vite_legacy_guard");
  if (at < 0) return out;
  // Its body holds `(async function*(){})`, so braces must be counted, not guessed.
  const open = out.indexOf("{", at);
  let depth = 0;
  for (let index = open; index < out.length; index += 1) {
    const char = out[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return out.slice(0, at) + out.slice(index + 1);
    }
  }
  return out;
}

function withVhFallbacks(css) {
  const root = postcss.parse(css);
  root.walkDecls((decl) => {
    if (!decl.value.includes("dvh")) return;
    const fallback = decl.value.replace(/(\d*\.?\d+)dvh/g, "$1vh");
    if (fallback === decl.value) return;
    decl.cloneBefore({ value: fallback });
  });
  return root.toString();
}
