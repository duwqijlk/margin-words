/**
 * Offline helper: run the app's own hard-word selection over an EPUB and dump
 * the candidates (lemma, forms, frequency, example sentences) as JSON.
 * Build+run via scripts/extract-hard-words.sh (needs jsdom for DOMParser).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEpub } from "../src/lib/epub";
import { collectHardWords, indexBook } from "../src/lib/text";

const require = createRequire(process.env.JSDOM_FROM ?? import.meta.url);
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as Record<string, unknown>;
for (const key of ["DOMParser", "document", "NodeFilter", "Node", "Element", "HTMLElement", "Range"]) {
  g[key] = (dom.window as unknown as Record<string, unknown>)[key];
}
g.window = dom.window;


const [file, out, limitArg] = process.argv.slice(2);
if (!file || !out) throw new Error("usage: extract-hard-words <epub> <out.json> [limit]");
const buf = readFileSync(file);
const parsed = await parseEpub(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const all = parsed.chapters.flatMap((c) => c.paragraphs);
const stats = indexBook(parsed.chapters);
// app's own selection (capped at PREPARE_LIMIT=240 in the app); here we also take a longer list
const limit = Number(limitArg ?? 5000);
const hard = collectHardWords(all, limit);
console.error("app collectHardWords (PREPARE_LIMIT):", hard.length);
const hardSet = new Set(hard);
writeFileSync(out, JSON.stringify({
  title: parsed.title,
  author: parsed.author,
  sha256: createHash("sha256").update(buf).digest("hex"),
  chapters: parsed.chapters.length,
  words: hard.map((lemma) => stats[lemma]).map((s, i) => ({ lemma: hard[i], ...s })),
}, null, 1));
