import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";
import { buildGuide, checkDocumentLinks, HOSTED_DOCS } from "./build-guide.mjs";
import { KIT_NAME } from "./build-kit.mjs";
import { guideFolder } from "./vite-plugins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hosted work documents have one source and keep the existing public paths", async () => {
  assert.deepEqual(HOSTED_DOCS, [
    { source: "docs/MAINTENANCE.md", output: "kit/maintenance.md" },
    { source: "docs/BOOK_UPLOAD.md", output: "kit/book-upload.md" },
    { source: "docs/GLOSSARY_PATROL.md", output: "kit/patrol.md" },
    { source: "docs/BOOK_BLURBS.md", output: "kit/book-blurbs.md" },
  ]);
  const files = await buildGuide();
  for (const { source, output } of HOSTED_DOCS) {
    assert.deepEqual(files.get(output), readFileSync(join(ROOT, source)), `${output} must be the unchanged source bytes`);
  }
  assert.deepEqual(checkDocumentLinks(files), []);
});

test("missing shared document and anchor links fail without network access", async () => {
  const files = new Map(await buildGuide());
  files.set("kit/book-upload.md", "[rules](https://inputread.site/kit/missing.md)\n[step](https://inputread.site/kit/maintenance.md#not-a-step)");
  const problems = checkDocumentLinks(files);
  assert.ok(problems.some((p) => p.includes("missing kit/missing.md")));
  assert.ok(problems.some((p) => p.includes("missing anchor kit/maintenance.md#not-a-step")));
  files.delete("kit/patrol.md");
  assert.ok(checkDocumentLinks(files).some((p) => p.includes("missing work document kit/patrol.md")));
});

test("explicit and heading anchors work, while fenced examples are not navigation", async () => {
  const files = new Map(await buildGuide());
  files.set("kit/maintenance.md", '<a id="safety"></a>\n## Reader cache\n');
  files.set("kit/book-upload.md", [
    "[explicit](https://inputread.site/kit/maintenance.md#safety)",
    "[heading](https://inputread.site/kit/maintenance.md#reader-cache)",
    "```md",
    "[example](https://inputread.site/kit/absent.md)",
    "```",
  ].join("\n"));
  files.set("kit/patrol.md", "");
  files.set("kit/book-blurbs.md", "");
  assert.deepEqual(checkDocumentLinks(files), []);
});

test("the authoring ZIP stays separate from maintenance instructions", async () => {
  const files = await buildGuide();
  const zip = await JSZip.loadAsync(files.get(`kit/${KIT_NAME}`));
  assert.deepEqual(Object.keys(zip.files).sort(), [
    "book-pack-spec.md",
    "the-lantern-seller.epub",
    "the-lantern-seller.glossary.json",
    "the-lantern-seller.pack.zip",
  ]);
  const page = files.get("kit/index.html");
  assert.equal((page.match(/data-download/g) ?? []).length, 2);
});

test("guide generation has no shared mutable result between calls", async () => {
  const first = await buildGuide();
  first.set("kit/patrol.md", Buffer.from("stale caller copy"));
  const second = await buildGuide();
  assert.notEqual(first, second);
  assert.deepEqual(second.get("kit/patrol.md"), readFileSync(join(ROOT, "docs/GLOSSARY_PATROL.md")));
});

test("dev guide cache follows source changes while preview never overrides dist", async () => {
  const watcher = new EventEmitter();
  const httpServer = new EventEmitter();
  const watched = [];
  watcher.add = (paths) => watched.push(...paths);
  let middleware;
  let builds = 0;
  let text = "first";
  const plugin = guideFolder({ build: async () => {
    builds++;
    return new Map([["kit/patrol.md", Buffer.from(text)]]);
  } });
  plugin.configureServer({ config: { root: ROOT }, watcher, httpServer,
    middlewares: { use: (handler) => { middleware = handler; } } });
  assert.equal(plugin.configurePreviewServer, undefined, "preview must serve built files, not current docs");
  assert.deepEqual(watched, [join(ROOT, "docs"), join(ROOT, "examples/sample-book")]);
  const request = async () => {
    let body;
    await middleware({ url: "/kit/patrol.md" }, { setHeader() {}, end: (value) => { body = value; } }, () => assert.fail("missing guide"));
    return String(body);
  };
  assert.equal(await request(), "first");
  assert.equal(await request(), "first");
  assert.equal(builds, 1);
  text = "changed";
  watcher.emit("change", join(ROOT, "src/unrelated.ts"));
  assert.equal(await request(), "first");
  for (const [event, file] of [["change", "docs/GLOSSARY_PATROL.md"], ["add", "docs/new.md"],
    ["unlink", "docs/old.md"], ["change", "examples/sample-book/glossary.json"]]) {
    text = `${event}:${file}`;
    watcher.emit(event, join(ROOT, file));
    assert.equal(await request(), text);
  }
  assert.equal(builds, 5);
  const emitted = [];
  text = "fresh build";
  await plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
  assert.equal(String(emitted[0].source), "fresh build", "build must not reuse the dev cache");
  httpServer.emit("close");
  assert.equal(watcher.listenerCount("change"), 0);
});
