#!/usr/bin/env node
/**
 * Mechanical clean-up of bundled meanings: swaps a few hard words for plain ones that
 * mean the same thing and fit in the same place of the sentence. A meaning is changed ONLY when
 * the result passes scripts/check-definition-words.mjs completely. Edits packs/<id>/glossary.json
 * and the matching lines of glossary-src/<slug>/g*.txt (lemma|pos|meaning|note).
 *
 *   node scripts/fix-definition-words.mjs            dry run (prints counts)
 *   node scripts/fix-definition-words.mjs --write    write the files
 * twits.glossary.json is skipped (another worker owns it).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const { basic } = await loadAppModules();
const extra = new Set(
  readFileSync(join(ROOT, "scripts", "basic-words-allow.txt"), "utf8")
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("#"))
    .map((w) => w.toLowerCase()),
);

// whole-word swaps, same part of speech, same meaning
const SWAPS = [
  [/\bodd\b/g, "strange"],
  [/\bfoolish\b/g, "silly"],
  [/\bnasty\b/g, "unpleasant"],
  [/\bpleasant\b/g, "nice"],
  [/\bTwelve\b/g, "12"],
  [/\btwelve\b/g, "12"],
  [/\bcruel\b/g, "very unkind"],
  [/\bgrey\b/g, "gray"],
  [/\bmarvelous\b/g, "wonderful"],
  [/\bfrightening\b/g, "scary"],
  [/\bdirt\b/g, "mud"],
  [/\bcolour\b/g, "color"],
  [/\bhonour\b/g, "respect"],
  [/\bbehaviour\b/g, "way of acting"],
  [/\bcentimetres\b/g, "cm"],
  [/\bkilometres\b/g, "km"],
  [/\bmetres\b/g, "meters"],
];

const fix = (text, lemma, forms) => {
  let out = text;
  for (const [re, to] of SWAPS) out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() && /^[a-z]/.test(to) ? to[0].toUpperCase() + to.slice(1) : to));
  return out;
};
const outside = (text, lemma, forms) => basic.outsideBasic(text, [lemma, ...forms], extra);

const dir = join(ROOT, "packs");
const report = [];
// After this tool changes a list, run `node scripts/build-packs.mjs` so catalog.json and the zips follow.
for (const slug of readdirSync(dir).filter((f) => existsSync(join(dir, f, "glossary.json")) && !f.startsWith("twits")).sort()) {
  const file = `${slug}/glossary.json`;
  const path = join(dir, slug, "glossary.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  const changed = new Map();
  let before = 0;
  for (const [lemma, entry] of Object.entries(data.glossary)) {
    const forms = entry.forms ?? [];
    if (outside(entry.meaning, lemma, forms).length === 0) continue;
    before += 1;
    const next = fix(entry.meaning, lemma, forms);
    if (next !== entry.meaning && outside(next, lemma, forms).length === 0) {
      changed.set(lemma, { from: entry.meaning, to: next });
      entry.meaning = next;
    }
  }
  report.push({ file, before, fixed: changed.size });
  if (write && changed.size) {
    writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
    const srcDir = join(ROOT, "glossary-src", slug);
    if (existsSync(srcDir)) {
      for (const f of readdirSync(srcDir).filter((x) => /^g\d+\.txt$/.test(x))) {
        const sp = join(srcDir, f);
        const lines = readFileSync(sp, "utf8").split("\n").map((line) => {
          const parts = line.split("|");
          const c = changed.get(parts[0] ?? "");
          if (c && parts.length === 4 && parts[2] === c.from) parts[2] = c.to;
          return parts.join("|");
        });
        writeFileSync(sp, lines.join("\n"));
      }
    }
  }
}
for (const r of report) console.log(`${r.file.padEnd(46)} failing ${String(r.before).padStart(4)}  fixed ${String(r.fixed).padStart(4)}`);
console.log(`TOTAL failing ${report.reduce((n, r) => n + r.before, 0)}, fixed ${report.reduce((n, r) => n + r.fixed, 0)}${write ? "" : "  (dry run)"}`);
