import assert from "node:assert/strict";
import { test } from "node:test";
import { RELOAD_QUIET_MS, RELOAD_STOP, reloadPlan } from "../src/lib/reload-guard.ts";

const now = 1_000_000;

test("the first ask reloads", () => {
  assert.equal(reloadPlan(now, null), "reload");
  assert.equal(reloadPlan(now, ""), "reload");
  assert.equal(reloadPlan(now, "nope"), "reload");
});

test("a second ask in the same burst drops the shell once, then stops", () => {
  assert.equal(reloadPlan(now + 500, String(now)), "reset");
  assert.equal(reloadPlan(now + RELOAD_QUIET_MS - 1, String(now)), "reset");
  assert.equal(reloadPlan(now, RELOAD_STOP), "stop");
});

test("a later update, after the quiet window, may reload again", () => {
  assert.equal(reloadPlan(now + RELOAD_QUIET_MS, String(now)), "reload");
  assert.equal(reloadPlan(now + RELOAD_QUIET_MS + 5_000, String(now)), "reload");
});
