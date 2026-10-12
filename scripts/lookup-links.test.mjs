import assert from "node:assert/strict";
import test from "node:test";
import { LOOKUP_SITES, lookupTerm, lookupUrl } from "../src/lib/lookup-links.ts";

test("lookup links open Longman, Merriam-Webster and Bing pictures for the word", () => {
  assert.deepEqual(LOOKUP_SITES, ["longman", "webster", "images"]);
  assert.equal(lookupUrl("longman", "lantern"), "https://www.ldoceonline.com/search/english/direct/?q=lantern");
  assert.equal(lookupUrl("webster", "lantern"), "https://www.merriam-webster.com/dictionary/lantern");
  assert.equal(lookupUrl("images", "lantern"), "https://www.bing.com/images/search?q=lantern");
});

test("a phrase keeps one space and loses outside punctuation", () => {
  assert.equal(lookupTerm("  give\n up, "), "give up");
  assert.equal(lookupTerm("“o’clock”"), "o'clock");
  assert.equal(lookupUrl("webster", "give up"), "https://www.merriam-webster.com/dictionary/give%20up");
  assert.equal(lookupUrl("images", "rock & roll"), "https://www.bing.com/images/search?q=rock%20%26%20roll");
});
