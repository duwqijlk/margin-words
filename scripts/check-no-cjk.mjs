#!/usr/bin/env node
/**
 * Fails if any CJK (Chinese/Japanese/Korean) character, CJK punctuation or full-width form
 * appears in the shipped sources: src/, public/, packs/, examples/ and scripts/
 * (fonts and other binary files are skipped).
 *
 * Chinese is allowed ONLY in:
 *   - src/lib/i18n-zh.ts   the Chinese dictionary of the app
 *   - docs/                docs/guide-chrome.json (the Chinese text of the page at /kit/)
 *   - README.zh-CN.md
 * Book content (packs/) and every other file in src/ and public/ must stay English.
 * The Chinese text of the in-app page /kit/ is built from docs/ at build time into dist/kit/ (not public/).
 *
 *   node scripts/check-no-cjk.mjs        (npm run check:cjk)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/u;
const SCAN = ["src", "public", "packs", "examples", "scripts"];
/** Files (relative to the project root, with /) that may contain Chinese. */
export const ALLOWED = new Set(["src/lib/i18n-zh.ts", "README.zh-CN.md"]);
/** Folders (with trailing /) that may contain Chinese. */
export const ALLOWED_DIRS = ["docs/"];
const SKIP_DIRS = new Set(["node_modules", "fonts", ".git", "dist", ".output"]);
const SKIP_EXT = new Set([
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".mp3",
  ".mp4",
  ".webm",
  ".pdf",
  ".zip",
  ".epub",
  ".wasm",
]);

export function findCjk(root = ROOT, dirs = SCAN) {
  const hits = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      if (SKIP_EXT.has(extname(name).toLowerCase())) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (ALLOWED.has(rel) || ALLOWED_DIRS.some((prefix) => rel.startsWith(prefix))) continue;
      const buf = readFileSync(full);
      if (buf.includes(0)) continue; // binary
      buf
        .toString("utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          const match = line.match(CJK);
          if (match)
            hits.push({
              file: relative(root, full),
              line: index + 1,
              text: line.trim().slice(0, 100),
            });
        });
    }
  };
  for (const dir of dirs) {
    try {
      walk(join(root, dir));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = findCjk();
  if (hits.length > 0) {
    console.error(`Found CJK characters in ${hits.length} line(s):`);
    for (const hit of hits.slice(0, 50)) console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
    process.exit(1);
  }
  console.log("check:cjk OK - no CJK characters in src/, public/, packs/, examples/ or scripts/ (Chinese is allowed only in src/lib/i18n-zh.ts, docs/ and README.zh-CN.md).");
}
