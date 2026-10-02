import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findCjk } from "./check-no-cjk.mjs";

test("flags CJK in src and ignores clean files and fonts", () => {
  const root = mkdtempSync(join(tmpdir(), "cjk-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "public", "fonts"), { recursive: true });
  writeFileSync(join(root, "src", "ok.ts"), 'export const a = "Hello";\n');
  writeFileSync(join(root, "public", "fonts", "x.txt"), "\u4e2d\u6587");
  assert.equal(findCjk(root).length, 0);
  writeFileSync(join(root, "src", "bad.ts"), 'export const a = "\u4e66\u67b6";\n');
  writeFileSync(join(root, "src", "bad2.ts"), "x = '\uff08';\n");
  assert.equal(findCjk(root).length, 2);
});

test("allows CJK only in src/lib/i18n-zh.ts, and still fails elsewhere in src, public and packs", () => {
  const root = mkdtempSync(join(tmpdir(), "cjk-"));
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "public", "guide"), { recursive: true });
  mkdirSync(join(root, "packs", "x"), { recursive: true });
  writeFileSync(join(root, "src", "lib", "i18n-zh.ts"), 'export const a = "\u4e66\u67b6";\n');
  assert.equal(findCjk(root).length, 0, "the dictionary may hold Chinese");
  writeFileSync(join(root, "src", "lib", "i18n-en.ts"), 'export const a = "\u4e66\u67b6";\n');
  writeFileSync(join(root, "public", "guide", "a.html"), "<p>\u4e66\u67b6</p>");
  writeFileSync(join(root, "packs", "x", "glossary.json"), '{"a":"\u4e66"}');
  const files = findCjk(root).map((hit) => hit.file.split("\\").join("/")).sort();
  assert.deepEqual(files, ["packs/x/glossary.json", "public/guide/a.html", "src/lib/i18n-en.ts"]);
});
