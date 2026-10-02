#!/usr/bin/env node
/**
 * Builds book-pack-kit.zip: the ONE file people give to an AI agent so it can make a book pack.
 *
 *   the-lantern-seller.epub            examples/sample-book/the-lantern-seller.epub   (sample book)
 *   the-lantern-seller.glossary.json   examples/sample-book/glossary.json             (its sample word list)
 *   the-lantern-seller.pack.zip        book.epub + glossary.json made from the two files above: a READY-TO-IMPORT
 *                                      book pack (Add book -> Choose .zip file). See docs/book-pack-spec.md, section 3.
 *   book-pack-spec.md                  docs/book-pack-spec.md                         (the specification, written for an AI)
 *
 *   node scripts/build-kit.mjs                 write ./book-pack-kit.zip   (npm run build:kit)
 *   node scripts/build-kit.mjs --out FILE      write somewhere else
 *   node scripts/build-kit.mjs --check         exit 1 when the sources are missing or a listed file is empty
 *
 * `vite build` calls buildKit() too (scripts/build-guide.mjs) and puts the zip in dist/guide/book-pack-kit.zip.
 * The output is always the same bytes (fixed dates, fixed order). Nothing is copied by hand, so the kit cannot
 * go out of date: change the sources, rebuild.
 *
 * The kit zip itself is not a pack. Its file the-lantern-seller.pack.zip is: that is the one to import.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const JSZip = require("jszip");

export const KIT_NAME = "book-pack-kit.zip";
export const SAMPLE_PACK_NAME = "the-lantern-seller.pack.zip";
/** `from` is relative to the project; `name` is the name inside the zip. */
export const KIT_FILES = [
  { name: "book-pack-spec.md", from: "docs/book-pack-spec.md" },
  { name: "the-lantern-seller.epub", from: "examples/sample-book/the-lantern-seller.epub" },
  { name: "the-lantern-seller.glossary.json", from: "examples/sample-book/glossary.json" },
];
const ZIP_DATE = new Date("2026-01-01T00:00:00Z");

const ZIP_OPTIONS = {
  date: ZIP_DATE,
  createFolders: false,
  compression: "DEFLATE",
  unixPermissions: 0o644,
};

/** A book pack zip: exactly book.epub + glossary.json at the top level. Same bytes every time. */
export async function buildPack(epubPath, glossaryPath) {
  const zip = new JSZip();
  for (const [name, path] of [
    ["book.epub", epubPath],
    ["glossary.json", glossaryPath],
  ]) {
    const bytes = readFileSync(path);
    if (bytes.length === 0) throw new Error(`${path} is empty`);
    zip.file(name, bytes, ZIP_OPTIONS);
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
}

/** The ready-to-import sample pack of the kit. */
export function buildSamplePack() {
  return buildPack(
    join(ROOT, "examples/sample-book/the-lantern-seller.epub"),
    join(ROOT, "examples/sample-book/glossary.json"),
  );
}

export async function buildKit() {
  const zip = new JSZip();
  for (const file of KIT_FILES) {
    const bytes = readFileSync(join(ROOT, file.from));
    if (bytes.length === 0) throw new Error(`${file.from} is empty`);
    zip.file(file.name, bytes, ZIP_OPTIONS);
  }
  zip.file(SAMPLE_PACK_NAME, await buildSamplePack(), ZIP_OPTIONS);
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    const bytes = await buildKit();
    if (args.includes("--check")) {
      console.log(`kit ok (${KIT_FILES.length + 1} files, ${bytes.length} bytes)`);
    } else {
      const at = args.indexOf("--out");
      const out = resolve(at >= 0 ? (args[at + 1] ?? KIT_NAME) : join(ROOT, KIT_NAME));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      console.log(
        `Wrote ${out} (${[...KIT_FILES.map((f) => f.name), SAMPLE_PACK_NAME].join(", ")})`,
      );
    }
  } catch (error) {
    console.error(`build-kit: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
