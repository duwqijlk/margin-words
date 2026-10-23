import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBlurbs, BLURB_MAX } from "../src/lib/book-blurbs-parse.ts";
import { blurbProblems, bookIds, BLURB_MAX as CHECK_MAX } from "./check-blurbs.mjs";

test("the app reads only well-formed summaries, as plain text", () => {
  assert.deepEqual(parseBlurbs(null), {});
  assert.deepEqual(parseBlurbs({ books: [] }), {});
  const table = parseBlurbs({
    format: 1,
    books: { alice: "  A girl falls\n down a rabbit hole.  ", "Bad Id": "x", "../x": "x", empty: "   ", num: 3 },
  });
  assert.deepEqual(table, { alice: "A girl falls down a rabbit hole." });
  assert.equal(parseBlurbs({ books: { alice: "a".repeat(BLURB_MAX + 50) } }).alice.length, BLURB_MAX);
  assert.equal(BLURB_MAX, CHECK_MAX, "the app and the checker agree on the limit");
});

test("the checker refuses unknown ids, the wrong language, and markup", () => {
  const ids = new Set(["alice"]);
  assert.deepEqual(blurbProblems({ format: 1, books: {} }, "zh", ids), []);
  assert.deepEqual(blurbProblems({ format: 1, books: { alice: "\u7231\u4e3d\u4e1d\u6389\u8fdb\u5154\u5b50\u6d1e\u3002" } }, "zh", ids), []);
  assert.deepEqual(blurbProblems({ format: 1, books: { alice: "Alice falls down a rabbit hole." } }, "en", ids), []);
  const bad = (books, locale) => blurbProblems({ format: 1, books }, locale, ids).join("\n");
  assert.match(bad({ alicee: "Alice." }, "en"), /no book with this id/);
  assert.match(bad({ alice: "Alice falls." }, "zh"), /has no Chinese/);
  assert.match(bad({ alice: "\u7231\u4e3d\u4e1d" }, "en"), /has Chinese/);
  assert.match(bad({ alice: "Alice <b>falls</b>." }, "en"), /plain text only/);
  assert.match(bad({ alice: "" }, "en"), /empty/);
  assert.match(blurbProblems({ books: {} }, "en", ids).join(), /format/);
});

test("the shipped summary files pass the checker", () => {
  const ids = bookIds();
  assert.ok(ids.has("alice") && ids.size > 50, "book ids come from packs/ and public-books/");
  for (const locale of ["zh", "en"]) {
    const value = JSON.parse(readFileSync(new URL(`../docs/blurbs/${locale}.json`, import.meta.url), "utf8"));
    assert.deepEqual(blurbProblems(value, locale, ids), [], `docs/blurbs/${locale}.json`);
  }
});
