#!/usr/bin/env node
/**
 * Write the object layout for the book bucket (default host https://books.inputread.site).
 *
 *   npm run build:books
 *   node scripts/build-books.mjs --out dist-books
 *
 * Loose files only. Keys match the URLs the app fetches:
 *   public-books/catalog.json          each pack's zip is null; allPacks is omitted
 *   public-books/<id>/book.epub
 *   public-books/<id>/glossary.json
 *   public-books/<id>/cover.jpg        public-domain covers that already live in public-books/
 *   word-lists/catalog.json
 *   word-lists/<id>/glossary.json
 *   word-lists/<id>/cover.jpg          card-sized JPEG from packs/<id>/cover.jpg, when that file exists
 *
 * No per-book zip, no all-packs.zip, and no copyrighted EPUB. A word-list book with no cover.jpg
 * keeps the generated title-and-author cover in the app. Pack zips stay a local sideload
 * (`node scripts/build-packs.mjs`), not a hosted object. The private EPUBs are `npm run build:private`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWordLists } from "./lib/word-lists.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Catalog uploaded to the books host: loose files, no zip URLs. */
export function hostedPublicCatalog(catalog) {
  return {
    format: catalog.format,
    name: catalog.name,
    updated: catalog.updated,
    packs: (catalog.packs ?? []).map((pack) => ({ ...pack, zip: null })),
  };
}

/**
 * @param {string} outDir
 * @returns {{ keys: string[], bytes: number }}
 */
export function writeBookObjects(outDir) {
  const catalog = JSON.parse(readFileSync(join(ROOT, "public-books", "catalog.json"), "utf8"));
  const hosted = hostedPublicCatalog(catalog);
  const files = [];
  files.push({
    name: "public-books/catalog.json",
    bytes: Buffer.from(`${JSON.stringify(hosted, null, 1)}\n`),
  });
  for (const pack of hosted.packs) {
    for (const ref of [pack.epub, pack.glossary, pack.cover]) {
      if (!ref?.url) continue;
      if (ref.url.includes("..") || ref.url.endsWith(".zip")) continue;
      files.push({
        name: `public-books/${ref.url}`,
        bytes: readFileSync(join(ROOT, "public-books", ref.url)),
      });
    }
  }
  for (const file of buildWordLists(join(ROOT, "packs")).files) {
    if (file.name.endsWith(".epub") || file.name.endsWith(".zip")) continue;
    files.push(file);
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
  const outDir = resolve(outFlag >= 0 ? args[outFlag + 1] : join(ROOT, "dist-books"));
  const { keys, bytes } = writeBookObjects(outDir);
  console.log(`Wrote ${keys.length} book objects to ${outDir} (${(bytes / 1048576).toFixed(1)} MB).`);
  console.log("Upload each key to the bucket behind https://books.inputread.site.");
  console.log("Example (set BUCKET to that bucket's name):");
  console.log('  cd dist-books && find . -type f | sed "s|^\\./||" | while read -r key; do');
  console.log('    npx wrangler r2 object put "$BUCKET/$key" --file "$key" --remote');
  console.log("  done");
  console.log("The bucket must send Access-Control-Allow-Origin for https://inputread.site,");
  console.log("https://www.inputread.site, https://margin-words.pages.dev, and http://localhost:8080");
  console.log("so the page can read a book after it is opened.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
