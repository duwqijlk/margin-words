import assert from "node:assert/strict";
import { test } from "node:test";
import { patchProblems, resolveSql } from "./glossary-patrol.mjs";

const live = {
  version: 2,
  title: "Book",
  chapters: 3,
  glossary: { lantern: { meaning: "A portable light." } },
  phrases: { "against all odds": { meaning: "Even though it seemed unlikely." } },
};

test("a patch that only adds words passes and names them", () => {
  const next = structuredClone(live);
  next.glossary.huge = { meaning: "Very, very big." };
  assert.deepEqual(patchProblems(live, next), { problems: [], added: ["huge"] });
});

test("a patch may not change or drop what the live list has", () => {
  const changed = structuredClone(live);
  changed.glossary.lantern.meaning = "A lamp.";
  changed.glossary.huge = { meaning: "Very, very big." };
  assert.deepEqual(patchProblems(live, changed).problems, ['changed word "lantern"']);

  const dropped = structuredClone(live);
  delete dropped.glossary.lantern;
  dropped.glossary.huge = { meaning: "Very, very big." };
  assert.deepEqual(patchProblems(live, dropped).problems, ['removed word "lantern"']);

  const phrases = structuredClone(live);
  phrases.phrases = {};
  phrases.glossary.huge = { meaning: "Very, very big." };
  assert.deepEqual(patchProblems(live, phrases).problems, ['changed "phrases"']);
});

test("a patch with nothing new is refused", () => {
  assert.deepEqual(patchProblems(live, structuredClone(live)).problems, ["no new words: nothing to publish"]);
});

test("resolve touches only missing-word taps and missing-meaning reports of that book", () => {
  const sql = resolveSql("Tom's Book", "abc123def456", ["huge", "toward"], 1000);
  assert.match(sql, /UPDATE book_word_taps .* WHERE book_title = 'Tom''s Book' AND word IN \('huge', 'toward'\) AND in_glossary = 0/);
  assert.match(sql, /UPDATE word_feedback .* AND reason = 'missing_meaning' AND status != 'resolved'/);
  assert.match(sql, /resolved_rev = 'abc123def456'/);
  assert.doesNotMatch(sql, /DELETE|DROP|too_hard|wrong_meaning/);
});
