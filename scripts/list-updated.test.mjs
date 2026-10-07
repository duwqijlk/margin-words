/**
 * Discover's update line: a bare day stays that day, and an instant shows the
 * hour and minute in this machine's time zone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { listUpdated } = await loadAppModules();
const { readUpdated, listUpdatedParts } = listUpdated;

test("a day is kept, and a clock time is read", () => {
  assert.equal(readUpdated("2026-10-07"), "2026-10-07");
  assert.equal(readUpdated(" 2026-10-07T01:17:00Z "), "2026-10-07T01:17:00Z");
  assert.equal(readUpdated("2026-10-07T09:17:00+08:00"), "2026-10-07T09:17:00+08:00");
  assert.equal(readUpdated("2026-10-07T01:17:00.123Z"), "2026-10-07T01:17:00.123Z");
  assert.equal(readUpdated("yesterday"), "");
  assert.equal(readUpdated(7), "");
});

test("a day does not invent a clock time", () => {
  assert.deepEqual(listUpdatedParts("2026-10-07"), { year: "2026", month: 10, day: 7 });
  assert.equal(listUpdatedParts("2026-02-31"), null);
  assert.equal(listUpdatedParts(""), null);
});

test("an instant becomes the local month, day, hour and minute", () => {
  const raw = "2026-10-07T01:17:00Z";
  const when = new Date(raw);
  const parts = listUpdatedParts(raw);
  assert.equal(parts.year, String(when.getFullYear()));
  assert.equal(parts.month, when.getMonth() + 1);
  assert.equal(parts.day, when.getDate());
  assert.equal(parts.hour, String(when.getHours()).padStart(2, "0"));
  assert.equal(parts.minute, String(when.getMinutes()).padStart(2, "0"));
  assert.equal(parts.minute.length, 2);
});
