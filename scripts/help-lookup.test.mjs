import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { appModuleUrl, loadAppModules } from "./lib/app-modules.mjs";

await loadAppModules();

// Exercise the public lookup API with only IndexedDB replaced. Keep this loader local
// to the test: the command-line app loader deliberately has no storage dependencies.
const storage = `
  export const extrasRevision = () => 0;
  export const loadBookExtras = async () => globalThis.__helpLookupFixture.notes;
  export const loadStoredBook = async () => globalThis.__helpLookupFixture.book;
`;
const source = readFileSync(new URL("../src/lib/help-lookup.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "@\/lib\/([\w-]+)"/g, (_, name) => {
  const url = name === "book-db"
    ? `data:text/javascript,${encodeURIComponent(storage)}`
    : appModuleUrl(name);
  return `from ${JSON.stringify(url)}`;
}).replace(/import\.meta\.env\.DEV/g, "false");
const lookup = await import(`data:text/javascript,${encodeURIComponent(js)}`);

const repeated = "The same context appears in separate paragraphs.";
const note = { chapter: 9, paragraph: 0, context: repeated, mainIdea: "A repeated line.", simple: "This line repeats." };
const current = { html: `<p>${repeated}</p>`, paragraphs: [repeated] };

for (const useShared of [false, true]) {
  test(`background lookup passes segmentation to chapters and extras (${useShared ? "shared" : "loaded"} book)`, async () => {
    for (const extra of [false, true]) {
      const wrapped = {
        html: `<blockquote data-chapter-wrapper="1"><p>The same context appears</p><p>in separate paragraphs.</p></blockquote>`,
        paragraphs: ["The same context appears", "in separate paragraphs."],
      };
      const book = {
        segmentation: 2,
        chapters: extra ? [current] : [current, wrapped],
        extras: extra ? [{ ...wrapped, id: "x0" }] : [],
      };
      globalThis.__helpLookupFixture = { book, notes: { paragraphs: [note], sentences: [], phrases: {} } };
      const id = `segmented-${useShared}-${extra}`;
      if (useShared) lookup.shareStoredBook(id, book);
      // Only the live paragraph contains the entire context. Joining the background
      // paragraphs invents a second match across their boundary and loses this bulb.
      assert.deepEqual(await lookup.getParagraphNoteFlags(id, 0, [repeated]), [true]);
    }
  });
}

test("background whole-chapter fallback participates in ambiguity checks", async () => {
  const book = {
    chapters: [current, { html: `<div>${repeated}</div>`, paragraphs: [repeated] }],
  };
  globalThis.__helpLookupFixture = { book, notes: { paragraphs: [note], sentences: [], phrases: {} } };
  lookup.shareStoredBook("fallback", book);
  assert.deepEqual(await lookup.getParagraphNoteFlags("fallback", 0, [repeated]), [false]);
});

test("a sentence note lights the bulb of the paragraph that holds its sentence", async () => {
  const texts = ["The first paragraph has nothing.", "Then the old man walked slowly home."];
  const book = { chapters: [{ html: texts.map((t) => `<p>${t}</p>`).join(""), paragraphs: texts }] };
  const sentence = { chapter: 0, context: "the old man walked slowly", simple: "He went home slowly." };
  globalThis.__helpLookupFixture = { book, notes: { paragraphs: [], sentences: [sentence], phrases: {} } };
  lookup.shareStoredBook("sentence-bulb", book);
  assert.deepEqual(await lookup.getParagraphNoteFlags("sentence-bulb", 0, texts), [false, true]);
  assert.deepEqual(
    (await lookup.getSentenceNotesIn("sentence-bulb", 0, texts[1])).map((n) => n.simple),
    ["He went home slowly."],
  );
});
