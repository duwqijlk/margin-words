// When an edit is uploaded and when a sync may skip its pull (src/lib/sync-pace.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSkipPull,
  HOLD_DELAY_MS,
  HOLD_MAX_CHANGES,
  PULL_FRESH_MS,
  PUSH_DELAY_MS,
  pushDelay,
} from "../src/lib/sync-pace.ts";
import { afterPull, FULL_PULL_MS } from "../src/lib/sync-view.ts";

const NOW = 1_800_000_000_000;
const EMAIL = "a@example.com";

test("an edit uploads after the usual short wait unless a review session holds uploads", () => {
  assert.equal(pushDelay(false, 1), PUSH_DELAY_MS);
  assert.equal(pushDelay(false, 50), PUSH_DELAY_MS);
  assert.equal(pushDelay(true, 1), HOLD_DELAY_MS);
  assert.equal(pushDelay(true, HOLD_MAX_CHANGES - 1), HOLD_DELAY_MS);
  assert.ok(HOLD_DELAY_MS > PUSH_DELAY_MS);
});

test("held uploads go out at once when a full batch is waiting", () => {
  // Every edit restarts the wait, so anything longer than the gap between answers would never fire.
  assert.equal(pushDelay(true, HOLD_MAX_CHANGES), 0);
  assert.equal(pushDelay(true, HOLD_MAX_CHANGES + 5), 0);
});

test("a push right after a pull skips the pull only with a cursor record for the same account", () => {
  const view = afterPull(null, EMAIL, [], NOW - 5_000, true, NOW - 5_000);
  const last = { email: EMAIL, at: NOW - 5_000 };
  assert.equal(canSkipPull(view, EMAIL, last, NOW), true);
  assert.equal(canSkipPull(null, EMAIL, last, NOW), false, "no record: the upload needs a pull to compare against");
  assert.equal(canSkipPull(view, EMAIL, null, NOW), false, "no pull yet in this page");
  assert.equal(canSkipPull(view, "b@example.com", last, NOW), false, "another account");
  assert.equal(canSkipPull(view, EMAIL, { email: "b@example.com", at: NOW - 5_000 }, NOW), false);
  assert.equal(canSkipPull(view, null, last, NOW), false, "signed out");
});

test("a pull older than the window, or from the future, is not trusted", () => {
  const view = afterPull(null, EMAIL, [], NOW, true, NOW);
  assert.equal(canSkipPull(view, EMAIL, { email: EMAIL, at: NOW - PULL_FRESH_MS + 1 }, NOW), true);
  assert.equal(canSkipPull(view, EMAIL, { email: EMAIL, at: NOW - PULL_FRESH_MS }, NOW), false);
  assert.equal(canSkipPull(view, EMAIL, { email: EMAIL, at: NOW + 1_000 }, NOW), false, "clock moved back");
});

test("a due full pull is never skipped", () => {
  const view = afterPull(null, EMAIL, [], NOW - FULL_PULL_MS, true, NOW - FULL_PULL_MS);
  assert.equal(canSkipPull(view, EMAIL, { email: EMAIL, at: NOW - 1_000 }, NOW), false);
});
