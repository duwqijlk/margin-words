import assert from "node:assert/strict";
import test from "node:test";
import { isRecentUpdate, recentUpdates, RECENT_UPDATE_DAYS, updateInstant } from "../src/lib/discover-recent.ts";

const now = new Date(2026, 9, 8, 15, 30, 0);

function day(offset) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${d}`;
}

test("a recent window is three local days, including today", () => {
  assert.equal(RECENT_UPDATE_DAYS, 3);
  assert.equal(isRecentUpdate(day(0), now), true);
  assert.equal(isRecentUpdate(day(-2), now), true);
  assert.equal(isRecentUpdate(day(-3), now), false);
  assert.equal(isRecentUpdate("", now), false);
  assert.equal(isRecentUpdate("yesterday", now), false);
  assert.equal(updateInstant("2026-13-40"), null);
});

test("an instant uses its real time and a future time stays out", () => {
  const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const later = new Date(now.getTime() + 60 * 1000).toISOString();
  assert.equal(isRecentUpdate(recent, now), true);
  assert.equal(isRecentUpdate(old, now), false);
  assert.equal(isRecentUpdate(later, now), false);
});

test("the row is newest first and leaves the main list alone", () => {
  const rows = [
    { id: "old", title: "Zebra", updated: day(-8) },
    { id: "mid", title: "Moon", updated: day(-2) },
    { id: "new-b", title: "Birch", updated: day(0) },
    { id: "new-a", title: "Aspen", updated: day(0) },
    { id: "blank", title: "None", updated: "" },
  ];
  assert.deepEqual(
    recentUpdates(rows, now).map((row) => row.id),
    ["new-a", "new-b", "mid"],
  );
  assert.deepEqual(rows.map((row) => row.id), ["old", "mid", "new-b", "new-a", "blank"]);
});
