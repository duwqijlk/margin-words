#!/usr/bin/env node
/**
 * One-time fill of `added` (when a book first came to the catalog) on the live catalogs.
 *
 *   node scripts/backfill-catalog-added.mjs [--out DIR] [--word-lists FILE] [--public FILE]
 *
 * Reads the live `word-lists/catalog.json` and `public-books/catalog.json` from the books host
 * (or the given files), and writes the same catalogs with `added` on every row that has none.
 * Nothing else changes: no row is added, dropped, reordered, or given another file hash.
 *
 * Where the time comes from:
 *   - the first git commit of `packs/<id>/glossary.json` (word lists) or `public-books/<id>/glossary.json`;
 *   - else the row's own `updated`, but never later than the `added` of a row that comes after it.
 *     New rows are appended, so a row's place in the list is the order the books came in.
 *
 * Upload only the two printed files to bucket `margin-words-books`. Run it once; a later publish keeps `added`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOKS = "https://books.inputread.site";
const args = process.argv.slice(2);
const arg = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : "";
};
const OUT = arg("--out") || "/tmp/catalog-added";

function firstCommit(file) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--follow", "--format=%cI", "--", file], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dates = out.trim().split("\n").filter(Boolean);
    return dates.at(-1) ?? "";
  } catch {
    return "";
  }
}

const instant = (value) => {
  const at = typeof value === "string" && value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

/** `added` for every row that has none. Exported for the test. */
export function fillAdded(rows, gitDate) {
  const out = rows.map((row) => ({ ...row }));
  let laterBound = null;
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const row = out[index];
    if (typeof row.added !== "string" || !row.added) {
      const fromGit = gitDate(row.id);
      if (fromGit) row.added = fromGit;
      else {
        const own = instant(row.updated);
        if (own !== null) row.added = laterBound !== null && laterBound < own ? new Date(laterBound).toISOString() : row.updated;
      }
    }
    const at = instant(row.added);
    if (at !== null) laterBound = laterBound === null ? at : Math.min(laterBound, at);
  }
  return out;
}

function assertOnlyAdded(before, after) {
  if (before.length !== after.length) throw new Error("row count changed");
  before.forEach((row, index) => {
    const next = { ...after[index] };
    if (!("added" in row)) delete next.added;
    if (JSON.stringify(next) !== JSON.stringify(row)) throw new Error(`row ${row.id} changed beyond added`);
  });
}

async function load(file, key) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const response = await fetch(`${BOOKS}/${key}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const jobs = [
    { key: "word-lists/catalog.json", file: arg("--word-lists"), list: "lists", dir: "packs" },
    { key: "public-books/catalog.json", file: arg("--public"), list: "packs", dir: "public-books" },
  ];
  for (const job of jobs) {
    const live = await load(job.file, job.key);
    const rows = live[job.list];
    if (!Array.isArray(rows)) throw new Error(`${job.key} has no ${job.list}`);
    const filled = fillAdded(rows, (id) => firstCommit(`${job.dir}/${id}/glossary.json`));
    assertOnlyAdded(rows, filled);
    const missing = filled.filter((row) => !row.added).map((row) => row.id);
    const path = join(OUT, job.key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...live, [job.list]: filled }, null, 1)}\n`);
    console.log(`${job.key}: ${filled.length} rows, ${rows.filter((row) => !row.added).length} filled${missing.length ? `, still none: ${missing.join(", ")}` : ""}`);
  }
  console.log(`\nUpload to bucket margin-words-books (only these two files):`);
  for (const job of jobs) {
    console.log(`  npx wrangler r2 object put "margin-words-books/${job.key}" --file "${join(OUT, job.key)}" --content-type application/json --remote`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
