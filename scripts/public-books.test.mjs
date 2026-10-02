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

test("every deployed file is under the Cloudflare Pages limit (25 MiB)", () => {
  const limit = 25 * 1024 * 1024;
  for (const pack of catalog.packs) {
    for (const ref of [pack.epub, pack.glossary, pack.cover, pack.zip]) {
      if (ref?.url) assert.ok(ref.bytes < limit, `${pack.id}: ${ref.url} is ${ref.bytes} bytes`);
    }
  }
});

test("every public-domain classic is preinstalled and has a Lexile measure", () => {
  const pre = catalog.packs.filter((p) => p.preinstall === true).map((p) => p.id);
  assert.deepEqual(pre, catalog.packs.map((p) => p.id));
  assert.ok(pre.length >= 12, "12 classics in the catalog");
  for (const pack of catalog.packs) {
    assert.match(pack.lexile, /^(?:AD|NC|HL|IG|GN|NP)?\d{1,4}L$|^BR\d{1,4}L$/, `${pack.id} lexile`);
  }
});

test("the service worker precaches the catalog, covers and the small preinstall books", async () => {
  const { PRECACHE_MAX_EPUB_BYTES, publicBooksPrecache } = await import("./vite-plugins.mjs");
  const bundle = {};
  const add = (name, source = "x") => (bundle[`public-books/${name}`] = { source });
  bundle["public-books/catalog.json"] = { source: readFileSync(join(dir, "catalog.json"), "utf8") };
  for (const pack of catalog.packs) {
    add(pack.epub.url);
    add(pack.glossary.url);
    if (pack.cover) add(pack.cover.url);
    add(`${pack.id}.zip`);
  }
  const files = publicBooksPrecache(bundle);
  assert.ok(files.has("public-books/catalog.json"));
  for (const pack of catalog.packs) {
    const small = pack.preinstall === true && pack.epub.bytes <= PRECACHE_MAX_EPUB_BYTES;
    assert.equal(files.has(`public-books/${pack.cover.url}`), true, `${pack.id} cover precached`);
    assert.equal(files.has(`public-books/${pack.epub.url}`), small, `${pack.id} epub`);
    assert.equal(files.has(`public-books/${pack.glossary.url}`), small, `${pack.id} list`);
    assert.equal(files.has(`public-books/${pack.id}.zip`), false);
  }
});
