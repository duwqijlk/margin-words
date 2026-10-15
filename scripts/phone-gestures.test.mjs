import assert from "node:assert/strict";
import test from "node:test";
import {
  readingPageTap,
  SHELF_MENU_HOLD_MS,
  shelfPressDown,
  shelfPressHeld,
  shelfPressMove,
  shelfPressRelease,
} from "../src/lib/phone-gestures.ts";

test("a phone tap while the word sheet is open closes it", () => {
  assert.equal(readingPageTap({ phone: true, cardOpen: true, hitWord: true }), "close");
  assert.equal(readingPageTap({ phone: true, cardOpen: true, hitWord: false }), "close");
});

test("a phone tap with no card open still looks the word up", () => {
  assert.equal(readingPageTap({ phone: true, cardOpen: false, hitWord: true }), "open");
  assert.equal(readingPageTap({ phone: true, cardOpen: false, hitWord: false }), "close");
});

test("a wider screen can switch to another word while a card is open", () => {
  assert.equal(readingPageTap({ phone: false, cardOpen: true, hitWord: true }), "open");
});

test("a short press on the phone shelf menu opens the book", () => {
  assert.equal(shelfPressRelease(shelfPressDown()), "book");
});

test("holding the phone shelf menu opens the menu when the finger lifts", () => {
  assert.equal(shelfPressRelease(shelfPressHeld(shelfPressDown())), "menu");
});

test("sliding off the phone shelf menu does nothing", () => {
  const slid = shelfPressMove(shelfPressHeld(shelfPressDown()), 145);
  assert.equal(slid, "scroll");
  assert.equal(shelfPressRelease(slid), "none");
  assert.ok(SHELF_MENU_HOLD_MS >= 400);
});
