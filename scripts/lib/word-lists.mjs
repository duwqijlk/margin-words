/**
 * The copyrighted packs stay out of the public book files as EPUBs. This builds a word-list catalog:
 * title, author, Lexile, ISBN, series, glossary.json, and a card-sized cover.jpg when the pack
 * already has one (the cover image from that book's EPUB). Never an EPUB or a zip.
 * A book with no cover.jpg gets a generated title-and-author cover in the app.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COVER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "resize-cover.py");
const coverCache = new Map();

/** JPEG about 400px wide, from packs/<id>/cover.jpg. Cached for this process. */
export function coverJpeg(path) {
  const st = statSync(path);
  const key = `${path}:${st.mtimeMs}:${st.size}`;
  const hit = coverCache.get(key);
  if (hit) return hit;
  const run = spawnSync("python3", [COVER_SCRIPT, path], { maxBuffer: 8 * 1024 * 1024 });
  if (run.status !== 0 || !run.stdout?.length) {
    const detail = run.stderr?.toString() || String(run.status);
    throw new Error(`cover resize failed for ${path}: ${detail}`);
  }
  coverCache.set(key, run.stdout);
  return run.stdout;
}

const ISBN13 = /^97[89]\d{10}$/;
const ISBN10 = /^\d{9}[\dX]$/;

function isbn13Ok(digits) {
  if (!ISBN13.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}
function isbn10Ok(digits) {
  if (!ISBN10.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (digits[i] === "X" ? 10 : Number(digits[i])) * (10 - i);
  return sum % 11 === 0;
}
function isbnDigits(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  if (isbn13Ok(compact)) return compact;
  if (compact.length === 10 && isbn10Ok(compact)) {
    const core = `978${compact.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + String((10 - (sum % 10)) % 10);
  }
  return "";
}
function seriesName(value) {
  if (typeof value !== "string") return "";
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= 80 ? name : "";
}
function seriesNumber(value) {
  const n = typeof value === "number" ? value : /^\d{1,2}$/.test(String(value ?? "").trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
}
function contentCategory(value) {
  return value === "ted" || value === "speech" ? value : "";
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * @param {string} packsDir
 * @returns {{ catalog: object, files: Array<{ name: string, bytes: Buffer }> }}
 */
export function buildWordLists(packsDir) {
  const ids = readdirSync(packsDir)
    .filter((name) => statSync(join(packsDir, name)).isDirectory())
    .sort();
  const lists = [];
  const files = [];
  for (const id of ids) {
    const listPath = join(packsDir, id, "glossary.json");
    if (!existsSync(listPath)) continue;
    const glossary = readFileSync(listPath);
    const infoPath = join(packsDir, id, "info.json");
    const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : {};
    const data = JSON.parse(glossary.toString("utf8"));
    const isbn = isbnDigits(info.isbn ?? data.isbn ?? "");
    const series = seriesName(info.series ?? data.series ?? "");
    const number = seriesNumber(info.seriesNumber ?? data.seriesNumber);
    const lexile = typeof info.lexile === "string" ? info.lexile : typeof data.lexile === "string" ? data.lexile : "";
    const oldReason = String(info.oldFashionedReason ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    const oldFields = info.oldFashioned === true ? { oldFashioned: true, ...(oldReason ? { oldFashionedReason: oldReason } : {}) } : {};
    const category = contentCategory(info.category);
    const categoryFields = category ? { category } : {};
    const coverPath = join(packsDir, id, "cover.jpg");
    let cover;
    if (existsSync(coverPath)) {
      const jpeg = coverJpeg(coverPath);
      cover = { url: `${id}/cover.jpg`, bytes: jpeg.length, sha256: sha(jpeg) };
      files.push({ name: `word-lists/${id}/cover.jpg`, bytes: jpeg });
    }
    lists.push({
      order: Number(info.order) || 1e6,
      row: {
        id,
        title: String(info.title ?? data.title ?? id),
        author: String(info.author ?? data.author ?? ""),
        ...(lexile ? { lexile } : {}),
        ...(isbn ? { isbn } : {}),
        ...(series ? { series, ...(number ? { seriesNumber: number } : {}) } : {}),
        ...categoryFields,
        ...oldFields,
        ...(cover ? { cover } : {}),
        words: Number(data.count) || Object.keys(data.glossary ?? {}).length,
        glossary: { url: `${id}/glossary.json`, bytes: glossary.length, sha256: sha(glossary) },
      },
    });
    files.push({ name: `word-lists/${id}/glossary.json`, bytes: glossary });
  }
  lists.sort((a, b) => a.order - b.order || a.row.title.localeCompare(b.row.title));
  const catalog = {
    format: 1,
    name: "Word lists",
    updated: new Date().toISOString().slice(0, 10),
    lists: lists.map((item) => item.row),
  };
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 1)}\n`);
  files.unshift({ name: "word-lists/catalog.json", bytes: catalogBytes });
  return { catalog, files };
}
