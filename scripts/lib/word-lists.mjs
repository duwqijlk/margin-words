/**
 * The copyrighted packs stay out of the site. This builds a word-list catalog:
 * title, author, Lexile, ISBN, series, and glossary.json. Never an EPUB, a cover, or a zip.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
    lists.push({
      order: Number(info.order) || 1e6,
      row: {
        id,
        title: String(info.title ?? data.title ?? id),
        author: String(info.author ?? data.author ?? ""),
        ...(lexile ? { lexile } : {}),
        ...(isbn ? { isbn } : {}),
        ...(series ? { series, ...(number ? { seriesNumber: number } : {}) } : {}),
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
