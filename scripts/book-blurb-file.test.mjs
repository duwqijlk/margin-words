import assert from "node:assert/strict";
import { test } from "node:test";
import { BLURB_MAX, blurbFile, blurbKey, blurbProblems, parseBlurbFile } from "../src/lib/book-blurb-file.ts";

const zh = "\u4e00\u4e2a\u5973\u5b69\u8ddf\u7740\u5154\u5b50\u8df3\u8fdb\u4e86\u6d1e\u3002";

test("a summary lives next to its word list, by catalog", () => {
  assert.equal(blurbKey("lists", "wonder"), "word-lists/wonder/blurb.json");
  assert.equal(blurbKey("public", "alice"), "public-books/alice/blurb.json");
});

test("a summary file reads as plain text in each language, and a bad file as empty", () => {
  assert.deepEqual(parseBlurbFile(null), { zh: "", en: "" });
  assert.deepEqual(parseBlurbFile({ zh: 3, en: ["x"] }), { zh: "", en: "" });
  assert.deepEqual(parseBlurbFile({ format: 1, zh, en: "  Alice  falls\n\n  down. " }), { zh, en: "Alice falls\ndown." });
  assert.equal(parseBlurbFile({ en: "a".repeat(BLURB_MAX + 40) }).en.length, BLURB_MAX);
});

test("a summary is refused in the wrong language, too long, or with markup", () => {
  assert.deepEqual(blurbProblems({ zh, en: "Alice falls down a rabbit hole." }), []);
  assert.deepEqual(blurbProblems({}), [], "both languages may be empty");
  assert.deepEqual(blurbProblems({ zh: "Alice falls." }), ["zh:no-chinese"]);
  assert.deepEqual(blurbProblems({ en: zh }), ["en:has-chinese"]);
  assert.deepEqual(blurbProblems({ en: "A **bold** girl." }), ["en:markup"]);
  assert.deepEqual(blurbProblems({ en: "a".repeat(BLURB_MAX + 1) }), ["en:too-long"]);
  assert.deepEqual(blurbProblems({ zh: 5 }), ["zh:not-text"]);
});

test("the stored file keeps only the languages that have text", () => {
  assert.deepEqual(blurbFile({ zh, en: "  " }), { format: 1, zh });
  assert.deepEqual(blurbFile({}), { format: 1 });
});
