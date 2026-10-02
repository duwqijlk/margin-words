import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lexileMeasure, lexileNumber, compareLexile, difficultyBand } from "../src/lib/lexile.ts";
import { loadAppModules } from "./lib/app-modules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEASURE = /^(?:AD|NC|HL|IG|GN|NP)?\d{1,4}L$|^BR\d{1,4}L$/;

test("lexileMeasure accepts a published measure and rejects prose", () => {
  assert.equal(lexileMeasure("880L"), "880L");
  assert.equal(lexileMeasure(" 880 l "), "880L");
  assert.equal(lexileMeasure("HL1070L"), "HL1070L");
  assert.equal(lexileMeasure("BR100L"), "BR100L");
  assert.equal(lexileMeasure("about 1000"), "");
  assert.equal(lexileMeasure(""), "");
  assert.equal(lexileMeasure(880), "");
});

test("lexile numbers sort beginning-reader measures below 0L", () => {
  assert.equal(lexileNumber("880L"), 880);
  assert.equal(lexileNumber("BR100L"), -100);
  assert.equal(lexileNumber("HL1070L"), 1070);
  assert.ok(compareLexile("BR100L", "560L", "easy") < 0);
  assert.equal(compareLexile("nope", "880L", "hard"), 1);
  assert.equal(difficultyBand(""), "unrated");
  assert.equal(difficultyBand("640L"), "under800");
  assert.equal(difficultyBand("880L"), "mid");
  assert.equal(difficultyBand("1020L"), "high");
});

test("a word list may carry lexile, and a bad value is only a warning", async () => {
  const { format } = await loadAppModules();
  const base = { version: 2, glossary: { cat: { meaning: "an animal", pos: "noun" } } };
  const good = format.validateGlossary(JSON.stringify({ ...base, lexile: "1020L" }));
  assert.equal(good.ok, true);
  assert.equal(good.file.lexile, "1020L");
  const bad = format.validateGlossary(JSON.stringify({ ...base, lexile: "about 1000" }));
  assert.equal(bad.ok, true);
  assert.equal(bad.file.lexile, undefined);
  assert.ok(bad.warnings.some((line) => line.includes("lexile")));
  const none = format.validateGlossary(JSON.stringify(base));
  assert.equal(none.ok, true);
  assert.equal(none.file.lexile, undefined);
});

test("both catalogs publish a Lexile measure on every pack", () => {
  for (const folder of ["public-books", "packs"]) {
    const catalog = JSON.parse(readFileSync(join(ROOT, folder, "catalog.json"), "utf8"));
    assert.ok(catalog.packs.length > 0, folder);
    for (const pack of catalog.packs) {
      assert.match(pack.lexile, MEASURE, `${folder}/${pack.id}`);
      const info = JSON.parse(readFileSync(join(ROOT, folder, pack.id, "info.json"), "utf8"));
      assert.equal(info.lexile, pack.lexile, `${pack.id} info.json`);
    }
  }
});
