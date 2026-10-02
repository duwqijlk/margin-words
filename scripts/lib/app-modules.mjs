/**
 * Loads the reader's OWN source files (src/lib/epub.ts, glossary-format.ts, text.ts)
 * inside Node, so the command-line tools split books into chapters and count words
 * exactly like the app. There is no second copy of the rules to keep in sync.
 *
 * How: TypeScript (already a dependency) turns the .ts files into plain JavaScript
 * in node_modules/.cache/glossary-tools, and jsdom stands in for the browser's DOM.
 * Needs: `npm install` once in the project folder.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));

const FILES = ["shelf-identity", "shelf-stacks", "cover-plan", "cover-request", "covers", "router", "flow-text", "errors", "epub", "lexile", "book-meta", "glossary-format", "pack-check", "text", "easy-words", "help-match", "edition-match", "basic-words-data", "basic-words"];

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

/** Returns { epub, format, text, help, basic, packCheck } with the app's own functions. */
export async function loadAppModules() {
  if (cached) return cached;
  installDom();
  let ts;
  try {
    ts = require("typescript");
  } catch {
    throw new Error("typescript is missing. Run `npm install` in the project folder first.");
  }
  const out = join(ROOT, "node_modules", ".cache", "glossary-tools");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
  for (const name of FILES) {
    const source = readFileSync(join(ROOT, "src", "lib", `${name}.ts`), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(/from\s+"(?:@\/lib\/|\.\/)([\w-]+)(?:\.ts)?"/g, 'from "./$1.js"');
    writeFileSync(join(out, `${name}.js`), js);
  }
  // jszip is imported by epub.js: make sure it resolves from this folder.
  const [epub, format, text, help, edition, basicData, basic, packCheck, meta, flow, identity, stacks, coverPlan, covers, router] = await Promise.all(
    ["epub", "glossary-format", "text", "help-match", "edition-match", "basic-words-data", "basic-words", "pack-check", "book-meta", "flow-text", "shelf-identity", "shelf-stacks", "cover-plan", "covers", "router"].map((name) =>
      import(pathToFileURL(join(out, `${name}.js`)).href),
    ),
  );
  cached = { epub, format, text, help, edition, basic: { ...basicData, ...basic }, packCheck, meta, flow, identity, stacks, coverPlan, covers, router };
  return cached;
}

/** Parse an EPUB file the way the app does, and number its words the way the reader does. */
export async function readBook(path) {
  const { epub, format } = await loadAppModules();
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = await epub.parseEpub(buffer, { cover: false });
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const chapters = parsed.chapters.map((chapter) => ({
    title: chapter.title,
    paragraphs: chapter.paragraphs,
    index: format.indexChapterHtml(chapter.html, parse),
  }));
  return { title: parsed.title, author: parsed.author, chapters, bytes };
}
