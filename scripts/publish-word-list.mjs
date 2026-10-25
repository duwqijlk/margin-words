#!/usr/bin/env node
/**
 * Prepare one word list for the books host without touching the other lists.
 *
 *   node scripts/publish-word-list.mjs <id> --out /tmp/word-list-publish
 *   node scripts/publish-word-list.mjs <id> --live catalog.json --out /tmp/word-list-publish
 *   node scripts/publish-word-list.mjs <id> --out dir --replace-live   (see below)
 *
 * The daily patrol (docs/GLOSSARY_PATROL.md) edits the LIVE glossary: it adds words, fixes meanings and
 * credits readers. Before writing anything this script reads the live glossary of <id> from R2 with
 * wrangler (the public URL refuses glossaries) and stops when the new file would drop a word, change an
 * entry, lose a phrase or lose a reader credit. Bring those over into packs/<id>/glossary.json first, or
 * pass --replace-live when losing them is intended. --live-glossary file.json compares with that file
 * instead (no wrangler).
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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordLists } from "./lib/word-lists.mjs";
import { liveListLosses, mergeWordListCatalog } from "./lib/publish-word-list.mjs";

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

/** The live glossary of this list, or null for a book that is not live yet. */
function liveGlossary() {
  const given = flag("--live-glossary");
  if (given) return JSON.parse(readFileSync(given, "utf8"));
  if (!live.lists.some((item) => item.id === id)) return null;
  const dir = mkdtempSync(join(tmpdir(), "word-list-live-"));
  const file = join(dir, "glossary.json");
  try {
    execFileSync(
      "npx",
      ["wrangler", "r2", "object", "get", `margin-words-books/word-lists/${id}/glossary.json`, "--remote", "--file", `"${file}"`],
      { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
    );
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`cannot read the live glossary of ${id} from R2 (${error instanceof Error ? error.message : error}).`);
    console.error("Sign in with `npx wrangler login`, or pass --live-glossary <file>, or --replace-live.");
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!process.argv.includes("--replace-live")) {
  const current = liveGlossary();
  if (current) {
    const built = files.find((file) => file.name === `word-lists/${id}/glossary.json`);
    const losses = liveListLosses(current, JSON.parse(Buffer.from(built.bytes).toString("utf8")));
    const total = losses.dropped.length + losses.changed.length + losses.credits.length + losses.phrases.length;
    if (total > 0) {
      const show = (label, list) => (list.length ? `  ${label} (${list.length}): ${list.slice(0, 15).join(", ")}${list.length > 15 ? ", ..." : ""}` : "");
      console.error(
        [
          `The new list for ${id} would undo changes made on the live list (often by the daily patrol):`,
          show("words dropped", losses.dropped),
          show("entries changed", losses.changed),
          show("phrases dropped", losses.phrases),
          show("reader credits lost", losses.credits),
          "Bring them into packs/" + id + "/glossary.json, or run again with --replace-live if losing them is intended.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      process.exit(1);
    }
  }
}

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
