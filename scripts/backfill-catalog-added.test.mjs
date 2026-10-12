import test from "node:test";
import assert from "node:assert/strict";
import { fillAdded } from "./backfill-catalog-added.mjs";

test("added comes from git, else from updated but never after a later row", () => {
  const rows = [
    { id: "old", updated: "2026-10-12T02:00:00.000Z" },
    { id: "uploaded", updated: "2026-10-12T05:00:00.000Z" },
    { id: "kept", updated: "2026-10-12T06:00:00.000Z", added: "2026-10-09T00:00:00.000Z" },
    { id: "newest", updated: "2026-10-12T07:00:00.000Z" },
  ];
  const git = { old: "2026-10-04T10:00:00+08:00" };
  const out = fillAdded(rows, (id) => git[id] ?? "");
  assert.equal(out[0].added, "2026-10-04T10:00:00+08:00");
  assert.equal(out[1].added, "2026-10-09T00:00:00.000Z");
  assert.equal(out[2].added, "2026-10-09T00:00:00.000Z");
  assert.equal(out[3].added, "2026-10-12T07:00:00.000Z");
  assert.equal(rows[0].added, undefined);
});
