// The English and Chinese dictionaries must have the same keys and the same {placeholders};
// the language choice rules must work. tsc also checks the keys; this test checks the values.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const ts = require("typescript");

/** Load src/lib/i18n-en.ts and i18n-zh.ts as plain JavaScript (no bundler needed). */
async function load() {
  const out = mkdtempSync(join(tmpdir(), "i18n-"));
  writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
  for (const name of ["i18n-en", "i18n-zh"]) {
    const source = readFileSync(join(ROOT, "src", "lib", `${name}.ts`), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    writeFileSync(join(out, `${name}.js`), js);
  }
  const en = (await import(pathToFileURL(join(out, "i18n-en.js")).href)).en;
  const zh = (await import(pathToFileURL(join(out, "i18n-zh.js")).href)).zh;
  return { en, zh };
}

const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/u;

test("en and zh have identical key sets", async () => {
  const { en, zh } = await load();
  const a = Object.keys(en).sort();
  const b = Object.keys(zh).sort();
  assert.deepEqual(
    a.filter((k) => !b.includes(k)),
    [],
    "keys missing in zh",
  );
  assert.deepEqual(
    b.filter((k) => !a.includes(k)),
    [],
    "extra keys in zh",
  );
  assert.ok(a.length > 300, `only ${a.length} keys?`);
});

test("every text is filled, and en and zh use the same {placeholders}", async () => {
  const { en, zh } = await load();
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim(), `en ${key} is empty`);
    assert.ok(zh[key].trim(), `zh ${key} is empty`);
    assert.equal(holes(zh[key]), holes(en[key]), `placeholders differ in ${key}`);
  }
});

test("English texts have no Chinese; Chinese texts are Chinese (apart from names and codes)", async () => {
  const { en, zh } = await load();
  const same = [];
  for (const key of Object.keys(en)) {
    assert.ok(!CJK.test(en[key]), `en ${key} has Chinese`);
    if (!CJK.test(zh[key])) same.push(key);
  }
  // Only a few texts may stay the same in zh (the brand name, "A-Z" and similar).
  const allowed = new Set(["common.brand", "nb.order.az", "shelf.summary"]);
  assert.deepEqual(same.filter((k) => !allowed.has(k)), [], "zh texts without any Chinese");
});

test("the UI does not call the books free", async () => {
  const { en, zh } = await load();
  for (const [key, value] of Object.entries(en)) assert.equal(/\bfree\b/i.test(value), false, `${key}: ${value}`);
  for (const [key, value] of Object.entries(zh))
    assert.equal(String(value).includes("\u514d\u8d39"), false, `${key}: ${value}`);
});

test("plural pairs exist for both forms", async () => {
  const { en } = await load();
  for (const key of Object.keys(en)) {
    if (key.endsWith(".one")) assert.ok(en[key.replace(/\.one$/, ".other")], `${key} has no .other`);
    if (key.endsWith(".other")) assert.ok(en[key.replace(/\.other$/, ".one")], `${key} has no .one`);
  }
});

test("language choice: saved choice first, else browser language (zh* -> zh, else en)", async () => {
  // detectLocale is small; load it from source with the dictionaries stubbed out.
  const source = readFileSync(join(ROOT, "src", "lib", "i18n.ts"), "utf8");
  const match = source.match(/export function detectLocale[\s\S]*?\n}\n/);
  assert.ok(match, "detectLocale not found");
  const fn = new Function(`${match[0].replace("export function", "function").replace(/: string \| null \| undefined/g, "").replace(/\): Locale/, ")")}; return detectLocale;`)();
  assert.equal(fn("en", "zh-CN"), "en");
  assert.equal(fn("zh", "en-US"), "zh");
  assert.equal(fn(null, "zh-CN"), "zh");
  assert.equal(fn(null, "zh"), "zh");
  assert.equal(fn(null, "zh-TW"), "zh");
  assert.equal(fn(null, "zh-Hans-CN"), "zh");
  assert.equal(fn(null, "en-US"), "en");
  assert.equal(fn(null, "fr-FR"), "en");
  assert.equal(fn("garbage", "zh-CN"), "zh");
  assert.equal(fn(null, undefined), "en");
});
