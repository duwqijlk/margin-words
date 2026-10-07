/**
 * The decisions behind word-list updates (src/lib/word-list-plan.ts):
 * a newer list waits for the reader to tap Update, a hand-edited list is never
 * replaced, and a changed book file keeps that same button.
 * Also the edition check a new list must pass before it replaces the list on a book
 * the reader supplied the EPUB for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { wordListPlan } = await loadAppModules();
const {
  planListUpdate,
  checkListAgainstBook,
  wordListUpdateActions,
  holdOffersUpdate,
  holdReasonKey,
  savedListIsCurrent,
} = wordListPlan;

const base = {
  installedRev: "aaa",
  catalogRev: "bbb",
  listSource: undefined,
  installedSha: "",
  catalogSha: "",
};

test("a changed catalog revision waits for the reader to tap Update", () => {
  assert.deepEqual(planListUpdate(base), { kind: "manual", why: "newList" });
});

test("an unchanged or unknown revision does nothing", () => {
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "aaa" }), { kind: "none" });
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "" }), { kind: "none" });
});

test("a stored list with the current revision but a different word count still waits for Update", () => {
  assert.deepEqual(
    planListUpdate({ ...base, catalogRev: "aaa", installedWords: 1325, catalogWords: 2859 }),
    { kind: "manual", why: "newList" },
  );
  assert.deepEqual(
    planListUpdate({ ...base, catalogRev: "aaa", installedWords: 2859, catalogWords: 2859 }),
    { kind: "none" },
  );
  // the e-book is not stored yet, so there is no list on the book to compare
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "aaa", catalogWords: 2859 }), {
    kind: "none",
  });
  // a hand-edited list stays, even when its size is not the catalog size
  assert.deepEqual(
    planListUpdate({
      ...base,
      catalogRev: "aaa",
      listSource: "custom",
      installedWords: 1325,
      catalogWords: 2859,
    }),
    { kind: "none" },
  );
});

test("a list the reader added or edited by hand is never replaced", () => {
  assert.deepEqual(planListUpdate({ ...base, listSource: "custom" }), {
    kind: "manual",
    why: "ownList",
  });
});

test("manual Update keeps a hand-edited list and only moves the saved copy and revision on", () => {
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: true, listSource: "custom" }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
  // a pack list on a stored book is still applied
  assert.equal(
    wordListUpdateActions({ hasStoredBook: true, listSource: "twits" }).applyGlossary,
    true,
  );
  assert.equal(
    wordListUpdateActions({ hasStoredBook: true, listSource: undefined }).applyGlossary,
    true,
  );
  // a card still waiting for the reader's e-book only refreshes the saved copy
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: false, listSource: "custom" }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
  assert.deepEqual(wordListUpdateActions({ hasStoredBook: false, listSource: undefined }), {
    applyGlossary: false,
    saveText: true,
    saveRev: true,
  });
});

test("a hand-edited list does not get an Update button, and the card says why", () => {
  assert.equal(holdOffersUpdate("ownList"), false);
  assert.equal(holdOffersUpdate("bookChanged"), true);
  assert.equal(holdOffersUpdate("mismatch"), true);
  assert.equal(holdOffersUpdate("newList"), true);
  assert.equal(holdReasonKey("ownList"), "lists.keptYours");
  assert.equal(holdReasonKey("bookChanged"), "lists.keptBook");
  assert.equal(holdReasonKey("newList"), "lists.newList");
  const en = readFileSync(new URL("../src/lib/i18n-en.ts", import.meta.url), "utf8");
  const zh = readFileSync(new URL("../src/lib/i18n-zh.ts", import.meta.url), "utf8");
  assert.match(en, /"lists\.keptYours": "Your edited list is kept"/);
  assert.match(en, /"lists\.keptBook": "The book file changed\. Tap Update for the new list\."/);
  assert.match(en, /"lists\.newList": "A new word list is ready\. Tap Update\."/);
  assert.match(zh, /"lists\.keptYours": "/);
  assert.match(zh, /"lists\.keptBook": "/);
  assert.match(zh, /"lists\.newList": "/);
});

test("a saved word list is paired only when it is the catalog file", () => {
  assert.equal(savedListIsCurrent("abc", "abc"), true);
  assert.equal(savedListIsCurrent("old", "abc"), false);
  assert.equal(savedListIsCurrent("", "abc"), false);
  assert.equal(savedListIsCurrent("abc", ""), true);
});

test("a classic whose book file changed keeps the manual Update button", () => {
  assert.deepEqual(planListUpdate({ ...base, installedSha: "oldsha", catalogSha: "newsha" }), {
    kind: "manual",
    why: "bookChanged",
  });
  // same book file: only the list changed, so Update is offered and nothing is replaced yet
  assert.deepEqual(planListUpdate({ ...base, installedSha: "sha1", catalogSha: "sha1" }), {
    kind: "manual",
    why: "newList",
  });
});

const listFor = (context) =>
  JSON.stringify({
    version: 2,
    glossary: {
      lantern: {
        pos: "noun",
        meaning: "A small light you can carry.",
        senses: [{ meaning: "A small light.", anchors: [{ chapter: 1, occurrence: 1, context }] }],
      },
    },
  });

test("a new list must still match the reader's own book", () => {
  const book = ["He lifted the paper lantern over the gate and smiled."];
  const good = checkListAgainstBook(listFor("lifted the paper lantern over"), book);
  assert.equal(good.ok, true);
  assert.equal(good.percent, 100);

  const wrong = checkListAgainstBook(listFor("an entirely different story"), book);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.problem, "mismatch");
  assert.equal(wrong.percent, 0);

  const broken = checkListAgainstBook("not json at all", book);
  assert.equal(broken.ok, false);
  assert.equal(broken.problem, "unreadable");
});
