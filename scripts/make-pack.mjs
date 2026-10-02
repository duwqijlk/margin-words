#!/usr/bin/env node
/**
 * Make a book pack (the only thing the reader app can import) from an EPUB and its word list, and check it
 * with the same rules as the app (docs/book-pack-spec.md, section 3).
 *
 *   node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip
 *
 * Writes ONE zip with exactly book.epub + glossary.json. Exit code 1 (and nothing written) when the word list
 * is not valid, or does not belong to the book (sha256, or title and author).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildPack } from "./build-kit.mjs";
import { loadAppModules, readBook } from "./lib/app-modules.mjs";

const [epubPath, listPath, outPath] = process.argv.slice(2);
if (!epubPath || !listPath || !outPath) {
  console.error("usage: node scripts/make-pack.mjs book.epub glossary.json out.pack.zip");
  process.exit(2);
}
try {
  const { format, packCheck } = await loadAppModules();
  const book = await readBook(epubPath);
  const check = format.validateGlossary(readFileSync(listPath, "utf8"));
  if (!check.ok)
    throw new Error(`glossary.json is not valid: ${check.errors.slice(0, 5).join(" ")}`);
  const sha256 = createHash("sha256").update(book.bytes).digest("hex");
  try {
    packCheck.matchGlossary(check.file, { title: book.title, author: book.author, sha256 });
  } catch (error) {
    const p = error.params ?? {};
    throw new Error(
      `the word list does not belong to this book (${error.code}). List: ${p.listBook ?? check.file.title ?? "no title"}. EPUB: ${p.epubBook ?? book.title}.`,
    );
  }
  const bytes = await buildPack(epubPath, listPath);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, bytes);
  console.log(
    `Wrote ${outPath}: book.epub (${book.title}) + glossary.json (${Object.keys(check.file.glossary).length} words)`,
  );
} catch (error) {
  console.error(`make-pack: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
