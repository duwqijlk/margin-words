import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { epub, format } = await loadAppModules();

const fixture = JSON.parse(readFileSync(new URL("./fixtures/alice-tricky.glossary.json", import.meta.url), "utf8"));
const aliceEpub = new URL("../public-books/alice/book.epub", import.meta.url);
const hasAlice = existsSync(aliceEpub);
const bytes = hasAlice ? readFileSync(aliceEpub) : null;
const book = hasAlice
  ? await epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { cover: false })
  : null;
const needsBook = hasAlice ? false : "public-domain EPUB is not in git";

function render(file, chapter) {
  const entries = Object.entries(file.glossary);
  const ready = new Set(entries.map(([key]) => key));
  const forms = new Map();
  const sparse = new Map();
  const tricky = new Map();
  for (const [key, gloss] of entries) {
    if (gloss.senseOnly === true) sparse.set(key, gloss);
    if (format.hasTrickySense(gloss)) tricky.set(key, gloss);
    for (const form of gloss.forms ?? []) forms.set(form, key);
  }
  const resolve = (surface) => {
    const lower = surface.toLowerCase();
    return ready.has(lower) ? lower : (forms.get(lower) ?? lower);
  };
  const html = format.readingHtml(book.chapters[chapter].html, ready, resolve, chapter, sparse, tricky);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const pick = (cls) => [...doc.querySelectorAll(`button.${cls}`)].map((b) => ({ word: b.dataset.word.toLowerCase(), nth: Number(b.dataset.n) }));
  return { tricky: pick("book-tricky"), hard: pick("book-hard") };
}

const anchorsOf = (file) =>
  Object.entries(file.glossary).flatMap(([key, gloss]) =>
    (gloss.senses ?? []).filter((s) => s.trickyMeaning === true).flatMap((s) => (s.anchors ?? []).map((a) => ({ key, ...a }))),
  );

test("the fixture has 43 tricky anchors and the validator keeps the flag on every one", () => {
  assert.equal(anchorsOf(fixture).length, 43);
  const result = format.validateGlossary(fixture);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(anchorsOf(result.file).length, 43);
});

test("trickyMeaning must be true or false; false and absent are the same", () => {
  const bad = structuredClone(fixture);
  bad.glossary.well.senses[0].trickyMeaning = "yes";
  const result = format.validateGlossary(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /"trickyMeaning" must be true or false/);
  const off = structuredClone(fixture);
  off.glossary.well.senses[0].trickyMeaning = false;
  const checked = format.validateGlossary(off);
  assert.equal(checked.ok, true);
  assert.equal("trickyMeaning" in checked.file.glossary.well.senses[0], false);
});

test("only the boolean true counts, never the words of the text", () => {
  assert.equal(format.hasTrickySense({ senses: [{ meaning: "x", whyHard: "Not the usual meaning! Usually: a." }] }), false);
  assert.equal(format.hasTrickySense({ senses: [{ meaning: "x", trickyMeaning: "true" }] }), false);
  assert.equal(format.hasTrickySense({ senses: [{ meaning: "x", trickyMeaning: 1 }] }), false);
  assert.equal(format.hasTrickySense({ senses: [{ meaning: "x", trickyMeaning: true }] }), true);
  assert.equal(format.hasTrickySense({}), false);
  assert.equal(format.hasTrickySense(undefined), false);
});

test("Alice chapter 0: 'well' is marked exactly at its three anchors, and nowhere else", { skip: needsBook }, () => {
  const { tricky, hard } = render(fixture, 0);
  assert.deepEqual(tricky.filter((t) => t.word === "well").map((t) => t.nth), [2, 3, 4]);
  assert.equal(hard.filter((t) => t.word === "well").length, 0, "well is senseOnly: no plain underline");
});

test("every anchor of the fixture lands: one mark per anchor, in the right chapter", { skip: needsBook }, () => {
  const byChapter = new Map();
  for (const a of anchorsOf(fixture)) byChapter.set(a.chapter, (byChapter.get(a.chapter) ?? 0) + 1);
  let total = 0;
  for (const [chapter, expected] of byChapter) {
    const { tricky } = render(fixture, chapter);
    assert.equal(tricky.length, expected, `chapter ${chapter}`);
    total += tricky.length;
  }
  assert.equal(total, 43);
});

test("with the flag removed nothing is marked", { skip: needsBook }, () => {
  const plain = structuredClone(fixture);
  for (const gloss of Object.values(plain.glossary))
    for (const sense of gloss.senses ?? []) delete sense.trickyMeaning;
  for (let chapter = 0; chapter < 13; chapter += 1) assert.equal(render(plain, chapter).tricky.length, 0);
});

test("a non-senseOnly entry: the anchored place is marked, other places keep the plain underline", { skip: needsBook }, () => {
  const { tricky, hard } = render(fixture, 2);
  const marked = tricky.filter((t) => t.word.startsWith("address"));
  assert.equal(marked.length, 1);
  const plain = hard.filter((t) => t.word === "address");
  assert.equal(plain.some((t) => marked.some((m) => m.word === t.word && m.nth === t.nth)), false);
});

test("pickSense opens the tricky sense first at its anchor", () => {
  const gloss = fixture.glossary.well;
  const paragraph = "Down, down, down. Would the fall never come to an end! falling down a very deep well and so on.";
  const picked = format.pickSense("well", gloss, { chapter: 0, surface: "well", occurrence: 2, paragraph, before: paragraph.slice(0, paragraph.indexOf("well")) });
  assert.match(picked.meaning, /deep hole in the ground/);
  assert.match(picked.whyHard, /^Not the usual meaning!/);
  assert.equal(picked.via, "anchor");
});
