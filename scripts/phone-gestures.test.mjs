import assert from "node:assert/strict";
import test from "node:test";
import {
  readingPageTap,
  SHELF_MENU_ARM_MS,
  shelfPressDown,
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

test("the first phone tap arms the shelf menu and does not open it", () => {
  assert.equal(shelfPressRelease(shelfPressDown("idle")), "arm");
});

test("the second phone tap opens the shelf menu", () => {
  assert.equal(shelfPressRelease(shelfPressDown("armed")), "menu");
});

test("a slide does not arm or open the shelf menu", () => {
  assert.equal(shelfPressRelease(shelfPressMove(shelfPressDown("idle"), 145)), "none");
  assert.equal(shelfPressRelease(shelfPressMove(shelfPressDown("armed"), 145)), "none");
  assert.ok(SHELF_MENU_ARM_MS >= 1000);
});
