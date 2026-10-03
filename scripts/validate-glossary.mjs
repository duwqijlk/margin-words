#!/usr/bin/env node
/**
 * Check a Margin Words word list (glossary), version 1 or 2.
 *
 *   node scripts/validate-glossary.mjs glossary.json            check the format only
 *   node scripts/validate-glossary.mjs book.epub glossary.json  also check the places in the book
 *
 * With an EPUB, every anchor is checked against the real text of the book, split and
 * counted exactly like the app does it: `spine.merge` is applied first, then the chapter
 * must exist, the word must occur that many times, and the "context" text must really
 * be in the book. A context that is not found is an ERROR here (the app only warns).
 * A `spine.merge` key that names no spine item, or that names a spine item but merges
 * nothing into or from that file, is a WARNING. Those warnings are decided before the
 * merge, on the same book the app imports. A short `context` warning comes from the
 * word list itself and does not depend on the merge.
 *
 * Paragraph notes, sentence notes and phrases (docs/book-pack-spec.md) are checked too: with an EPUB,
 * every "context" must be inside the paragraph (chapter + paragraph index, counted as the reader
 * counts them) or the chapter. "simple", "mainIdea", "grammar" and phrase "meaning" are checked
 * against the basic word list; words outside it are WARNINGS that name the words.
 *
 * Options: --json (machine-readable output), --quiet (only errors),
 *          --bundled (the list ships inside the app: Chinese or other non-English letters are an ERROR;
 *                     this is also the default for glossary.json files inside packs/)
 * Exit code: 0 = fine (warnings allowed), 1 = problems found, 2 = wrong usage.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadAppModules, readBook } from "./lib/app-modules.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const quiet = args.includes("--quiet");
const files = args.filter((a) => !a.startsWith("--"));
const bundled = args.includes("--bundled") || files.some((f) => /(^|[\\/])packs[\\/]/.test(f));
const epubPath = files.find((f) => /\.epub$/i.test(f));
const jsonPath = files.find((f) => !/\.epub$/i.test(f));
if (!jsonPath || files.length > 2 || args.includes("--help")) {
  console.error("Usage: node scripts/validate-glossary.mjs [book.epub] glossary.json [--json] [--quiet] [--bundled]");
  process.exit(jsonPath ? 0 : 2);
}

let text;
try {
  text = readFileSync(jsonPath, "utf8");
} catch (error) {
  console.error(`Cannot read ${jsonPath}: ${error.message}`);
  process.exit(2);
}

const { format, basic } = await loadAppModules();
const result = format.validateGlossary(text);
const errors = [...result.errors];
const warnings = [...result.warnings];
let book = null;
let checked = 0;
let extrasChecked = 0;

if (result.ok && result.file && epubPath) {
  try {
    book = await readBook(epubPath, {
      segmentation: result.file.segmentation,
      merge: result.file.spine?.merge,
    });
  } catch (error) {
    errors.push(`Cannot read the EPUB: ${error instanceof Error ? error.message : error}`);
  }
  if (book) {
    const file = result.file;
    const sha = createHash("sha256").update(book.bytes).digest("hex");
    if (file.sha256 && file.sha256 !== sha)
      warnings.push(`The "sha256" in the list is not the sha256 of this EPUB. The list may be for another copy of the book.`);
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (file.title && norm(file.title) !== norm(book.title))
      warnings.push(`The list is for "${file.title}", but the EPUB title is "${book.title}".`);
    if (file.chapters && file.chapters !== book.chapters.length)
      warnings.push(
        `The list says the book has ${file.chapters} chapters, but this EPUB has ${book.chapters.length}. The app will ignore chapter numbers for this copy.`,
      );
    const usable = format.forBook(file, book.chapters.length);
    const found = format.checkAgainstBook(usable, book.chapters.map((c) => c.index), true);
    errors.push(...found.errors);
    warnings.push(...found.warnings);
    checked = found.checked;
    const extras = format.checkExtrasAgainstBook(usable, book.chapters, true, book.extras);
    errors.push(...extras.errors);
    warnings.push(...extras.warnings);
    extrasChecked = extras.checked;
    warnings.push(...(book.spineWarnings ?? []));
  }
}

if (result.ok && result.file) {
  const file = result.file;
  const words = (label, text, allow = []) => {
    const bad = basic.outsideBasic(text ?? "", allow);
    if (bad.length) warnings.push(`${label} uses words outside the basic list: ${bad.join(", ")}.`);
  };
  (file.paragraphs ?? []).forEach((p, i) => {
    const l = `Paragraph note ${i + 1} (chapter ${p.chapter}, paragraph ${p.paragraph})`;
    const own = (p.hardWords ?? []).join(" ");
    words(`${l}, "mainIdea"`, p.mainIdea);
    words(`${l}, "simple"`, p.simple, [own]);
  });
  (file.sentences ?? []).forEach((s, i) => {
    const l = `Sentence note ${i + 1} (chapter ${s.chapter})`;
    words(`${l}, "simple"`, s.simple);
    words(`${l}, "grammar"`, s.grammar);
  });
  for (const [key, p] of Object.entries(file.phrases ?? {})) words(`The phrase "${key}", "meaning"`, p.meaning, [key, ...(p.forms ?? [])]);
  if (bundled && result.stats.chineseWords.length)
    errors.push(
      `Chinese or other non-English letters were found in: ${result.stats.chineseWords.slice(0, 10).join(", ")}${result.stats.chineseWords.length > 10 ? ", ..." : ""}. Lists that ship inside the app must be English only.`,
    );
}

const ok = errors.length === 0;
if (asJson) {
  console.log(JSON.stringify({ ok, errors, warnings, stats: result.stats, anchorsChecked: checked, extrasChecked }, null, 1));
} else {
  if (!ok) {
    console.error(`NOT OK: ${errors.length} problem(s)`);
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  }
  if (!quiet && warnings.length) {
    console.error(`${warnings.length} warning(s):`);
    warnings.forEach((w) => console.error(`  - ${w}`));
  }
  if (ok) {
    const s = result.stats;
    console.log(
      `OK: ${s.words} words, ${s.senses} extra meanings, ${s.anchors} anchors, ${s.paragraphs ?? 0} paragraph notes, ${s.sentences ?? 0} sentence notes, ${s.phrases ?? 0} phrases, ${s.coined ?? 0} coined words${
        epubPath ? ` (${checked} anchors and ${extrasChecked} notes checked against ${book?.chapters.length} chapters of the book)` : " (format only: give an EPUB to check places in the book)"
      }.`,
    );
    if (s.chineseWords.length && !bundled) console.log(`Note: ${s.chineseWords.length} item(s) contain non-English letters (fine for a list of your own, not for a list inside the app).`);
  }
}
process.exit(ok ? 0 : 1);
