#!/usr/bin/env node
/**
 * Private backup of the copyrighted packs. Not for the public books host.
 *
 *   npm run build:private
 *   node scripts/build-private.mjs --out dist-private
 *
 * Copies each packs/<id>/book.epub (when that pack has one), glossary.json, and cover.jpg
 * into dist-private/<id>/. Upload that folder to the private R2 bucket margin-words-private.
 * That bucket has no public access. The app never fetches it. Do not put these files in
 * dist/ or dist-books/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} packsDir
 * @param {string} outDir
 * @returns {{ keys: string[], bytes: number }}
 */
export function writePrivateBackup(packsDir, outDir) {
  const ids = readdirSync(packsDir)
    .filter((name) => {
      const dir = join(packsDir, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "glossary.json"));
    })
    .sort();
  const files = [];
  for (const id of ids) {
    for (const name of ["book.epub", "glossary.json", "cover.jpg"]) {
      const path = join(packsDir, id, name);
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      files.push({ name: `${id}/${name}`, bytes: readFileSync(path) });
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  let total = 0;
  for (const file of files) {
    const dest = join(outDir, file.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.bytes);
    total += file.bytes.length;
  }
  return { keys: files.map((file) => file.name).sort(), bytes: total };
}

function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outDir = resolve(outFlag >= 0 ? args[outFlag + 1] : join(ROOT, "dist-private"));
  const { keys, bytes } = writePrivateBackup(join(ROOT, "packs"), outDir);
  const epubs = keys.filter((name) => name.endsWith("/book.epub")).length;
  console.log(
    `Wrote ${keys.length} private files (${epubs} EPUBs) to ${outDir} (${(bytes / 1048576).toFixed(1)} MB).`,
  );
  console.log("Upload to the private R2 bucket margin-words-private. Do not publish this folder.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
