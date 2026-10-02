#!/usr/bin/env node
/**
 * npm run check:example
 *
 * Checks the sample in examples/ that goes into book-pack-kit.zip:
 *   1. examples/sample-book/the-lantern-seller.epub is exactly what scripts/make-sample-epub.mjs writes,
 *      and it is a valid book that the reader can open (3 chapters).
 *   2. examples/sample-book/glossary.json passes scripts/validate-glossary.mjs with the EPUB: 0 errors.
 *      It shows every part of the format: several words, a word with 2 meanings and anchors, paragraph notes,
 *      sentence notes, phrases and a coined word.
 *   3. Its meanings use only common words (scripts/check-definition-words.mjs).
 *   4. docs/book-pack-spec.md exists, and the JSON example inside it is a valid word list that fits the sample book.
 *   5. book-pack-kit.zip builds from these files (spec + EPUB + glossary + the-lantern-seller.pack.zip), and the sample
 *      pack inside it is a valid pack: exactly book.epub + glossary.json, and the list belongs to the book.
 *   6. The in-app page /kit/ builds and links to the kit.
 *
 * Exit code 0 = all fine, 1 = a problem (each one is printed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
const problems = [];
const ok = (message) => console.log(`  ok   ${message}`);
const bad = (message) => {
  problems.push(message);
  console.log(`  FAIL ${message}`);
};

const EPUB = "examples/sample-book/the-lantern-seller.epub";
const LIST = "examples/sample-book/glossary.json";
const SPEC = "docs/book-pack-spec.md";

console.log("check:example");
for (const file of [EPUB, LIST, SPEC]) {
  if (!existsSync(join(ROOT, file))) bad(`${file} is missing`);
}

if (problems.length === 0) {
  // 1. the EPUB
  const made = node(["scripts/make-sample-epub.mjs", "--check"]);
  if (made.status === 0) ok("the EPUB is what scripts/make-sample-epub.mjs writes");
  else bad(`EPUB: ${(made.stderr || made.stdout).trim()}`);

  // 2. the word list against the EPUB
  const run = node(["scripts/validate-glossary.mjs", "--json", EPUB, LIST]);
  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    bad(`validate-glossary printed no report: ${(run.stderr || run.stdout).trim().slice(0, 300)}`);
  }
  if (report) {
    if (report.ok && report.errors.length === 0)
      ok(`validate-glossary: 0 errors (${report.warnings.length} warnings)`);
    else
      bad(
        `validate-glossary: ${report.errors.length} error(s): ${report.errors.slice(0, 3).join(" | ")}`,
      );
    const s = report.stats;
    const wanted = [
      ["words", s.words, 5],
      ["extra meanings (senses)", s.senses, 1],
      ["anchors", s.anchors, 1],
      ["paragraph notes", s.paragraphs, 2],
      ["sentence notes", s.sentences, 3],
      ["phrases", s.phrases, 3],
      ["coined words", s.coined, 1],
    ];
    for (const [name, have, min] of wanted) {
      if (have >= min) ok(`${have} ${name} (at least ${min} needed to show the format)`);
      else bad(`only ${have} ${name}; the example must show at least ${min}`);
    }
    if (report.anchorsChecked < 1 || report.extrasChecked < 1)
      bad("the anchors and notes were not checked against the book");
  }

  // 3. easy words in meanings
  const words = node(["scripts/check-definition-words.mjs", "--fail", LIST]);
  if (words.status === 0) ok("all meanings use common words (check-definition-words)");
  else bad(`check-definition-words: ${words.stdout.trim().split("\n").slice(0, 4).join(" / ")}`);

  // 4. the JSON example inside the spec
  const spec = readFileSync(join(ROOT, SPEC), "utf8");
  const block = /<!-- example:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- example:end -->/.exec(
    spec,
  );
  if (!block) bad("docs/book-pack-spec.md has no <!-- example:start --> JSON block");
  else {
    const dir = mkdtempSync(join(tmpdir(), "spec-"));
    const file = join(dir, "spec-example.json");
    writeFileSync(file, block[1]);
    const spot = node(["scripts/validate-glossary.mjs", "--json", EPUB, file]);
    let r = null;
    try {
      r = JSON.parse(spot.stdout);
    } catch {
      bad(
        `the example in the spec: validate-glossary printed no report: ${(spot.stderr || spot.stdout).trim().slice(0, 300)}`,
      );
    }
    if (r) {
      if (r.ok && r.errors.length === 0)
        ok(
          `the JSON example in the spec is valid for the sample book (${r.warnings.length} warnings)`,
        );
      else bad(`the JSON example in the spec: ${r.errors.slice(0, 3).join(" | ")}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // 5. the kit
  const kit = node(["scripts/build-kit.mjs", "--check"]);
  if (kit.status === 0)
    ok("book-pack-kit.zip builds from the spec, the EPUB, the word list and the sample pack");
  else bad(`kit: ${(kit.stderr || kit.stdout).trim().slice(0, 300)}`);
  try {
    const { buildKit } = await import("./build-kit.mjs");
    const { default: JSZip } = await import("jszip");
    const { loadAppModules } = await import("./lib/app-modules.mjs");
    const kitZip = await JSZip.loadAsync(await buildKit());
    const names = Object.keys(kitZip.files).sort().join(",");
    if (
      names ===
      "book-pack-spec.md,the-lantern-seller.epub,the-lantern-seller.glossary.json,the-lantern-seller.pack.zip"
    )
      ok("the kit holds the spec, the sample EPUB, its word list and the sample pack");
    else bad(`the kit holds: ${names}`);
    const pack = await JSZip.loadAsync(
      await kitZip.file("the-lantern-seller.pack.zip").async("uint8array"),
    );
    const inner = Object.keys(pack.files).sort().join(",");
    if (inner === "book.epub,glossary.json")
      ok("the-lantern-seller.pack.zip = book.epub + glossary.json");
    else bad(`the-lantern-seller.pack.zip holds: ${inner}`);
    const { packCheck, format } = await loadAppModules();
    packCheck.findPacks(Object.keys(pack.files));
    const list = format.validateGlossary(await pack.file("glossary.json").async("string"));
    if (!list.ok) bad(`sample pack glossary.json: ${list.errors.slice(0, 2).join(" ")}`);
    else ok("the sample pack passes the pack rules (one book, one valid list)");
  } catch (error) {
    bad(`sample pack: ${error instanceof Error ? error.message : error}`);
  }

  // 6. the in-app page
  const guide = node(["scripts/build-guide.mjs", "--check"]);
  if (guide.status === 0) ok("the in-app page /kit/ can be built and links to the kit");
  else bad(`guide: ${(guide.stderr || guide.stdout).trim().slice(0, 300)}`);
}

if (problems.length) {
  console.error(`\ncheck:example FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log("\ncheck:example OK");
