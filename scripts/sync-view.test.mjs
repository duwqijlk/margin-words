// The device's record of what the server holds (src/lib/sync-view.ts): when a pull may be partial,
// and which items must be uploaded after one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sameSyncItem } from "../src/lib/sync-merge.ts";
import {
  afterPull,
  afterPush,
  FULL_PULL_MS,
  needsUpload,
  pullAfter,
  readView,
  signatureOf,
} from "../src/lib/sync-view.ts";

const NOW = 1_800_000_000_000;
const shelf = (key, title, updatedAt = 10) => ({
  kind: "shelf",
  itemId: key,
  updatedAt,
  deleted: false,
  data: { id: `card-${key}`, title, author: "A", cloth: "cloth", createdAt: 1, updatedAt },
});

test("the first pull of an account on this device, a stale record, or another account is a full pull", () => {
  assert.equal(pullAfter(null, "a@example.com", NOW), null);
  const view = afterPull(null, "a@example.com", [shelf("book:a", "A")], NOW - 60_000, true, NOW);
  assert.equal(pullAfter(view, "a@example.com", NOW + 1000), NOW - 60_000);
  assert.equal(pullAfter(view, "b@example.com", NOW + 1000), null, "another account");
  assert.equal(pullAfter(view, null, NOW + 1000), null, "signed out");
  assert.equal(pullAfter(view, "a@example.com", NOW + FULL_PULL_MS), null, "once a day");
  assert.equal(pullAfter(view, "a@example.com", NOW - 1), null, "a clock set back");
});

test("a server without cursors leaves no record, so every pull stays full", () => {
  assert.equal(afterPull(null, "a@example.com", [shelf("book:a", "A")], undefined, true, NOW), null);
});

test("a partial pull adds to the record; a full pull replaces it", () => {
  const first = afterPull(null, "a@example.com", [shelf("book:a", "A"), shelf("book:b", "B")], 100, true, NOW);
  const partial = afterPull(first, "a@example.com", [shelf("book:b", "B2")], 200, false, NOW + 5);
  assert.deepEqual(Object.keys(partial.sigs).sort(), ["shelf:book:a", "shelf:book:b"]);
  assert.equal(partial.fullAt, NOW, "a partial pull is not a full one");
  assert.equal(partial.cursor, 200);
  const full = afterPull(partial, "a@example.com", [shelf("book:c", "C")], 300, true, NOW + 9);
  assert.deepEqual(Object.keys(full.sigs), ["shelf:book:c"], "an item the server no longer returns is forgotten");
  assert.equal(full.fullAt, NOW + 9);
});

test("upload exactly what sameSyncItem would upload against the server's copy", () => {
  const server = [shelf("book:a", "A"), shelf("book:b", "B")];
  const view = afterPull(null, "a@example.com", server, 100, true, NOW);
  const local = [
    shelf("book:a", "A", 99), // same content, newer time: sameSyncItem ignores the time
    shelf("book:b", "B changed"),
    shelf("book:c", "C"), // the server has never seen it
    { ...shelf("book:a", "A"), itemId: "book:d", deleted: true, data: {} },
  ];
  const old = local.filter((item) => {
    const prior = server.find((other) => other.kind === item.kind && other.itemId === item.itemId);
    return !prior || !sameSyncItem(prior, item);
  });
  assert.deepEqual(
    local.filter((item) => needsUpload(view, item)).map((item) => item.itemId),
    old.map((item) => item.itemId),
  );
  // After the push the server holds them, and nothing is uploaded again.
  const pushed = afterPush(view, old);
  assert.deepEqual(local.filter((item) => needsUpload(pushed, item)), []);
});

test("the signature follows deleted and data, with key order not mattering", () => {
  const a = shelf("book:a", "A");
  const reordered = { ...a, data: Object.fromEntries(Object.entries(a.data).reverse()) };
  assert.equal(signatureOf(a), signatureOf(reordered));
  assert.notEqual(signatureOf(a), signatureOf({ ...a, deleted: true, data: {} }));
  assert.notEqual(signatureOf(a), signatureOf(shelf("book:a", "A!")));
});

test("a stored record is read only for its own account and only when well formed", () => {
  const view = afterPull(null, "a@example.com", [shelf("book:a", "A")], 100, true, NOW);
  const raw = JSON.stringify(view);
  assert.deepEqual(readView(raw, "a@example.com"), view);
  assert.equal(readView(raw, "b@example.com"), null);
  assert.equal(readView("{not json", "a@example.com"), null);
  assert.equal(readView(JSON.stringify({ ...view, cursor: "x" }), "a@example.com"), null);
});

test("the engine pulls with the cursor, decides uploads from the record, and forgets it on sign-out", () => {
  const engine = readFileSync(new URL("../src/lib/sync-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /accountRequest\(after === null \? "\/api\/sync" : `\/api\/sync\?after=\$\{after\}`\)/);
  assert.match(engine, /if \(view && !pulled\.full\) return needsUpload\(view, item\);/);
  assert.match(engine, /if \(!email\) writeStorage\(SYNC_VIEW_KEY, null\);/);
  assert.match(engine, /Date\.now\(\) - lastRun < FOCUS_PULL_MS && !dirty/);
});
