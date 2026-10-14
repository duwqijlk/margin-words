import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_QQ_GROUPS, normalizeQqGroups, QQ_GROUP_LIMIT } from "../src/lib/qq-groups.ts";

test("the built-in group is the first number", () => {
  assert.deepEqual([...DEFAULT_QQ_GROUPS], ["656911882"]);
});

test("a saved list keeps only distinct 5 to 12 digit numbers", () => {
  assert.deepEqual(normalizeQqGroups({ groups: [] }), { ok: true, groups: [] });
  assert.deepEqual(normalizeQqGroups({ groups: ["656911882", "12345"] }).groups, ["656911882", "12345"]);
  assert.equal(normalizeQqGroups({ groups: ["656911882", "656911882"] }).ok, false);
  assert.equal(normalizeQqGroups({ groups: ["1234"] }).ok, false);
  assert.equal(normalizeQqGroups({ groups: ["1234567890123"] }).ok, false);
  assert.equal(normalizeQqGroups({ groups: ["qq656911882"] }).ok, false);
  assert.equal(normalizeQqGroups({ rails: [] }).ok, false);
});

test("the list stops at its cap", () => {
  const groups = Array.from({ length: QQ_GROUP_LIMIT + 1 }, (_, n) => String(10000 + n));
  assert.equal(normalizeQqGroups({ groups }).ok, false);
  assert.equal(normalizeQqGroups({ groups: groups.slice(0, QQ_GROUP_LIMIT) }).ok, true);
});
