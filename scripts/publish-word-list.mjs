#!/usr/bin/env node
/**
 * Prepare one word list for the books host without touching the other lists.
 *
 *   node scripts/publish-word-list.mjs <id> --out /tmp/word-list-publish
 *   node scripts/publish-word-list.mjs <id> --live catalog.json --out /tmp/word-list-publish
 *
 * Reads the live word-lists catalog (or --live), keeps every existing row and
 * its glossary hash, and adds or replaces only <id>. Writes:
 *   word-lists/catalog.json
 *   word-lists/<id>/glossary.json
 *   word-lists/<id>/cover.jpg   only when packs/<id>/cover.jpg exists
 *
 * Upload only the files it prints. Do not upload an EPUB, and do not upload
 * the rest of a dist-books folder.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordLists } from "./lib/word-lists.mjs";
import { mergeWordListCatalog } from "./lib/publish-word-list.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = "https://books.inputread.site/word-lists/catalog.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const id = process.argv.slice(2).find((item) => item && !item.startsWith("-"));
const outFlag = flag("--out");
if (!id || !outFlag) {
  console.error("usage: node scripts/publish-word-list.mjs <id> --out <dir> [--live catalog.json]");
  process.exit(1);
}

const { catalog, files } = buildWordLists(join(ROOT, "packs"));
const row = catalog.lists.find((item) => item.id === id);
if (!row) {
  console.error(`no packs/${id}/glossary.json`);
  process.exit(1);
}

const livePath = flag("--live");
const live = livePath
  ? JSON.parse(readFileSync(livePath, "utf8"))
  : await (async () => {
      const response = await fetch(LIVE, { headers: { "user-agent": UA, accept: "application/json" } });
      if (!response.ok) throw new Error(`live catalog HTTP ${response.status}`);
      return response.json();
    })();

const next = mergeWordListCatalog(live, row);
const outDir = resolve(outFlag);
const written = [];

function put(name, bytes) {
  const dest = join(outDir, name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  written.push(name);
}

put("word-lists/catalog.json", Buffer.from(`${JSON.stringify(next, null, 1)}\n`));
const glossary = files.find((file) => file.name === `word-lists/${id}/glossary.json`);
if (!glossary) throw new Error(`missing glossary bytes for ${id}`);
put(glossary.name, glossary.bytes);
if (row.cover) {
  const cover = files.find((file) => file.name === `word-lists/${id}/cover.jpg`);
  if (!cover) throw new Error(`missing cover bytes for ${id}`);
  put(cover.name, cover.bytes);
}

console.log(
  JSON.stringify(
    {
      id,
      category: row.category || "novel",
      title: row.title,
      author: row.author,
      words: row.words,
      sentences: row.sentences,
      phrases: row.phrases,
      kept: live.lists.length,
      lists: next.lists.length,
      files: written,
    },
    null,
    2,
  ),
);
