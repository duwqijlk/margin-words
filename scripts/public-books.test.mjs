import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

// The free public-domain classics that are deployed with the app (public-books/, see public-books/README.md).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(ROOT, "public-books");
const catalog = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("public-books catalog lists the classics and nothing from packs/", () => {
  const ids = catalog.packs.map((p) => p.id);
  for (const id of ["alice", "treasure-island", "anne"]) assert.ok(ids.includes(id), `${id} in catalog`);
  const copyrighted = existsSync(join(ROOT, "packs/catalog.json"))
    ? JSON.parse(readFileSync(join(ROOT, "packs/catalog.json"), "utf8")).packs.map((p) => p.id)
    : [];
  for (const id of ids) assert.ok(!copyrighted.includes(id), `${id} must not be a copyrighted pack`);
});

test("public-books files match the catalog and every word list is valid", async () => {
  const { format } = await loadAppModules();
  for (const pack of catalog.packs) {
    const epub = readFileSync(join(dir, pack.epub.url));
    assert.equal(sha(epub), pack.epub.sha256, `${pack.id} epub sha256`);
    const list = readFileSync(join(dir, pack.glossary.url));
    assert.equal(sha(list), pack.glossary.sha256, `${pack.id} glossary sha256`);
    const result = format.validateGlossary(list.toString("utf8"));
    assert.ok(result.ok, `${pack.id}: ${(result.errors ?? []).slice(0, 3).join("; ")}`);
    if (pack.cover) assert.ok(existsSync(join(dir, pack.cover.url)), `${pack.id} cover`);
  }
});

test("build-packs --out public-books --check says the catalog and zips are up to date", () => {
  const run = spawnSync(process.execPath, ["scripts/build-packs.mjs", "--out", "public-books", "--check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("Looking-Glass images are compressed and the novel text is still valid", () => {
  const pack = catalog.packs.find((item) => item.id === "looking-glass");
  assert.ok(pack, "looking-glass");
  // Was about 9.4 MB before the line-art recompress. It must stay well under that.
  assert.ok(pack.epub.bytes < 5 * 1024 * 1024, `looking-glass epub is ${pack.epub.bytes} bytes`);
  assert.ok(pack.epub.bytes > 2 * 1024 * 1024, "illustrations are still in the book");
});

test("only Alice is preinstalled, and every classic has a Lexile measure", () => {
  const pre = catalog.packs.filter((p) => p.preinstall === true).map((p) => p.id);
  assert.deepEqual(pre, ["alice"]);
  assert.ok(catalog.packs.length >= 12, "12 classics in the catalog");
  for (const pack of catalog.packs) {
    assert.match(pack.lexile, /^(?:AD|NC|HL|IG|GN|NP)?\d{1,4}L$|^BR\d{1,4}L$/, `${pack.id} lexile`);
  }
});

test("the service worker does not precache book files", async () => {
  const { isShellFile } = await import("./vite-plugins.mjs");
  const names = ["index.html", "assets/app.js", "guide/index.html", "guide/book-pack-kit.zip"];
  for (const pack of catalog.packs) {
    names.push(`public-books/${pack.epub.url}`, `public-books/${pack.glossary.url}`);
    if (pack.cover) names.push(`public-books/${pack.cover.url}`);
    names.push(`public-books/${pack.id}.zip`);
  }
  names.push("word-lists/catalog.json", "word-lists/narnia/glossary.json");
  const shell = names.filter((name) => isShellFile(name));
  assert.deepEqual(shell, ["index.html", "assets/app.js", "guide/index.html", "guide/book-pack-kit.zip"]);
});
