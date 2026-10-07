#!/usr/bin/env node
/**
 * Prepare one public-domain book for the books host without touching the others.
 *
 *   node scripts/publish-public-book.mjs <id> --out /tmp/public-publish
 *   node scripts/publish-public-book.mjs <id> --live catalog.json --out /tmp/public-publish
 *
 * Reads the live public-books catalog (or --live), keeps every other book's
 * EPUB and glossary hash, and adds or replaces only <id>. Writes:
 *   public-books/catalog.json
 *   public-books/<id>/glossary.json
 *   public-books/<id>/book.epub    only when that file's hash differs from live
 *   public-books/<id>/cover.jpg    only when that file's hash differs from live
 *
 * Upload only the files it prints. Do not upload a catalog rebuilt from every
 * book in git: that rewrites hashes for books whose files stay on the old copy.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergePublicCatalog } from "./lib/publish-public-book.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = "https://books.inputread.site/public-books/catalog.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const id = process.argv.slice(2).find((item) => item && !item.startsWith("-"));
const outFlag = flag("--out");
if (!id || !outFlag) {
  console.error("usage: node scripts/publish-public-book.mjs <id> --out <dir> [--live catalog.json]");
  process.exit(1);
}

const local = JSON.parse(readFileSync(join(ROOT, "public-books", "catalog.json"), "utf8"));
const row = (local.packs ?? []).find((item) => item.id === id);
if (!row) {
  console.error(`no public-books catalog row for ${id}`);
  process.exit(1);
}

const livePath = flag("--live");
const live = livePath
  ? JSON.parse(readFileSync(livePath, "utf8"))
  : await (async () => {
      const response = await fetch(LIVE, {
        headers: { "user-agent": UA, accept: "application/json", origin: "https://inputread.site" },
      });
      if (!response.ok) throw new Error(`live catalog HTTP ${response.status}`);
      return response.json();
    })();

const next = mergePublicCatalog(live, row);
const outDir = resolve(outFlag);
const written = [];

function put(name, bytes) {
  const dest = join(outDir, name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  written.push(name);
}

function changed(kind) {
  const prior = (live.packs ?? []).find((item) => item.id === id);
  const before = prior?.[kind]?.sha256 ?? "";
  const after = row?.[kind]?.sha256 ?? "";
  return Boolean(after) && after !== before;
}

put("public-books/catalog.json", Buffer.from(`${JSON.stringify(next, null, 1)}\n`));

const glossaryUrl = String(row.glossary?.url ?? "");
if (!glossaryUrl || glossaryUrl.includes("..")) throw new Error(`missing glossary for ${id}`);
const glossary = readFileSync(join(ROOT, "public-books", glossaryUrl));
if (sha(glossary) !== row.glossary.sha256) {
  throw new Error(`${id}: glossary.json does not match the local catalog hash`);
}
put(`public-books/${glossaryUrl}`, glossary);

for (const kind of ["epub", "cover"]) {
  if (!changed(kind)) continue;
  const url = String(row[kind]?.url ?? "");
  if (!url || url.includes("..")) throw new Error(`missing ${kind} for ${id}`);
  const path = join(ROOT, "public-books", url);
  if (!existsSync(path)) throw new Error(`missing public-books/${url}`);
  const bytes = readFileSync(path);
  if (sha(bytes) !== row[kind].sha256) throw new Error(`${id}: ${url} does not match the local catalog hash`);
  put(`public-books/${url}`, bytes);
}

console.log(
  JSON.stringify(
    {
      id,
      title: row.title,
      words: row.words,
      kept: live.packs.length,
      lists: next.packs.length,
      files: written,
    },
    null,
    2,
  ),
);
