// A nickname is a short label. It does not have to be unique.
import assert from "node:assert/strict";
import test from "node:test";
import { cleanNickname, NICKNAME_MAX } from "../src/lib/nickname.ts";

test("a nickname is 1 to 16 characters", () => {
  assert.equal(cleanNickname("  Mina  "), "Mina");
  assert.equal(cleanNickname("a".repeat(NICKNAME_MAX))?.length, NICKNAME_MAX);
  assert.equal(cleanNickname("a".repeat(NICKNAME_MAX + 1)), null);
  assert.equal(cleanNickname("   "), null);
  assert.equal(cleanNickname(12), null);
  assert.equal(cleanNickname("Mina\nLee"), "Mina Lee");
});
