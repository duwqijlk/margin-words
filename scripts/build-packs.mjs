#!/usr/bin/env node
/**
 * Build the book packs folder and its catalog.
 *
 *   node scripts/build-packs.mjs                 read ./packs/<id>/{book.epub,glossary.json,cover.jpg,info.json}
 *                                                 and write packs/catalog.json, packs/<id>.zip, packs/all-packs.zip
 *   node scripts/build-packs.mjs --from DIR      first make ./packs/<id>/ from DIR/<id>.epub + DIR/<id>.glossary.json
 *                                                 (+ DIR/<id>.jpg and DIR/<id>.info.json, both optional), then build
 *   node scripts/build-packs.mjs --check         write nothing; exit 1 when catalog.json or a zip is out of date
 *   node scripts/build-packs.mjs --out DIR       use DIR instead of ./packs
 *   node scripts/build-packs.mjs --skip-validate do not run the word list validator
 *
 * It is the pack version of the old scripts/update-glossary-index.mjs: the same counts (number of words)
 * and the same `rev` (first 12 letters of the sha256 of the word list file). The word list files are
 * copied byte for byte. They are never edited.
 *
 * The format is described in README.md ("Develop and host") and docs/PACKS_FORMAT.md.
 */
import { committedOn } from "./lib/glossary-date.mjs";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = resolve(option("--out") ?? join(ROOT, "packs"));
const FROM = option("--from") ? resolve(option("--from")) : null;
const CHECK = flag("--check");
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Zip entries get a fixed date, so building twice gives the same bytes (and --check works).
const ZIP_DATE = new Date("2026-01-01T00:00:00Z");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Same pattern as src/lib/lexile.ts. A bad or missing value is left off the catalog.
const LEXILE_RE = /^(?:AD|NC|HL|IG|GN|NP)?\d{1,4}L$|^BR\d{1,4}L$/;
const lexileMeasure = (value) => {
  const clean = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  return LEXILE_RE.test(clean) ? clean : "";
};
// Same checks as src/lib/book-meta.ts.
const isbn13Ok = (digits) => {
  if (!/^97[89]\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
};
const isbnDigits = (value) => {
  const compact = String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  if (isbn13Ok(compact)) return compact;
  if (/^\d{9}[\dX]$/.test(compact)) {
    let sum10 = 0;
    for (let i = 0; i < 10; i += 1) sum10 += (compact[i] === "X" ? 10 : Number(compact[i])) * (10 - i);
    if (sum10 % 11 !== 0) return "";
    const core = `978${compact.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + String((10 - (sum % 10)) % 10);
  }
  return "";
};
const seriesName = (value) => {
  if (typeof value !== "string") return "";
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= 80 ? name : "";
};
const seriesNumber = (value) => {
  const n = typeof value === "number" ? value : /^\d{1,2}$/.test(String(value ?? "").trim()) ? Number(value) : 0;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
};
// Discover tab. Omitted for a novel so an older catalog stays the same.
const contentCategory = (value) => (value === "speech" ? value : "");
const norm = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const fail = (message) => {
  console.error(`build-packs: ${message}`);
  process.exit(1);
};

/** Same numbers as scripts/update-glossary-index.mjs (count, rev) plus the extras counts. */
export function glossaryStats(bytes) {
  const data = JSON.parse(bytes.toString("utf8"));
  const words = Object.keys(data.glossary ?? {});
  return {
    data,
    words: words.length,
    rev: sha(bytes).slice(0, 12),
    paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs.length : 0,
    sentences: Array.isArray(data.sentences) ? data.sentences.length : 0,
    phrases: data.phrases && typeof data.phrases === "object" ? Object.keys(data.phrases).length : 0,
    coined: words.filter((w) => data.glossary[w]?.coined === true).length,
  };
}

function seed(from) {
  const files = readdirSync(from);
  let made = 0;
  for (const name of files.filter((f) => f.endsWith(".epub")).sort()) {
    const id = name.slice(0, -5);
    if (!ID.test(id)) fail(`"${name}" is not a good pack id. Use small letters, numbers, - and _.`);
    const list = join(from, `${id}.glossary.json`);
    const dir = join(OUT, id);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(from, name), join(dir, "book.epub"));
    if (existsSync(list)) copyFileSync(list, join(dir, "glossary.json"));
    for (const ext of ["jpg", "jpeg", "png"]) {
      const cover = join(from, `${id}.${ext}`);
      if (existsSync(cover)) copyFileSync(cover, join(dir, `cover.${ext === "jpeg" ? "jpg" : ext}`));
    }
    const info = join(from, `${id}.info.json`);
    if (existsSync(info) && !existsSync(join(dir, "info.json"))) copyFileSync(info, join(dir, "info.json"));
    made += 1;
  }
  console.log(`Seeded ${made} pack folder(s) from ${from}`);
}

async function loadValidator() {
  if (flag("--skip-validate")) return null;
  const { loadAppModules } = await import("./lib/app-modules.mjs");
  const { format } = await loadAppModules();
  return format;
}


async function zipPack(files) {
  const zip = new JSZip();
  for (const [name, bytes] of files) {
    zip.file(name, bytes, {
      date: ZIP_DATE,
      createFolders: false,
      compression: /\.(epub|jpe?g|png)$/i.test(name) ? "STORE" : "DEFLATE",
    });
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
}

function same(path, bytes) {
  return existsSync(path) && Buffer.compare(readFileSync(path), bytes) === 0;
}

if (!existsSync(OUT) && !FROM) fail(`${OUT} does not exist.`);
if (FROM) {
  if (!existsSync(FROM)) fail(`${FROM} does not exist.`);
  mkdirSync(OUT, { recursive: true });
  if (!CHECK) seed(FROM);
}

const validator = await loadValidator();
const ids = readdirSync(OUT)
  .filter((name) => statSync(join(OUT, name)).isDirectory() && existsSync(join(OUT, name, "book.epub")))
  .sort();
if (ids.length === 0) fail(`No pack folders (with a book.epub) found in ${OUT}.`);

const packs = [];
const zips = new Map(); // file name -> bytes
const allFiles = [];

for (const id of ids) {
  if (!ID.test(id)) fail(`The folder "${id}" is not a good pack id. Use small letters, numbers, - and _.`);
  const dir = join(OUT, id);
  const epub = readFileSync(join(dir, "book.epub"));
  const epubSha = sha(epub);
  const listPath = join(dir, "glossary.json");
  const hasList = existsSync(listPath);
  const list = hasList ? readFileSync(listPath) : null;
  const stats = list ? glossaryStats(list) : null;
  const coverName = ["cover.jpg", "cover.png"].find((name) => existsSync(join(dir, name))) ?? "";
  const cover = coverName ? readFileSync(join(dir, coverName)) : null;
  const info = existsSync(join(dir, "info.json")) ? JSON.parse(readFileSync(join(dir, "info.json"), "utf8")) : {};

  if (stats && validator) {
    const result = validator.validateGlossary(list.toString("utf8"));
    if (!result.ok) fail(`${id}: the word list has errors:\n  ${result.errors.slice(0, 5).join("\n  ")}`);
  }
  if (stats?.data.sha256 && stats.data.sha256 !== epubSha)
    fail(`${id}: the word list says it is for another copy of the book (sha256 does not match book.epub).`);

  const title = String(info.title ?? stats?.data.title ?? id);
  const author = String(info.author ?? stats?.data.author ?? "");
  const level = String(info.level ?? stats?.data.level ?? "");
  const notes = String(info.notes ?? "");
  const lexile = lexileMeasure(info.lexile ?? stats?.data.lexile ?? "");
  const isbn = isbnDigits(info.isbn ?? stats?.data.isbn ?? "");
  const series = seriesName(typeof info.series === "string" ? info.series : stats?.data.series);
  const number = series ? seriesNumber(info.seriesNumber ?? stats?.data.seriesNumber) : 0;
  // Hand-set in info.json. Era alone is not enough: every public-domain book here is old.
  // Flag only when the glossary is dense with archaic words, or the Lexile is high and those words are common.
  const oldReason = String(info.oldFashionedReason ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const oldFields = info.oldFashioned === true ? { oldFashioned: true, ...(oldReason ? { oldFashionedReason: oldReason } : {}) } : {};
  const category = contentCategory(info.category);
  const categoryFields = category ? { category } : {};
  // The pack revision changes when the book file or the word list changes.
  const rev = sha(Buffer.from(`${epubSha}\n${list ? sha(list) : ""}`)).slice(0, 12);
  const files = [["book.epub", epub]];
  if (list) files.push(["glossary.json", list]);
  if (cover) files.push([coverName, cover]);
  files.push([
    "pack.json",
    Buffer.from(
      `${JSON.stringify({ id, title, author, rev, level, notes, ...(lexile ? { lexile } : {}), ...(isbn ? { isbn } : {}), ...(series ? { series, ...(number ? { seriesNumber: number } : {}) } : {}), ...categoryFields, ...oldFields }, null, 1)}\n`,
    ),
  ]);
  const zipBytes = await zipPack(files);
  zips.set(`${id}.zip`, zipBytes);
  for (const [name, bytes] of files) allFiles.push([`${id}/${name}`, bytes]);

  packs.push({
    order: Number(info.order) || 1e6,
    pack: {
      id,
      title,
      author,
      level,
      notes,
      ...(lexile ? { lexile } : {}),
      ...(isbn ? { isbn } : {}),
      ...(series ? { series, ...(number ? { seriesNumber: number } : {}) } : {}),
      ...categoryFields,
      ...oldFields,
      ...(hasList && committedOn(listPath) ? { updated: committedOn(listPath) } : {}),
      rev,
      version: stats?.data.version ?? 2,
      chapters: Number(stats?.data.chapters) || 0,
      words: stats?.words ?? 0,
      paragraphs: stats?.paragraphs ?? 0,
      sentences: stats?.sentences ?? 0,
      phrases: stats?.phrases ?? 0,
      coined: stats?.coined ?? 0,
      epub: { url: `${id}/book.epub`, bytes: epub.length, sha256: epubSha },
      glossary: list
        ? { url: `${id}/glossary.json`, bytes: list.length, sha256: sha(list), rev: stats.rev }
        : { url: "", bytes: 0, sha256: "", rev: "" },
      cover: cover ? { url: `${id}/${coverName}`, bytes: cover.length, sha256: sha(cover) } : null,
      zip: { url: `${id}.zip`, bytes: zipBytes.length, sha256: sha(zipBytes) },
    },
  });
}

packs.sort((a, b) => a.order - b.order || norm(a.pack.title).localeCompare(norm(b.pack.title)));
const catalogOf = (updated) => ({
  format: 1,
  name: "Margin Words book packs",
  updated,
  packs: packs.map((item) => item.pack),
});

const catalogPath = join(OUT, "catalog.json");
const previous = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : null;
// Keep the old date when nothing else changed, so rebuilding does not make noise.
const sameAsBefore =
  previous &&
  JSON.stringify({ ...previous, updated: "", allPacks: undefined }) === JSON.stringify(catalogOf(""));
const updated0 = () => (sameAsBefore ? previous.updated : new Date().toISOString());
const updated = updated0();

// The all-in-one zip holds every pack folder plus a catalog.json, so it unpacks into a folder that is ready to host.
const allZip = new JSZip();
for (const [name, bytes] of allFiles) {
  allZip.file(name, bytes, {
    date: ZIP_DATE,
    createFolders: false,
    compression: /\.(epub|jpe?g|png)$/i.test(name) ? "STORE" : "DEFLATE",
  });
}
const hostable = catalogOf(updated);
hostable.packs = hostable.packs.map((pack) => ({ ...pack, zip: null }));
allZip.file("catalog.json", `${JSON.stringify(hostable, null, 1)}\n`, { date: ZIP_DATE, createFolders: false, compression: "DEFLATE" });
const allBytes = await allZip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
zips.set("all-packs.zip", allBytes);

const catalogText = `${JSON.stringify(catalogOf(updated), null, 1)}\n`;
// The catalog also lists the all-in-one zip, which has its own file entry.
const withAll = JSON.parse(catalogText);
withAll.allPacks = { url: "all-packs.zip", bytes: allBytes.length, sha256: sha(allBytes) };
const finalText = `${JSON.stringify(withAll, null, 1)}\n`;

if (CHECK) {
  const stale = [];
  if (!existsSync(catalogPath) || readFileSync(catalogPath, "utf8") !== finalText) stale.push("catalog.json");
  for (const [name, bytes] of zips) if (!same(join(OUT, name), bytes)) stale.push(name);
  if (stale.length) fail(`out of date: ${stale.join(", ")}. Run: node scripts/build-packs.mjs`);
  console.log(`Packs are up to date (${packs.length} packs).`);
} else {
  writeFileSync(catalogPath, finalText);
  for (const [name, bytes] of zips) writeFileSync(join(OUT, name), bytes);
  const total = [...zips.values()].reduce((sum, b) => sum + b.length, 0);
  console.log(
    `Built ${packs.length} packs in ${OUT}: catalog.json, ${packs.length} pack zips, all-packs.zip (${(allBytes.length / 1048576).toFixed(1)} MB). Zips total ${(total / 1048576).toFixed(1)} MB.`,
  );
}
