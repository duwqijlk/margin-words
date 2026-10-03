#!/usr/bin/env node
/**
 * Print chapter ids, segment ids, and one hash per chapter, from the app's own
 * parseEpub. Diff this output between an old build and a new build.
 *
 *   node scripts/seg-report.mjs book.epub glossary.json
 *
 * A segment id is `c<chapter>.p<paragraph>` (chapter 0, paragraph 0 is `c0.p0`).
 * That pair is what a word-list anchor and a paragraph note use. Extra spine
 * files are printed on `extra` lines. Their ids (`x0`, `x1`, …) are not chapter
 * indexes. A contents file with zero paragraphs is one of those extras, titled
 * with the contents title, so numbered chapters do not move. A paragraph or
 * sentence note may name that id. Word anchors still do not.
 *
 * The hash is the first 16 hex digits of SHA-256 over the chapter's paragraphs
 * joined by a newline. `spine.merge` in the glossary is applied first, the same
 * way the reader applies it, and only appends paragraphs. `"segmentation": 2`
 * splits chapter-wrapper blockquotes. Without that field a blockquote stays one
 * paragraph, the same as before that rule.
 *
 * Copyrighted EPUBs are never written by this script.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadAppModules } from "./lib/app-modules.mjs";

const epubPath = process.argv[2];
const glossaryPath = process.argv[3];
if (!epubPath || !glossaryPath || epubPath.startsWith("-") || glossaryPath.startsWith("-")) {
  console.error("Usage: node scripts/seg-report.mjs <epub> <glossary.json>");
  process.exit(1);
}

const { epub, format } = await loadAppModules();

function hashText(paragraphs) {
  return createHash("sha256").update(paragraphs.join("\n")).digest("hex").slice(0, 16);
}

function span(prefix, count) {
  if (count <= 0) return "-";
  if (count === 1) return `${prefix}0`;
  return `${prefix}0..${prefix}${count - 1}`;
}

function cell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

const bytes = readFileSync(epubPath);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const glossaryText = readFileSync(glossaryPath, "utf8");
const checked = format.validateGlossary(glossaryText);
const segmentation = checked.file?.segmentation;
let parsed = await epub.parseEpub(buffer, { cover: false, segmentation });
const merge = checked.file?.spine?.merge;
const beforeCounts = parsed.chapters.map((chapter) => chapter.paragraphs.length);
if (merge && typeof epub.applySpineMerge === "function") {
  parsed = epub.applySpineMerge(parsed, merge);
}

const chapters = parsed.chapters ?? [];
const extras = parsed.extras ?? [];

console.log(`epub\t${epubPath}`);
console.log(`glossary\t${glossaryPath}`);
console.log(`title\t${cell(parsed.title)}`);
console.log(`chapters\t${chapters.length}`);
console.log(`extras\t${extras.length}`);
if (!checked.ok) console.log("glossary-status\tinvalid");
console.log(`segmentation\t${segmentation === 2 ? "2" : "off"}`);
if (merge) {
  for (const [source, target] of Object.entries(merge)) {
    const grown = chapters.flatMap((chapter, index) =>
      chapter.paragraphs.length > (beforeCounts[index] ?? 0)
        ? [`${index}:${chapter.paragraphs.length - (beforeCounts[index] ?? 0)}`]
        : [],
    );
    console.log(
      `merge\t${cell(source)}\t${cell(target)}\t${grown.length ? grown.join(",") : "not-applied"}`,
    );
  }
} else {
  console.log("merge\tnone");
}

chapters.forEach((chapter, index) => {
  const n = chapter.paragraphs.length;
  console.log(
    `chapter\t${index}\t${span(`c${index}.p`, n)}\t${n}\t${hashText(chapter.paragraphs)}\t${cell(chapter.title)}`,
  );
});

extras.forEach((extra) => {
  const n = extra.paragraphs.length;
  console.log(
    `extra\t${extra.id}\t${span(`${extra.id}.p`, n)}\t${n}\t${hashText(extra.paragraphs)}\t${cell(extra.opfHref || extra.href)}\t${cell(extra.title)}`,
  );
});
