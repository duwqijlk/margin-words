#!/usr/bin/env node
/**
 * The daily word-list patrol: readers' "this word has no meaning" signals in, patched word lists out.
 * Written for the agent that runs it once a day with only a Cloudflare login (`npx wrangler login`
 * or CLOUDFLARE_API_TOKEN). No admin login to the site, no site build and no deploy are needed.
 * The full how-to is docs/GLOSSARY_PATROL.md (also at https://inputread.site/kit/patrol.md).
 *
 *   node scripts/glossary-patrol.mjs queue [--out dir]
 *       Read the open work from D1 (read-only) and group it by book. Writes <dir>/queue.json and,
 *       for each book, <dir>/<id>/glossary.json (the LIVE list) and <dir>/<id>/book.epub (for checks).
 *   node scripts/glossary-patrol.mjs publish <id> <patched glossary.json>
 *       Check only: validate the file against the book, compare it with the live list, print the plan.
 *   node scripts/glossary-patrol.mjs publish <id> <patched glossary.json> --upload
 *       Check, then upload the glossary and the catalog to bucket margin-words-books.
 *   node scripts/glossary-patrol.mjs resolve <id> --words w1,w2,...
 *       After a successful upload: mark those words' open taps and missing-meaning reports resolved
 *       with the book's new revision. Prints the SQL first; add --run to execute it.
 *
 * The default --out is local-exports/patrol (ignored by git). Book files never go into git.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWordListPublish, mergeWordListCatalog } from "./lib/publish-word-list.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOKS_HOST = "https://books.inputread.site";
const BOOKS_BUCKET = "margin-words-books";
const PRIVATE_BUCKET = "margin-words-private";
const DB = "margin-words";
const WORK = join(ROOT, "local-exports", "patrol");
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WORD = /^[a-z]+(?:-[a-z]+)?$/;

const args = process.argv.slice(2);
const VALUED = new Set(["--out", "--words"]);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const has = (name) => args.includes(name);
const positional = args.filter((item, i) => !item.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));

const WINDOWS = process.platform === "win32";

/** On Windows `npx` is a .cmd file and needs a shell, which splits on spaces: quote each argument. */
function shellArg(value) {
  const text = String(value);
  if (!WINDOWS) return text;
  if (/["%^]/.test(text)) throw new Error(`cannot pass ${JSON.stringify(text)} to wrangler on Windows`);
  return `"${text}"`;
}

function wrangler(argv) {
  return execFileSync("npx", ["wrangler", ...argv.map(shellArg)], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    shell: WINDOWS,
  });
}

/** Run SQL on the live D1 and return the rows. */
function d1Rows(sql) {
  const out = wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sql.replace(/\s+/g, " ")]);
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

function r2Get(bucket, key, file) {
  mkdirSync(dirname(file), { recursive: true });
  wrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--file", file]);
}

function r2Put(bucket, key, file) {
  wrangler(["r2", "object", "put", `${bucket}/${key}`, "--remote", "--file", file, "--content-type", "application/json"]);
}

async function liveCatalogs() {
  const get = async (path) => {
    const response = await fetch(`${BOOKS_HOST}/${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  const [lists, publicBooks] = await Promise.all([get("word-lists/catalog.json"), get("public-books/catalog.json")]);
  return { lists, publicBooks };
}

/** Every live book: id -> where its list lives, its title and current revision. */
function booksOf({ lists, publicBooks }) {
  const books = new Map();
  for (const row of lists.lists ?? []) {
    books.set(row.id, { id: row.id, kind: "lists", title: row.title, rev: String(row.glossary?.sha256 ?? "").slice(0, 12) });
  }
  for (const row of publicBooks.packs ?? []) {
    if (books.has(row.id)) continue;
    books.set(row.id, { id: row.id, kind: "public", title: row.title, rev: String(row.glossary?.sha256 ?? "").slice(0, 12) });
  }
  return books;
}

const glossaryKey = (book) => `${book.kind === "public" ? "public-books" : "word-lists"}/${book.id}/glossary.json`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** A SQL string literal. Only titles from the live catalog and checked words reach this. */
const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Taps and reports store the reader's device book id (a random id for a word-list book), not the
 * catalog id. The book is found by revision first (exact), then by title.
 */
function matchBook(books, title, rev) {
  if (rev) for (const book of books.values()) if (book.rev === rev) return book;
  for (const book of books.values()) if (book.title === title) return book;
  return undefined;
}

async function queue() {
  const out = resolve(flag("--out") ?? WORK);
  const books = booksOf(await liveCatalogs());
  const taps = d1Rows(
    `SELECT book_title, word, form, chapter, occurrence, context, sentence, glossary_rev, tap_count
       FROM book_word_taps WHERE in_glossary = 0 AND status != 'resolved'
       ORDER BY tap_count DESC, last_tapped_at DESC LIMIT 2000`,
  );
  const reports = d1Rows(
    `SELECT book_title, word, form, chapter, occurrence, context, sentence, glossary_rev, reason
       FROM word_feedback WHERE status != 'resolved' ORDER BY created_at DESC LIMIT 2000`,
  );
  const byBook = new Map();
  const unmatched = [];
  const add = (row, source) => {
    const book = matchBook(books, row.book_title, row.glossary_rev);
    if (!book) {
      unmatched.push({ source, title: row.book_title, word: row.word });
      return;
    }
    const entry = byBook.get(book.id) ?? { ...book, words: new Map() };
    const word = entry.words.get(row.word) ?? { word: row.word, taps: 0, reports: [], places: [] };
    if (source === "tap") word.taps += Number(row.tap_count) || 1;
    else word.reports.push(row.reason);
    if (word.places.length < 5) {
      word.places.push({ chapter: row.chapter, occurrence: row.occurrence, form: row.form, context: row.context, sentence: row.sentence });
    }
    entry.words.set(row.word, word);
    byBook.set(book.id, entry);
  };
  for (const row of taps) add(row, "tap");
  for (const row of reports) add(row, "report");

  const result = [];
  for (const entry of byBook.values()) {
    const words = [...entry.words.values()].sort((a, b) => b.reports.length - a.reports.length || b.taps - a.taps);
    const dir = join(out, entry.id);
    r2Get(BOOKS_BUCKET, glossaryKey(entry), join(dir, "glossary.json"));
    let epub = "";
    try {
      // The EPUB is for checking anchors only. Never upload it, commit it, or quote more than a context.
      const key = entry.kind === "public" ? `public-books/${entry.id}/book.epub` : `${entry.id}/book.epub`;
      r2Get(entry.kind === "public" ? BOOKS_BUCKET : PRIVATE_BUCKET, key, join(dir, "book.epub"));
      epub = join(dir, "book.epub");
    } catch {
      // No EPUB on the host: the list can still be patched with context-only anchors.
    }
    result.push({ id: entry.id, kind: entry.kind, title: entry.title, rev: entry.rev, glossary: join(dir, "glossary.json"), epub, words });
  }
  result.sort((a, b) => b.words.length - a.words.length);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "queue.json"), `${JSON.stringify({ made: new Date().toISOString(), books: result, unmatched }, null, 1)}\n`);
  console.log(JSON.stringify({ out, books: result.map((b) => ({ id: b.id, title: b.title, words: b.words.length })), unmatched: unmatched.length }, null, 1));
}

/** What changed between the live list and the patched one. The patrol may only add words. */
export function patchProblems(live, next) {
  const problems = [];
  for (const [key, value] of Object.entries(live.glossary ?? {})) {
    if (!(key in (next.glossary ?? {}))) problems.push(`removed word "${key}"`);
    else if (JSON.stringify(value) !== JSON.stringify(next.glossary[key])) problems.push(`changed word "${key}"`);
  }
  for (const field of ["version", "title", "author", "chapters", "sha256", "spine", "segmentation", "phrases", "paragraphs", "sentences"]) {
    if (JSON.stringify(live[field] ?? null) !== JSON.stringify(next[field] ?? null)) problems.push(`changed "${field}"`);
  }
  const added = Object.keys(next.glossary ?? {}).filter((key) => !(key in (live.glossary ?? {})));
  if (problems.length === 0 && added.length === 0) problems.push("no new words: nothing to publish");
  return { problems, added };
}

async function publish(id, file) {
  if (!ID.test(id ?? "") || !file) throw new Error("usage: publish <id> <glossary.json> [--upload]");
  const catalogs = await liveCatalogs();
  const book = booksOf(catalogs).get(id);
  if (!book) throw new Error(`${id}: no book with this id in the live catalogs`);
  const bytes = readFileSync(file);
  const next = JSON.parse(bytes.toString("utf8"));

  // 1. The format and, when the EPUB is next to the file, every anchor against the real book.
  const epub = join(dirname(resolve(file)), "book.epub");
  let report;
  try {
    report = execFileSync(process.execPath, [join(ROOT, "scripts", "validate-glossary.mjs"), ...(existsSync(epub) ? [epub] : []), file, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    report = error.stdout ?? "";
  }
  const check = JSON.parse(report || '{"ok":false,"errors":["the validator printed nothing"]}');
  if (!check.ok) throw new Error(`validate-glossary failed:\n  ${(check.errors ?? []).join("\n  ")}`);

  // 2. Only additions: nothing the live list has may disappear or change.
  const liveFile = join(WORK, ".live", `${id}.json`);
  r2Get(BOOKS_BUCKET, glossaryKey(book), liveFile);
  const { problems, added } = patchProblems(JSON.parse(readFileSync(liveFile, "utf8")), next);
  if (problems.length) throw new Error(`the patrol only adds words. Refusing:\n  ${problems.slice(0, 20).join("\n  ")}`);

  // 3. The catalog row, the way the admin publish endpoint writes it (functions/api/admin/word-lists.ts).
  const hash = sha256(bytes);
  const counts = {
    words: Number(next.count) || Object.keys(next.glossary).length,
    paragraphs: Array.isArray(next.paragraphs) ? next.paragraphs.length : 0,
    sentences: Array.isArray(next.sentences) ? next.sentences.length : 0,
    phrases: next.phrases && typeof next.phrases === "object" ? Object.keys(next.phrases).length : 0,
  };
  const now = new Date().toISOString();
  let catalogKey;
  let catalog;
  if (book.kind === "lists") {
    const prior = catalogs.lists.lists.find((row) => row.id === id);
    const row = { ...prior, ...counts, updated: now, glossary: { url: `${id}/glossary.json`, bytes: bytes.byteLength, sha256: hash } };
    catalog = mergeWordListCatalog(catalogs.lists, row, now);
    assertWordListPublish(catalogs.lists, catalog, id);
    catalogKey = "word-lists/catalog.json";
  } else {
    catalog = structuredClone(catalogs.publicBooks);
    const row = catalog.packs.find((item) => item.id === id);
    const oldHash = row.glossary?.sha256 ?? "";
    if (oldHash && oldHash !== hash && row.updated) row.previousUpdated = row.updated;
    Object.assign(row, counts, { updated: now, rev: hash.slice(0, 12) });
    row.glossary = { url: `${id}/glossary.json`, bytes: bytes.byteLength, sha256: hash, rev: hash.slice(0, 12) };
    catalog.updated = now;
    for (const before of catalogs.publicBooks.packs) {
      const after = catalog.packs.find((item) => item.id === before.id);
      if (!after) throw new Error(`refusing to drop ${before.id}`);
      if (before.id !== id && JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`refusing to change ${before.id}`);
    }
    catalogKey = "public-books/catalog.json";
  }
  const catalogFile = join(WORK, ".live", `${id}.catalog.json`);
  writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 1)}\n`);

  const plan = { id, title: book.title, added: added.length, words: added, rev: hash.slice(0, 12), files: [glossaryKey(book), catalogKey], warnings: check.warnings ?? [] };
  console.log(JSON.stringify(plan, null, 1));
  if (!has("--upload")) {
    console.log("Check only. Add --upload to upload these two files.");
    return;
  }
  // The glossary goes first: if the catalog upload fails, Discover keeps pointing at the old file.
  r2Put(BOOKS_BUCKET, glossaryKey(book), resolve(file));
  r2Put(BOOKS_BUCKET, catalogKey, catalogFile);
  console.log(`Uploaded. Next: node scripts/glossary-patrol.mjs resolve ${id} --words ${added.join(",")} --run`);
}

/** The SQL that marks these words done for one book, at its current revision. */
export function resolveSql(title, rev, words, now) {
  const where = `book_title = ${sqlText(title)} AND word IN (${words.map(sqlText).join(", ")})`;
  return [
    `UPDATE book_word_taps SET status = 'resolved', resolved_at = ${now}, resolved_rev = ${sqlText(rev)} WHERE ${where} AND in_glossary = 0 AND status != 'resolved';`,
    `UPDATE word_feedback SET status = 'resolved', resolved_at = ${now}, resolved_rev = ${sqlText(rev)} WHERE ${where} AND reason = 'missing_meaning' AND status != 'resolved';`,
  ].join(" ");
}

async function resolveWords(id) {
  const words = String(flag("--words") ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!ID.test(id ?? "") || words.length === 0 || words.some((w) => !WORD.test(w))) {
    throw new Error("usage: resolve <id> --words w1,w2,... [--run]");
  }
  const book = booksOf(await liveCatalogs()).get(id);
  if (!book) throw new Error(`${id}: no book with this id in the live catalogs`);
  // The rows carry the reader's device id and the title, not the catalog id: match by title.
  const sql = resolveSql(book.title, book.rev, words, Date.now());
  console.log(sql);
  if (!has("--run")) {
    console.log("Printed only. Add --run to execute.");
    return;
  }
  wrangler(["d1", "execute", DB, "--remote", "--command", sql]);
  console.log(`Resolved ${words.length} word(s) of ${id} at revision ${book.rev}.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, ...rest] = positional;
  try {
    if (command === "queue") await queue();
    else if (command === "publish") await publish(rest[0], rest[1]);
    else if (command === "resolve") await resolveWords(rest[0]);
    else {
      console.error("usage: node scripts/glossary-patrol.mjs queue | publish <id> <glossary.json> [--upload] | resolve <id> --words a,b [--run]");
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
