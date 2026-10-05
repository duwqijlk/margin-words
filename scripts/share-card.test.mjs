// The share picture stays phone-sized, and a nickname is a short non-unique label.
import assert from "node:assert/strict";
import test from "node:test";
import { cleanNickname, NICKNAME_MAX } from "../src/lib/nickname.ts";
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, SHARE_SITE, shareDateParts } from "../src/lib/share-card.ts";

test("a nickname is 1 to 16 characters and the same text can be saved twice", () => {
  assert.equal(cleanNickname("  Mina  "), "Mina");
  assert.equal(cleanNickname("Mina"), "Mina");
  assert.equal(cleanNickname("a".repeat(NICKNAME_MAX))?.length, NICKNAME_MAX);
  assert.equal(cleanNickname("a".repeat(NICKNAME_MAX + 1)), null);
  assert.equal(cleanNickname("   "), null);
  assert.equal(cleanNickname(12), null);
  assert.equal(cleanNickname("Mina\nLee"), "Mina Lee");
});

test("the share picture is a phone screen, not a large poster", () => {
  assert.equal(SHARE_CARD_WIDTH, 720);
  assert.equal(SHARE_CARD_HEIGHT, 1280);
  assert.ok(SHARE_CARD_WIDTH <= 800);
  assert.ok(SHARE_CARD_HEIGHT <= 1400);
  assert.equal(SHARE_SITE, "inputread.site");
});

test("the share date is the month and the day", () => {
  const date = new Date(2026, 9, 5);
  assert.deepEqual(shareDateParts(date, "en"), { month: "October", day: "5" });
  assert.deepEqual(shareDateParts(date, "zh"), { month: "10", day: "5" });
});
