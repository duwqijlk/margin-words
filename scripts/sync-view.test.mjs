// The device's record of what the server holds (src/lib/sync-view.ts): when a pull may be partial,
// and which items must be uploaded after one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeItem } from "../src/lib/sync-merge.ts";
import { clientSyncItem, historySettings, sameClientSyncItem } from "../src/lib/sync-settings.ts";
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

test("upload exactly what sameClientSyncItem would upload against the server's copy", () => {
  const server = [shelf("book:a", "A"), shelf("book:b", "B")];
  const view = afterPull(null, "a@example.com", server, 100, true, NOW);
  const local = [
    shelf("book:a", "A", 99), // same content, newer time: sameClientSyncItem ignores the time
    shelf("book:b", "B changed"),
    shelf("book:c", "C"), // the server has never seen it
    { ...shelf("book:a", "A"), itemId: "book:d", deleted: true, data: {} },
  ];
  const old = local.filter((item) => {
    const prior = server.find((other) => other.kind === item.kind && other.itemId === item.itemId);
    return !prior || !sameClientSyncItem(prior, item);
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

test("a version 2 stored record is read only for its own account and when well formed", () => {
  const view = {
    version: 2,
    email: "a@example.com",
    cursor: 100,
    fullAt: NOW,
    sigs: { "shelf:book:a": signatureOf(shelf("book:a", "A")) },
  };
  assert.deepEqual(afterPull(null, view.email, [shelf("book:a", "A")], 100, true, NOW), view);
  const raw = JSON.stringify(view);
  assert.deepEqual(readView(raw, "a@example.com"), view);
  assert.equal(readView(raw, "b@example.com"), null);
  assert.equal(readView("{not json", "a@example.com"), null);
  assert.equal(readView(JSON.stringify({ ...view, cursor: "x" }), "a@example.com"), null);
  const pushed = afterPush(view, [shelf("book:a", "A2")]);
  assert.equal(pushed.version, 2);
  assert.deepEqual(readView(JSON.stringify(pushed), view.email), pushed);
});

test("old full-settings signature records are discarded to force one full pull", () => {
  const legacy = { email: "a@example.com", cursor: 100, fullAt: NOW, sigs: { "settings:main": "old-full-settings-signature" } };
  for (const value of [legacy, { ...legacy, version: 1 }, { ...legacy, version: "2" }]) {
    const view = readView(JSON.stringify(value), legacy.email);
    assert.equal(view, null);
    assert.equal(pullAfter(view, legacy.email, NOW), null);
  }
});

const history = {
  reviewLog: { "2026-10-01": { reviewed: 3, correct: 2 } },
  readDays: ["2026-10-01"],
};
const historyItem = (data = history, updatedAt = 10) => ({
  kind: "settings", itemId: "main", updatedAt, deleted: false, data,
});

test("client settings projection drops preferences but preserves normalized history", () => {
  const full = historyItem({ ...history, theme: "dark", locale: "zh", wordHints: "off", pronunciationAccent: "UK" });
  assert.deepEqual(historySettings(full.data), history);
  assert.deepEqual(historySettings(null), { reviewLog: {}, readDays: [] });
  assert.deepEqual(clientSyncItem(full), historyItem());
  assert.deepEqual(full.data.theme, "dark", "projection does not mutate the input");
  const book = shelf("book:a", "A");
  assert.deepEqual(clientSyncItem(book), book, "other item kinds retain their data");
  assert.equal(sameClientSyncItem(book, shelf("book:a", "A2")), false);
});

test("preference-only signatures stay equal while either history field changes the signature", () => {
  const local = historyItem();
  const view = afterPull(null, "a@example.com", [local], 100, true, NOW);
  for (const preference of [
    { theme: "dark" }, { font: "sans" }, { size: 28 }, { leading: 2.2 },
    { width: "wide" }, { column: 65 }, { focus: true }, { paging: true },
    { pronunciationAccent: "UK" }, { wordHints: "underline" }, { quietMarks: true },
    { locale: "zh" },
  ]) {
    const changed = historyItem({ ...history, ...preference }, 999);
    assert.equal(signatureOf(local), signatureOf(changed), JSON.stringify(preference));
    assert.equal(sameClientSyncItem(local, changed), true);
    assert.equal(needsUpload(view, changed), false);
  }
  for (const change of [
    { reviewLog: { "2026-10-01": { reviewed: 4, correct: 2 } } },
    { reviewLog: { "2026-10-01": { reviewed: 3, correct: 3 } } },
    { readDays: ["2026-10-01", "2026-10-02"] },
  ]) {
    const changed = historyItem({ ...history, ...change });
    assert.notEqual(signatureOf(local), signatureOf(changed));
    assert.equal(sameClientSyncItem(local, changed), false);
    assert.equal(needsUpload(view, changed), true);
  }
  const deleted = { ...local, deleted: true, data: {} };
  assert.notEqual(signatureOf(local), signatureOf(deleted));
  assert.equal(sameClientSyncItem(local, deleted), false);
});

test("full server normalization of history-only settings converges after pulls and pushes", () => {
  const local = historyItem();
  const normalized = normalizeItem(local);
  assert.ok(normalized);
  assert.equal(normalized.data.theme, "light", "the shared server schema still adds preferences");
  const legacyFull = normalizeItem(historyItem({
    ...history, theme: "dark", font: "sans", locale: "zh", wordHints: "off", pronunciationAccent: "UK",
  }, 999));
  assert.ok(legacyFull);
  for (const server of [normalized, legacyFull]) {
    assert.deepEqual(clientSyncItem(server).data, history);
    assert.equal(sameClientSyncItem(local, server), true);
    assert.equal(signatureOf(local), signatureOf(server));
    const pulled = afterPull(null, "a@example.com", [server], 100, true, NOW);
    assert.equal(needsUpload(pulled, local), false);
    const unknown = afterPull(null, "a@example.com", [], 100, true, NOW);
    assert.equal(needsUpload(unknown, local), true);
    const pushed = afterPush(unknown, [server]);
    assert.equal(needsUpload(pushed, local), false, "server-added preferences cannot create a re-upload loop");
  }
});

test("the engine pulls with the cursor, decides uploads from the record, and forgets it on sign-out", () => {
  const engine = readFileSync(new URL("../src/lib/sync-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /accountRequest\(after === null \? "\/api\/sync" : `\/api\/sync\?after=\$\{after\}`\)/);
  assert.match(engine, /if \(view && !pulled\.full\) return needsUpload\(view, item\);/);
  assert.match(engine, /if \(!email\) writeStorage\(SYNC_VIEW_KEY, null\);/);
  assert.match(engine, /Date\.now\(\) - lastRun < FOCUS_PULL_MS && !dirty/);
});
