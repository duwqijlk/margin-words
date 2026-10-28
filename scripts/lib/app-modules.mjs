/**
 * Loads the reader's OWN source files (src/lib/epub.ts, glossary-format.ts, text.ts)
 * inside Node, so the command-line tools split books into chapters and count words
 * exactly like the app. There is no second copy of the rules to keep in sync.
 *
 * How: TypeScript (already a dependency) turns the .ts files into plain JavaScript
 * in a private directory under node_modules/.cache/glossary-tools; jsdom supplies the DOM.
 * Needs: `npm install` once in the project folder.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));

const FILES = ["cancel-work", "shelf-identity", "cover-plan", "cover-request", "covers", "cloud-cover", "router", "flow-text", "errors", "epub", "lexile", "book-meta", "glossary-format", "pack-check", "text", "easy-words", "help-match", "paragraph-note", "edition-match", "basic-words-data", "basic-words", "word-list-plan", "can-add", "account-store", "file-offer", "hyphenate", "gloss-point", "gloss-ref", "list-updated", "chapter-link"];

function installDom() {
  let JSDOM;
  try {
    ({ JSDOM } = require("jsdom"));
  } catch {
    throw new Error("jsdom is missing. Run `npm install` in the project folder first.");
  }
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const w = dom.window;
  for (const name of ["document", "DOMParser", "NodeFilter", "Node", "Element", "Range"]) {
    Object.defineProperty(globalThis, name, { value: w[name], configurable: true, writable: true });
  }
  if (typeof globalThis.btoa !== "function") globalThis.btoa = w.btoa.bind(w);
}

let cached;
let generatedDir;

/** URL for a generated app module, for tests that load another source module beside the bundle. */
export function appModuleUrl(name) {
  if (!generatedDir) throw new Error("App modules have not been loaded");
  return pathToFileURL(join(generatedDir, `${name}.js`)).href;
}

/** Returns { epub, format, text, help, basic, packCheck } with the app's own functions. */
export function loadAppModules() {
  // Share the in-flight work too: overlapping callers must not reinstall the DOM or rewrite modules.
  if (!cached) {
    cached = Promise.resolve().then(initialize).catch((error) => {
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

async function initialize() {
  installDom();
  let ts;
  try {
    ts = require("typescript");
  } catch {
    throw new Error("typescript is missing. Run `npm install` in the project folder first.");
  }
  const parent = join(ROOT, "node_modules", ".cache", "glossary-tools");
  mkdirSync(parent, { recursive: true });
  // Each attempt owns its files; other test processes can never import a half-written module.
  const out = mkdtempSync(join(parent, "run-"));
  generatedDir = out;
  const cleanup = () => {
    try {
      rmSync(out, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      process.removeListener("exit", cleanup);
    } catch {
      // A locked file can be retried at exit; cleanup must not hide an initialization error.
    }
  };
  process.once("exit", cleanup);
  try {
    writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
    for (const name of FILES) {
      const source = readFileSync(join(ROOT, "src", "lib", `${name}.ts`), "utf8");
      const js = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText.replace(/from\s+"(?:@\/lib\/|\.\/)([\w-]+)(?:\.ts)?"/g, 'from "./$1.js"');
      writeFileSync(join(out, `${name}.js`), js);
    }
    // Stay below node_modules so epub.js can still lazily import jszip.
    // Settle every import before removing failed output; sibling imports may still be reading it.
    const loaded = await Promise.allSettled(
      ["epub", "glossary-format", "text", "help-match", "paragraph-note", "edition-match", "basic-words-data", "basic-words", "pack-check", "book-meta", "flow-text", "shelf-identity", "cover-plan", "covers", "router", "word-list-plan", "can-add", "account-store", "file-offer", "hyphenate", "gloss-ref", "list-updated", "chapter-link", "cloud-cover"].map((name) =>
        import(pathToFileURL(join(out, `${name}.js`)).href),
      ),
    );
    const failed = loaded.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const [epub, format, text, help, paragraphNote, edition, basicData, basic, packCheck, meta, flow, identity, coverPlan, covers, router, wordListPlan, canAdd, accountStore, fileOffer, hyphenate, glossRef, listUpdated, chapterLink, cloudCover] = loaded.map((result) => result.value);
    return { cloudCover, epub, format, text, help, paragraphNote, edition, basic: { ...basicData, ...basic }, packCheck, meta, flow, identity, coverPlan, covers, router, wordListPlan, canAdd, accountStore, fileOffer, hyphenate, glossRef, listUpdated, chapterLink };
  } catch (error) {
    cleanup();
    if (generatedDir === out) generatedDir = undefined;
    throw error;
  }
}

/**
 * Parse an EPUB file the way the app does, and number its words the way the reader does.
 * `options.merge` is the glossary `spine.merge` map. When it is set, those files are
 * appended to their chapters before words are counted, the same call the app makes
 * (`applySpineMerge`). Omitting it leaves the chapter text unchanged.
 * `spineWarnings` is computed on the book before that append, so a key that really
 * merges a file is not reported as idle.
 */
export async function readBook(path, options = {}) {
  const { epub, format } = await loadAppModules();
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let parsed = await epub.parseEpub(buffer, {
    cover: false,
    ...(options.segmentation === 2 ? { segmentation: 2 } : {}),
  });
  const merge = options.merge;
  const spineWarnings =
    merge && typeof merge === "object" ? epub.spineFileWarnings(merge, parsed) : [];
  if (merge && typeof merge === "object" && Object.keys(merge).length > 0)
    parsed = epub.applySpineMerge(parsed, merge);
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const chapters = parsed.chapters.map((chapter) => ({
    title: chapter.title,
    paragraphs: chapter.paragraphs,
    index: format.indexChapterHtml(chapter.html, parse),
  }));
  return {
    title: parsed.title,
    author: parsed.author,
    chapters,
    extras: parsed.extras ?? [],
    spine: parsed.spine ?? [],
    spineWarnings,
    bytes,
  };
}
