import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { on } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CACHE = join(ROOT, "node_modules", ".cache", "glossary-tools");
const LOADER = new URL("./lib/app-modules.mjs", import.meta.url).href;
const CHILD_TIMEOUT = 60_000;

// Every scenario gets a fresh module cache and DOM. Keep instrumentation inside the
// child, before importing the loader: syncBuiltinESMExports updates its named fs import.
async function childMain() {
  const { default: assert } = await import("node:assert/strict");
  const { default: fs } = await import("node:fs");
  const { on } = await import("node:events");
  const { basename, dirname, join } = await import("node:path");
  const { syncBuiltinESMExports } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const [mode, loaderUrl, root] = process.argv.slice(1);
  const cache = join(root, "node_modules", ".cache", "glossary-tools");
  const writes = new Map();
  const directories = [];
  const injectedError = new Error("one-shot generated-module write failure");
  let injected = false;
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (path, data, ...args) {
    const dir = dirname(path);
    if (dir === cache || dirname(dir) === cache) {
      // Never corrupt the legacy shared cache, even when run against a regression.
      assert.equal(dirname(dir), cache, "generated modules need a private directory");
      assert.match(basename(dir), /^run-/);
      if (!directories.includes(dir)) {
        directories.push(dir);
        process.send({ type: "directory", dir });
      }
      writes.set(path, (writes.get(path) ?? 0) + 1);
      if (!injected && basename(path) === "epub.js" && mode !== "success") {
        injected = true;
        if (mode === "write-failure") throw injectedError;
        assert.equal(mode, "import-failure");
        data = "export const broken = ;\n";
      }
    }
    return originalWrite.call(this, path, data, ...args);
  };
  syncBuiltinESMExports();

  const { appModuleUrl, loadAppModules, readBook } = await import(loaderUrl);
  assert.throws(() => appModuleUrl("epub"), /not been loaded/);
  const concurrentLoads = () => {
    const pending = Array.from({ length: 6 }, () => loadAppModules());
    for (const promise of pending) assert.strictEqual(promise, pending[0], "share the in-flight promise");
    return pending;
  };
  let failedDir;
  if (mode !== "success") {
    const failures = await Promise.allSettled(concurrentLoads());
    assert.ok(injected, "the requested failure must actually be injected");
    assert.ok(failures.every((result) => result.status === "rejected"));
    for (const result of failures) assert.strictEqual(result.reason, failures[0].reason);
    if (mode === "write-failure") assert.strictEqual(failures[0].reason, injectedError);
    else assert.ok(failures[0].reason instanceof SyntaxError);
    assert.equal(directories.length, 1, "concurrent failures share one initialization");
    [failedDir] = directories;
    assert.equal(fs.existsSync(failedDir), false, "failed output must be removed before rejection");
    assert.throws(() => appModuleUrl("epub"), /not been loaded/);
  }

  const modules = await Promise.all(concurrentLoads());
  for (const value of modules) assert.strictEqual(value, modules[0]);
  assert.equal(typeof modules[0].epub.parseEpub, "function");
  assert.equal(typeof modules[0].format.indexChapterHtml, "function");
  assert.equal(directories.length, failedDir ? 2 : 1);
  const dir = directories.at(-1);
  assert.notEqual(dir, failedDir, "retry must get a new import URL, not a cached ESM rejection");
  assert.ok(fs.existsSync(dir));
  assert.equal(fileURLToPath(appModuleUrl("epub")), join(dir, "epub.js"));
  assert.strictEqual(await import(appModuleUrl("epub")), modules[0].epub);
  const generated = [...writes].filter(([path]) => dirname(path) === dir);
  assert.ok(generated.some(([path]) => basename(path) === "package.json"));
  assert.ok(generated.some(([path]) => basename(path) === "epub.js"));
  assert.ok(generated.some(([path]) => basename(path) === "glossary-format.js"));
  for (const [path, count] of writes) assert.equal(count, 1, `one write per generated file: ${path}`);

  const domNames = ["document", "DOMParser", "NodeFilter", "Node", "Element", "Range"];
  const dom = domNames.map((name) => globalThis[name]);
  const beforeCachedLoad = [...writes];
  assert.strictEqual(await loadAppModules(), modules[0]);
  assert.strictEqual(await loadAppModules(), modules[0]);
  domNames.forEach((name, index) => assert.strictEqual(globalThis[name], dom[index], name));
  assert.deepEqual([...writes], beforeCachedLoad, "cached calls must not transpile again");

  // IPC, rather than timing, holds both processes alive until the parent has
  // checked their directories and has observed the first process's normal exit.
  const commands = on(process, "message");
  process.send({ type: "ready", dir, failedDir, writes: generated.length });
  for await (const [command] of commands) {
    if (command === "exit") {
      process.disconnect();
      break; // Let Node exit naturally so the loader's exit cleanup runs.
    }
    assert.equal(command, "read");
    // Nothing above parses a book: this is the first lazy import of jszip.
    const book = await readBook(join(root, "examples", "sample-book", "the-lantern-seller.epub"));
    assert.equal(book.title, "The Lantern Seller");
    assert.equal(book.chapters.length, 3);
    assert.ok(book.chapters.every((chapter) => chapter.paragraphs.length > 0));
    assert.deepEqual([...writes], beforeCachedLoad);
    process.send({ type: "read", title: book.title, chapters: book.chapters.length });
  }
}

function startChild(t, mode = "success") {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", `(${childMain.toString()})().catch((error) => {
      console.error(error);
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    });`, mode, LOADER, ROOT],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let output = "";
  let timedOut = false;
  let stopped = false;
  const directories = new Set();
  child.stdout.on("data", (data) => { output = (output + data).slice(-12_000); });
  child.stderr.on("data", (data) => { output = (output + data).slice(-12_000); });
  child.on("error", (error) => { output += String(error); });
  child.on("message", (message) => {
    if (message.type === "directory") directories.add(message.dir);
  });
  const messages = on(child, "message", { close: ["close"] });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, CHILD_TIMEOUT);
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      stopped = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  t.after(async () => {
    if (!stopped) child.kill("SIGKILL");
    await closed;
    await messages.return();
    // Forced termination cannot run exit handlers. Remove only directories that
    // this child reported, never the cache root or another test/process's files.
    for (const dir of directories) {
      if (dirname(dir) === CACHE && basename(dir).startsWith("run-")) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  return {
    async receive(type) {
      while (true) {
        const { value, done } = await messages.next();
        if (done) assert.fail(`child ended before ${type}${timedOut ? " (timeout)" : ""}\n${output}`);
        const [message] = value;
        if (message.type === "directory") continue;
        assert.equal(message.type, type);
        return message;
      }
    },
    send(command) { child.send(command); },
    async exit() {
      child.send("exit");
      const result = await closed;
      assert.equal(timedOut, false, `child timed out\n${output}`);
      assert.deepEqual(result, { code: 0, signal: null }, output);
    },
  };
}

function assertPrivateDirectory(dir) {
  assert.equal(dirname(dir), CACHE);
  assert.match(basename(dir), /^run-/);
  assert.ok(existsSync(dir), "output remains available while its owner is alive");
}

test("concurrent and later calls share modules, writes, and the installed DOM", async (t) => {
  const child = startChild(t);
  const ready = await child.receive("ready");
  assertPrivateDirectory(ready.dir);
  assert.ok(ready.writes > 1);
  await child.exit();
  assert.equal(existsSync(ready.dir), false, "normal exit removes the private output");
});

test("live processes have separate outputs; one exit leaves the other's lazy imports usable", async (t) => {
  const first = startChild(t);
  const survivor = startChild(t);
  const [a, b] = await Promise.all([first.receive("ready"), survivor.receive("ready")]);
  assert.notEqual(a.dir, b.dir);
  assertPrivateDirectory(a.dir);
  assertPrivateDirectory(b.dir);
  await first.exit();
  assert.equal(existsSync(a.dir), false);
  assertPrivateDirectory(b.dir);
  survivor.send("read");
  const book = await survivor.receive("read");
  assert.equal(book.title, "The Lantern Seller");
  assert.equal(book.chapters, 3);
  assertPrivateDirectory(b.dir);
  await survivor.exit();
  assert.equal(existsSync(b.dir), false);
});

for (const mode of ["write-failure", "import-failure"]) {
  test(`${mode}: concurrent rejection cleans output and a fresh retry succeeds`, async (t) => {
    const child = startChild(t, mode);
    const ready = await child.receive("ready");
    assert.ok(ready.failedDir);
    assert.notEqual(ready.dir, ready.failedDir);
    assert.equal(existsSync(ready.failedDir), false);
    assertPrivateDirectory(ready.dir);
    child.send("read");
    await child.receive("read");
    await child.exit();
    assert.equal(existsSync(ready.dir), false);
    assert.equal(existsSync(ready.failedDir), false);
  });
}
