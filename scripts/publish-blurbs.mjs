#!/usr/bin/env node
/**
 * Upload story summaries for the Discover sheet to the books host (bucket margin-words-books).
 * Written for the agents that draft the summaries: no site build and no deploy are needed.
 *
 *   node scripts/publish-blurbs.mjs --list                 every book id in the LIVE catalogs (and which already have a summary)
 *   node scripts/publish-blurbs.mjs blurbs.json            check only: what would be written, nothing is uploaded
 *   node scripts/publish-blurbs.mjs blurbs.json --upload   check, then upload each summary with wrangler
 *
 * The input file:
 *
 *   { "format": 1, "books": { "<book id>": { "zh": "Chinese summary", "en": "simple English summary" } } }
 *
 * Either language may be left out. Each book's object is replaced as a whole: a language left out
 * is removed from that book. Ids are checked against the live catalogs, so a typo is refused, and
 * each book goes to word-lists/<id>/blurb.json or public-books/<id>/blurb.json by the catalog it is in.
 * Uploading uses the Cloudflare login of this computer (`npx wrangler login`). Keep drafts in
 * local-exports/ (ignored by git); the summaries are not stored in this repository.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blurbFile, blurbKey, blurbProblems, BLURB_ID } from "../src/lib/book-blurb-file.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOKS = "https://books.inputread.site";
const BUCKET = "margin-words-books";

async function getJson(path) {
  const response = await fetch(`${BOOKS}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Every book in the live catalogs: id -> { kind, title, author }. */
export async function liveBooks() {
  const [lists, packs] = await Promise.all([getJson("word-lists/catalog.json"), getJson("public-books/catalog.json")]);
  const books = new Map();
  for (const [kind, rows] of [["lists", lists.lists], ["public", packs.packs]]) {
    for (const row of rows ?? []) {
      if (typeof row?.id === "string" && BLURB_ID.test(row.id) && !books.has(row.id)) {
        books.set(row.id, { kind, title: String(row.title ?? row.id), author: String(row.author ?? "") });
      }
    }
  }
  return books;
}

/** The uploads a draft file asks for, or the reasons it cannot be uploaded. */
export function planUploads(draft, books) {
  const problems = [];
  const uploads = [];
  if (!draft || draft.format !== 1 || !draft.books || typeof draft.books !== "object" || Array.isArray(draft.books)) {
    return { problems: ['the file must be { "format": 1, "books": { "<id>": { "zh": "...", "en": "..." } } }'], uploads };
  }
  for (const [id, value] of Object.entries(draft.books)) {
    const book = books.get(id);
    if (!book) {
      problems.push(`${id}: no book with this id in the live catalogs`);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${id}: must be { "zh": "...", "en": "..." }`);
      continue;
    }
    const found = blurbProblems(value);
    if (found.length) {
      problems.push(`${id}: ${found.join(", ")}`);
      continue;
    }
    uploads.push({ id, title: book.title, key: blurbKey(book.kind, id), file: blurbFile(value) });
  }
  return { problems, uploads };
}

async function list() {
  const books = await liveBooks();
  const rows = [];
  for (const [id, book] of books) {
    const response = await fetch(`${BOOKS}/${blurbKey(book.kind, id)}`, { cache: "no-store" });
    const has = response.ok ? await response.json().catch(() => ({})) : {};
    rows.push(`${id}\t${book.kind}\t${has.zh ? "zh" : "--"}\t${has.en ? "en" : "--"}\t${book.title} / ${book.author}`);
  }
  rows.sort();
  console.log("id\tcatalog\tzh\ten\ttitle / author");
  for (const row of rows) console.log(row);
  console.log(`\n${books.size} books in the live catalogs.`);
}

async function publish(file, upload) {
  const draft = JSON.parse(readFileSync(file, "utf8"));
  const { problems, uploads } = planUploads(draft, await liveBooks());
  for (const line of problems) console.error(`REFUSED ${line}`);
  if (problems.length) {
    console.error(`${problems.length} problem(s). Nothing was uploaded.`);
    process.exit(1);
  }
  const staging = join(ROOT, "local-exports", "blurbs-upload");
  for (const item of uploads) {
    const path = join(staging, item.key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(item.file, null, 1)}\n`);
    const langs = ["zh", "en"].filter((locale) => item.file[locale]).join("+") || "empty";
    if (!upload) {
      console.log(`would write ${item.key} (${langs}) - ${item.title}`);
      continue;
    }
    execFileSync(
      "npx",
      ["wrangler", "r2", "object", "put", `${BUCKET}/${item.key}`, "--file", path, "--content-type", "application/json", "--remote"],
      { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
    );
    console.log(`uploaded ${item.key} (${langs}) - ${item.title}`);
  }
  console.log(upload ? `${uploads.length} summary file(s) uploaded.` : `${uploads.length} file(s) checked. Add --upload to publish them.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const run = args.includes("--list") ? list() : args[0] ? publish(args[0], args.includes("--upload")) : null;
  if (!run) {
    console.error("Usage: node scripts/publish-blurbs.mjs --list | <blurbs.json> [--upload]");
    process.exit(2);
  }
  run.catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
