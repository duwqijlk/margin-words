/**
 * The decisions behind automatic word-list updates (src/lib/word-list-plan.ts):
 * when a list is replaced quietly, when the manual Update button stays, and when
 * the app waits for the next load. Also the edition check a new list must pass
 * before it replaces the list on a book the reader supplied the EPUB for.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { wordListPlan } = await loadAppModules();
const { planListUpdate, checkListAgainstBook } = wordListPlan;

const base = {
  installedRev: "aaa",
  catalogRev: "bbb",
  listSource: undefined,
  installedSha: "",
  catalogSha: "",
  offline: false,
  reading: false,
};

test("a changed catalog revision updates the list by itself", () => {
  assert.deepEqual(planListUpdate(base), { kind: "auto" });
});

test("an unchanged or unknown revision does nothing", () => {
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "aaa" }), { kind: "none" });
  assert.deepEqual(planListUpdate({ ...base, catalogRev: "" }), { kind: "none" });
});

test("a list the reader added or edited by hand is never replaced", () => {
  assert.deepEqual(planListUpdate({ ...base, listSource: "custom" }), {
    kind: "manual",
    why: "ownList",
  });
  // even offline or mid-reading, the answer stays "manual": no retry will touch it
  assert.deepEqual(planListUpdate({ ...base, listSource: "custom", offline: true }), {
    kind: "manual",
    why: "ownList",
  });
});

test("a classic whose book file changed keeps the manual Update button", () => {
  assert.deepEqual(
    planListUpdate({ ...base, installedSha: "oldsha", catalogSha: "newsha" }),
    { kind: "manual", why: "bookChanged" },
  );
  // same book file: only the list changed, so it updates by itself
  assert.deepEqual(
    planListUpdate({ ...base, installedSha: "sha1", catalogSha: "sha1" }),
    { kind: "auto" },
  );
});

test("offline or mid-reading waits for the next load", () => {
  assert.deepEqual(planListUpdate({ ...base, offline: true }), { kind: "wait", why: "offline" });
  assert.deepEqual(planListUpdate({ ...base, reading: true }), { kind: "wait", why: "reading" });
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
