#!/usr/bin/env node
/**
 * Dump the chapters of an EPUB as plain text, split and numbered EXACTLY like the
 * Margin Words reader does (it runs the app's own EPUB code). Anchors written from
 * this output line up with the app.
 *
 * Usage:
 *   node scripts/extract-epub-text.mjs book.epub                 summary of chapters
 *   node scripts/extract-epub-text.mjs book.epub --out dir       write dir/ch000.txt, ch001.txt ... and dir/book.json
 *   node scripts/extract-epub-text.mjs book.epub --find saw      every use of "saw": chapter, occurrence, context
 *   node scripts/extract-epub-text.mjs book.epub --candidates 300   likely hard words (the app's own list), with counts
 *   node scripts/extract-epub-text.mjs book.epub --paragraphs 3   chapter 3 with every paragraph numbered: [0] [1] [2] ...
 *   node scripts/extract-epub-text.mjs book.epub --out dir --numbered   same numbering inside the ch000.txt files
 *   node scripts/extract-epub-text.mjs book.epub --paragraph-search "some words"   which chapter/paragraph holds the words
 *   add --json to print machine-readable output
 *
 * Paragraph index (for "paragraphs" notes): 0-based position of the paragraph in the chapter's
 * paragraph list, as the reader counts it: every p, h1-h4, li and blockquote of the chapter, in
 * document order, except one that sits directly inside another p, li, or blockquote, and except
 * one with fewer than 2 letters. A blockquote is one paragraph. Pass --segmentation 2 for the
 * opt-in rule: a chapter-wrapper blockquote (calibre class, or a blockquote that contains a
 * heading) is not a paragraph, and the headings and paragraphs inside it are. When the whole book has no p element, each innermost text div is a
 * paragraph too (empty and image-only divs are not; a wrapping div is not). A book with any p
 * keeps the list above. This is exactly `chapter.paragraphs` from src/lib/epub.ts (see docs/GLOSSARY_FORMAT.md 3.4).
 * The chapter heading is a paragraph too when it is inside the chapter html (it then has index 0). *
 * Rules (same as the app): chapters are counted from 0 in the order the reader shows
 * them. Soft hyphens (U+00AD) are removed, and a zero-width space or word joiner inside
 * a word is removed, before words are counted. Halves split across inline tags by one of
 * those marks are joined into one text node. A line break that only sits between those
 * tags is joined across too. A space in the text, or a block boundary, is not joined.
 * A normal hyphen is kept. A word is Unicode letters and combining marks, with at most
 * one straight apostrophe inside (`café` and `Yucatán` are one word each). A curly
 * apostrophe still ends a word for counting: `Coral’s` is `coral` then `s`, `couldn’t`
 * is `couldn` then `t`. (`--find` prints those counted pieces, which is what anchors
 * use. The reader joins them into one button only when none of the pieces is itself
 * an entry.) Inline tags do not split a
 * word when there is no space between them. A space, line break, `<br>`, or block
 * boundary still separates words. Words are counted per chapter on the text the reader
 * shows; "occurrence" is the 1-based count of one spelling (lower-cased) within the chapter.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadAppModules, readBook } from "./lib/app-modules.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const valueFlags = new Set([
  "--out",
  "--find",
  "--candidates",
  "--words",
  "--paragraphs",
  "--paragraph-search",
  "--segmentation",
]);
const file = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
if (!file || flag("--help")) {
  console.error(
    "Usage: node scripts/extract-epub-text.mjs book.epub [--out dir [--numbered]] [--find word] [--paragraphs N] [--paragraph-search text] [--candidates N] [--segmentation 2] [--json]",
  );
  process.exit(file ? 0 : 2);
}

const segmentationArg = value("--segmentation");
const segmentation = segmentationArg === undefined ? undefined : Number(segmentationArg);
if (segmentationArg !== undefined && segmentation !== 2) {
  console.error('--segmentation must be 2 (omit it to keep each blockquote as one paragraph).');
  process.exit(2);
}

let book;
try {
  book = await readBook(file, { segmentation });
} catch (error) {
  console.error(`Cannot read this EPUB: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const sha256 = createHash("sha256").update(book.bytes).digest("hex");
const asJson = flag("--json");
const summary = {
  title: book.title,
  author: book.author,
  sha256,
  chapters: book.chapters.map((c, i) => ({
    chapter: i,
    title: c.title,
    words: c.index.tokens.length,
    paragraphs: c.paragraphs.length,
  })),
};

const find = value("--find");
const showChapter = value("--paragraphs");
const search = value("--paragraph-search");
const cands = value("--candidates");
const out = value("--out");

if (showChapter !== undefined) {
  const ci = Number(showChapter);
  const chapter = book.chapters[ci];
  if (!Number.isInteger(ci) || !chapter) {
    console.error(`The book has chapters 0 to ${book.chapters.length - 1}.`);
    process.exit(1);
  }
  if (asJson) console.log(JSON.stringify({ chapter: ci, title: chapter.title, paragraphs: chapter.paragraphs }, null, 1));
  else {
    console.log(`Chapter ${ci}: ${chapter.title} (${chapter.paragraphs.length} paragraphs)`);
    chapter.paragraphs.forEach((p, i) => console.log(`[${i}] ${p}\n`));
  }
} else if (search) {
  const loose = (t) => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
  const want = ` ${loose(search)} `;
  const hits = [];
  book.chapters.forEach((chapter, ci) =>
    chapter.paragraphs.forEach((p, pi) => {
      if (` ${loose(p)} `.includes(want)) hits.push({ chapter: ci, paragraph: pi, text: p });
    }),
  );
  if (asJson) console.log(JSON.stringify(hits, null, 1));
  else {
    console.log(`${hits.length} place(s)`);
    for (const h of hits) console.log(`  chapter ${h.chapter}, paragraph ${h.paragraph}: ${h.text.slice(0, 140)}`);
  }
} else if (find) {
  const form = find.toLowerCase();
  const rows = [];
  book.chapters.forEach((chapter, ci) => {
    let n = 0;
    for (const token of chapter.index.tokens) {
      if (token.w !== form) continue;
      n += 1;
      const block = chapter.index.blocks[token.b] ?? "";
      const at = block.toLowerCase().indexOf(form);
      // The k-th use inside this block is found by counting uses before this token in the same block.
      let seenInBlock = 0;
      for (const other of chapter.index.tokens) {
        if (other === token) break;
        if (other.b === token.b && other.w === form) seenInBlock += 1;
      }
      let pos = -1;
      for (let k = 0; k <= seenInBlock; k += 1) pos = block.toLowerCase().indexOf(form, pos + 1);
      const from = Math.max(0, (pos < 0 ? at : pos) - 60);
      const norm = (t) => t.replace(/\s+/g, " ").trim();
      const paragraph = chapter.paragraphs.findIndex((p) => norm(p) === norm(block));
      rows.push({
        chapter: ci,
        paragraph,
        occurrence: n,
        context: block.slice(from, from + 130 + form.length).trim(),
      });
    }
  });
  if (asJson) console.log(JSON.stringify({ form, uses: rows }, null, 1));
  else {
    console.log(`"${form}": ${rows.length} use(s)`);
    for (const r of rows) console.log(`  chapter ${r.chapter}, paragraph ${r.paragraph}, occurrence ${r.occurrence}: ...${r.context}...`);
  }
} else if (cands) {
  const { text } = await loadAppModules();
  const limit = Math.max(1, Number(cands) || 300);
  const all = book.chapters.flatMap((c) => c.paragraphs);
  const keys = text.collectHardWords(all, limit);
  const stats = text.indexBook(book.chapters.map((c) => ({ paragraphs: c.paragraphs })));
  const rows = keys.map((key) => ({
    lemma: key,
    count: stats[key]?.count ?? 0,
    chapters: stats[key]?.chapters ?? 0,
    forms: (stats[key]?.forms ?? []).map((f) => f.form),
  }));
  if (asJson) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) console.log(`${r.lemma}\t${r.count}\t${r.chapters} ch\t${r.forms.join(",")}`);
} else if (out) {
  mkdirSync(out, { recursive: true });
  book.chapters.forEach((chapter, i) => {
    const name = `ch${String(i).padStart(3, "0")}.txt`;
    const lines = flag("--numbered") ? chapter.paragraphs.map((p, k) => `[${k}] ${p}`) : chapter.paragraphs;
    writeFileSync(join(out, name), `${lines.join("\n\n")}\n`);
  });
  writeFileSync(join(out, "book.json"), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(`Wrote ${book.chapters.length} chapters to ${out}/ (ch000.txt ...) and book.json`);
} else if (asJson) {
  console.log(JSON.stringify(summary, null, 1));
} else {
  console.log(`${book.title} - ${book.author}\nsha256 ${sha256}\n${book.chapters.length} chapters (counted from 0):`);
  for (const c of summary.chapters)
    console.log(`  ${String(c.chapter).padStart(3)}  ${String(c.words).padStart(6)} words  ${c.title}`);
}
