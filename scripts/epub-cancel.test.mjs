import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { loadAppModules } from "./lib/app-modules.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const { epub, covers } = await loadAppModules();
const helper = ts.transpileModule(readFileSync(new URL("../src/lib/cancel-work.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { requestScope, readBlobBuffer } = await import(`data:text/javascript,${encodeURIComponent(helper)}`);
const zip = new JSZip();
zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
zip.file("book.opf", '<package><metadata><title>Cancel Test</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
for (const name of ["one", "two"]) zip.file(`${name}.xhtml`, '<html><body><h1>Chapter</h1><p>This is an English paragraph with enough letters to become a real chapter in this cancellation test.</p></body></html>');
const buffer = await zip.generateAsync({ type:"arraybuffer" });
test("already aborted parse never attempts ZIP loading", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(epub.parseEpub(new ArrayBuffer(0), { signal:controller.signal }), { name:"AbortError" });
});
test("abort during JSZip load is observed when that uninterruptible call returns", async () => {
  const controller = new AbortController(); const load = JSZip.loadAsync;
  JSZip.loadAsync = async (...args) => { const result = await load.apply(JSZip, args); controller.abort(); return result; };
  try { await assert.rejects(epub.parseEpub(buffer, { signal:controller.signal }), { name:"AbortError" }); }
  finally { JSZip.loadAsync = load; }
});
test("abort during a document await stops before parsing another chapter", async () => {
  const controller = new AbortController(); const load = JSZip.loadAsync; let touched = false;
  JSZip.loadAsync = async (...args) => {
    const result = await load.apply(JSZip, args);
    const file = result.files["one.xhtml"]; const read = file.async.bind(file);
    file.async = async (...readArgs) => { const text = await read(...readArgs); touched = true; controller.abort(); return text; };
    return result;
  };
  try { await assert.rejects(epub.parseEpub(buffer, { signal:controller.signal }), { name:"AbortError" }); assert.equal(touched, true); }
  finally { JSZip.loadAsync = load; }
});
test("abort on chapter progress is observed at the yield boundary", async () => {
  const controller = new AbortController(); let progress = 0;
  await assert.rejects(epub.parseEpub(buffer, { signal:controller.signal, cover:false, onProgress() { progress++; controller.abort(); } }), { name:"AbortError" });
  assert.equal(progress, 1);
});
test("deadline releases an unresponsive request without AbortSignal.timeout", async () => {
  const scope = requestScope(undefined, 5);
  try { await assert.rejects(scope.run(new Promise(() => {})), { name:"AbortError" }); }
  finally { scope.dispose(); }
});
test("parent cancellation releases pending body work even if it ignores fetch abort", async () => {
  const controller = new AbortController(); const scope = requestScope(controller.signal, 1000);
  const running = scope.run(new Promise(() => {})); controller.abort();
  try { await assert.rejects(running, { name:"AbortError" }); }
  finally { scope.dispose(); }
});
test("a missing AbortController still permits bounded requests", async () => {
  const original = globalThis.AbortController; globalThis.AbortController = undefined;
  const scope = requestScope(undefined, 5);
  try { await assert.rejects(scope.run(new Promise(() => {})), { name:"AbortError" }); }
  finally { scope.dispose(); globalThis.AbortController = original; }
});

test("cover abort rejects even when the remote fetch ignores the signal", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Promise(() => {});
  const controller = new AbortController();
  const pending = covers.fetchCoverData("https://example.test/cover.jpg", "", controller.signal);
  controller.abort();
  try { await assert.rejects(pending, { name:"AbortError" }); }
  finally { globalThis.fetch = original; }
});
test("cover deadline falls back to the EPUB cover instead of holding saving forever", async () => {
  const fetch = globalThis.fetch; const timer = globalThis.setTimeout;
  globalThis.fetch = async () => new Promise(() => {});
  globalThis.setTimeout = (callback, delay, ...args) => timer(callback, delay === 10000 ? 5 : delay, ...args);
  try { assert.equal(await covers.fetchCoverData("https://example.test/cover.jpg", ""), ""); }
  finally { globalThis.fetch = fetch; globalThis.setTimeout = timer; }
});

test("selected and private-library generated Files read with Blob.arrayBuffer removed", async () => {
  const { JSDOM } = require("jsdom"); const window = new JSDOM("").window;
  const originalReader = globalThis.FileReader; globalThis.FileReader = window.FileReader;
  const descriptor = Object.getOwnPropertyDescriptor(window.Blob.prototype, "arrayBuffer");
  delete window.Blob.prototype.arrayBuffer;
  try {
    for (const name of ["selected.epub", "private-library.epub"]) {
      const file = new window.File([new Uint8Array([80,75,3,4])], name, {type:"application/epub+zip"});
      assert.equal(typeof file.arrayBuffer, "undefined");
      assert.deepEqual([...new Uint8Array(await readBlobBuffer(file))], [80,75,3,4]);
    }
  } finally {
    globalThis.FileReader = originalReader;
    if (descriptor) Object.defineProperty(window.Blob.prototype, "arrayBuffer", descriptor);
    window.close();
  }
});
