#!/usr/bin/env node
/**
 * Checks the Discover book summaries in docs/blurbs/{zh,en}.json before they ship:
 *
 *   node scripts/check-blurbs.mjs            (npm run check:blurbs)
 *
 * - each file is { "format": 1, "books": { "<id>": "text" } }
 * - every id is a book in packs/ or public-books/ (a typo would never show)
 * - zh texts contain Chinese; en texts contain none
 * - no text is empty, longer than BLURB_MAX, or holds HTML/Markdown markup
 * It also lists the books that still have no summary, per language (not an error).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
export const BLURB_MAX = 600;

/** Every book id the two catalogs can show. */
export function bookIds(root = ROOT) {
  const ids = new Set();
  for (const dir of ["packs", "public-books"]) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base, { withFileTypes: true })) {
      if (name.isDirectory() && existsSync(join(base, name.name, "info.json"))) ids.add(name.name);
    }
  }
  return ids;
}

/** Problems in one language table, as readable lines. Empty when the table is fine. */
export function blurbProblems(value, locale, ids) {
  const problems = [];
  if (!value || typeof value !== "object" || value.format !== 1 || !value.books || typeof value.books !== "object" || Array.isArray(value.books)) {
    return [`${locale}: the file must be { "format": 1, "books": { ... } }`];
  }
  for (const [id, text] of Object.entries(value.books)) {
    const where = `${locale} ${id}`;
    if (!ids.has(id)) problems.push(`${where}: no book with this id in packs/ or public-books/`);
    if (typeof text !== "string" || !text.trim()) {
      problems.push(`${where}: the summary is empty or not text`);
      continue;
    }
    if (text.length > BLURB_MAX) problems.push(`${where}: ${text.length} characters, over ${BLURB_MAX}`);
    if (/<[a-z/!]|\*\*|^#|\]\(/im.test(text)) problems.push(`${where}: plain text only, no HTML or Markdown`);
    if (locale === "zh" && !CJK.test(text)) problems.push(`${where}: a Chinese summary has no Chinese`);
    if (locale === "en" && CJK.test(text)) problems.push(`${where}: an English summary has Chinese in it`);
  }
  return problems;
}

function main() {
  const ids = bookIds();
  let failed = 0;
  for (const locale of ["zh", "en"]) {
    const file = join(ROOT, "docs", "blurbs", `${locale}.json`);
    let value;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`${locale}: cannot read ${file}: ${error.message}`);
      failed += 1;
      continue;
    }
    const problems = blurbProblems(value, locale, ids);
    for (const line of problems) console.error(line);
    failed += problems.length;
    const missing = [...ids].filter((id) => !value.books?.[id]).sort();
    console.log(`${locale}: ${ids.size - missing.length}/${ids.size} books have a summary.`);
  }
  if (failed) {
    console.error(`check:blurbs failed: ${failed} problem(s).`);
    process.exit(1);
  }
  console.log("check:blurbs OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
