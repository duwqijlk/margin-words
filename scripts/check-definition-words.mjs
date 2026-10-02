#!/usr/bin/env node
/**
 * Check that the meanings in the bundled word lists use only basic words
 * (the ~2000 most common English words, see src/lib/basic-words-data.ts).
 * Allowed on top of the list: simple forms of a listed word (-s, -ed, -ing, -er, -ly ...),
 * the headword itself and its forms, names (a capital letter inside a sentence), numbers,
 * and words in scripts/basic-words-allow.txt.
 *
 *   node scripts/check-definition-words.mjs                  all packs/<id>/glossary.json
 *   node scripts/check-definition-words.mjs file.json ...    chosen files
 *   --list            print every failing entry with the outside words
 *   --top N           print the N most common outside words per book (default 0)
 *   --json            machine-readable
 *   --strict          ignore scripts/basic-words-allow.txt (only the 2000 words and their simple forms)
 *   --fail            exit 1 when anything fails
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) || 0 : 0;
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--top");
const dir = join(ROOT, "packs");
const targets = files.length
  ? files
  : readdirSync(dir).filter((f) => existsSync(join(dir, f, "glossary.json"))).sort().map((f) => join(dir, f, "glossary.json"));

const { basic } = await loadAppModules();
const allowFile = join(ROOT, "scripts", "basic-words-allow.txt");
const extra = new Set(
  existsSync(allowFile) && !flag("--strict")
    ? readFileSync(allowFile, "utf8").split(/\s+/).filter((w) => w && !w.startsWith("#")).map((w) => w.toLowerCase())
    : [],
);

const report = [];
for (const path of targets) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const bad = [];
  let checked = 0;
  const freq = new Map();
  for (const [lemma, entry] of Object.entries(data.glossary ?? {})) {
    const allow = [lemma, ...(entry.forms ?? [])];
    const texts = [entry.meaning, ...(entry.senses ?? []).map((s) => s.meaning)].filter(Boolean);
    checked += 1;
    const words = [...new Set(texts.flatMap((t) => basic.outsideBasic(t, allow, extra)))];
    if (words.length) {
      bad.push({ lemma, words, meaning: entry.meaning });
      for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  report.push({ file: basename(dirname(path)) + "/" + basename(path), checked, failing: bad.length, bad, freq });
}

if (flag("--json")) {
  console.log(JSON.stringify(report.map(({ file, checked, failing, bad }) => ({ file, checked, failing, bad })), null, 1));
} else {
  let total = 0;
  let all = 0;
  for (const r of report) {
    total += r.failing;
    all += r.checked;
    console.log(`${r.file.padEnd(46)} ${String(r.failing).padStart(5)} of ${String(r.checked).padStart(5)} meanings use words outside the basic list`);
    if (flag("--list")) for (const b of r.bad) console.log(`    ${b.lemma}: ${b.words.join(", ")}   <- ${b.meaning}`);
    if (topN) console.log(`    top: ${[...r.freq].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([w, n]) => `${w}(${n})`).join(" ")}`);
  }
  console.log(`TOTAL ${total} of ${all}`);
}
if (flag("--fail") && report.some((r) => r.failing)) process.exit(1);
