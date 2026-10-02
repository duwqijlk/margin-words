import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";
import { SAMPLE_EPUB_PATH, senseOnlyGlossary } from "./lib/sense-only-fixture.mjs";

const { epub, format } = await loadAppModules();

const bytes = readFileSync(SAMPLE_EPUB_PATH);
const book = await epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { cover: false });

/** The words of chapter `n` that readingHtml underlines, read back from the html it makes. */
function underlined(file, chapter) {
  const entries = Object.entries(file.glossary);
  const ready = new Set(entries.map(([key]) => key));
  const forms = new Map();
  const sparse = new Map();
  for (const [key, gloss] of entries) {
    if (gloss.senseOnly === true) sparse.set(key, gloss);
    for (const form of gloss.forms ?? []) forms.set(form, key);
  }
  const resolve = (surface) => {
    const lower = surface.toLowerCase();
    return ready.has(lower) ? lower : (forms.get(lower) ?? lower);
  };
  const html = format.readingHtml(book.chapters[chapter].html, ready, resolve, chapter, sparse);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return [...doc.querySelectorAll("button.book-hard")].map((b) => ({ word: b.dataset.word.toLowerCase(), nth: Number(b.dataset.n) }));
}
const only = (list, word) => list.filter((item) => item.word === word);

test("the validator accepts senseOnly, keeps it, and leaves other entries alone", () => {
  const result = format.validateGlossary(senseOnlyGlossary());
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.file.glossary.light.senseOnly, true);
  assert.equal(result.file.glossary.run.senseOnly, true);
  assert.equal(result.file.glossary.shabby.senseOnly, undefined);
  assert.deepEqual(result.warnings.filter((w) => w.includes("senseOnly")), []);
});

test("senseOnly must be true or false; false is the same as leaving it out", () => {
  const bad = senseOnlyGlossary();
  bad.glossary.light.senseOnly = "yes";
  const result = format.validateGlossary(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /"light".*"senseOnly" must be true or false/);
  const off = senseOnlyGlossary();
  off.glossary.light.senseOnly = false;
  const checked = format.validateGlossary(off);
  assert.equal(checked.ok, true);
  assert.equal("senseOnly" in checked.file.glossary.light, false);
});

test("senseOnly without any anchored meaning is a warning (it would never be underlined)", () => {
  const list = senseOnlyGlossary();
  list.glossary.light.senses = [{ meaning: "A lamp." }];
  const result = format.validateGlossary(list);
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /"light" says "senseOnly": true but none of its meanings has "anchors"/);
});

test("entryAppliesAt: a plain entry applies everywhere, a senseOnly entry only at its anchors", () => {
  const tap = { chapter: 2, surface: "light", occurrence: 2, paragraph: "Halfway home, the light fell on a loose stone at the edge." };
  const plain = { senses: [{ meaning: "x", anchors: [{ chapter: 2, occurrence: 2 }] }] };
  assert.equal(format.entryAppliesAt("light", plain, { ...tap, occurrence: 1 }), true);
  const sparse = { ...plain, senseOnly: true };
  assert.equal(format.entryAppliesAt("light", sparse, tap), true);
  assert.equal(format.entryAppliesAt("light", sparse, { ...tap, occurrence: 1 }), false);
  assert.equal(format.entryAppliesAt("light", sparse, { ...tap, chapter: 1 }), false);
  assert.equal(format.entryAppliesAt("light", { senseOnly: true }, tap), false);
});

test("reader html: entries without the flag are underlined at every use, as before", () => {
  const file = senseOnlyGlossary();
  for (const key of ["light", "stood", "run"]) delete file.glossary[key].senseOnly;
  assert.equal(only(underlined(file, 2), "light").length, 3);
  assert.equal(only(underlined(file, 1), "light").length, 1);
  assert.equal(only(underlined(file, 1), "stood").length, 1);
  assert.equal(only(underlined(file, 0), "stood").length, 1);
});

test("reader html: a senseOnly entry is underlined only at the position its sense names", () => {
  const file = format.validateGlossary(senseOnlyGlossary()).file;
  // "light" is used once in chapter 1 and three times in chapter 2; only the 2nd use in chapter 2 is named.
  assert.deepEqual(only(underlined(file, 1), "light"), []);
  assert.deepEqual(only(underlined(file, 2), "light"), [{ word: "light", nth: 2 }]);
  // "stood" is used in chapter 0 and chapter 1; the sense is placed by a snippet of chapter 1.
  assert.deepEqual(only(underlined(file, 0), "stood"), []);
  assert.deepEqual(only(underlined(file, 1), "stood"), [{ word: "stood", nth: 1 }]);
  // "ran" belongs to the entry "run" through forms, and is placed by its snippet.
  assert.deepEqual(only(underlined(file, 1), "ran"), [{ word: "ran", nth: 1 }]);
  // The other entries of the same list are untouched.
  assert.equal(only(underlined(file, 0), "shabby").length, 1);
});
