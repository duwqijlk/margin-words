// Merge rules for optional account sync: union, last-write-wins, word tombstones.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSyncItems, emptyMeta, noteChanges } from "../src/lib/sync-diff.ts";
import {
  bookSyncKey,
  mergeItem,
  mergeSnapshots,
  mergeWordBlobs,
  normalizeItem,
} from "../src/lib/sync-merge.ts";

const shelf = (title, author, updatedAt, extra = {}) => ({
  kind: "shelf",
  itemId: bookSyncKey({ id: "x", title, author }),
  updatedAt,
  deleted: false,
  data: {
    id: extra.id ?? "local-id",
    title,
    author,
    cloth: "cloth",
    createdAt: 1,
    updatedAt,
    ...extra,
  },
});

test("the same book on two devices shares a key, whatever the card id is", () => {
  const a = bookSyncKey({ id: "device-a", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll" });
  const b = bookSyncKey({
    id: "device-b",
    title: "Alice's Adventures in Wonderland (Alice #1)",
    author: "Carroll, Lewis",
  });
  assert.equal(a, b);
  assert.match(a, /^book:/);
});

test("a newer shelf card wins and an older one does not wipe it", () => {
  const local = shelf("Treasure Island", "Stevenson", 200, { id: "a", lexile: "1100L" });
  const remote = shelf("Treasure Island", "Stevenson", 100, { id: "b", lexile: "900L" });
  const merged = mergeItem(remote, local);
  assert.equal(merged.updatedAt, 200);
  assert.equal(merged.data.lexile, "1100L");
  const otherWay = mergeItem(local, remote);
  assert.equal(otherWay.data.lexile, "1100L");
});

test("a newer delete beats an older card, and an older delete does not", () => {
  const card = shelf("Kidnapped", "Stevenson", 50);
  const removed = { ...card, updatedAt: 80, deleted: true, data: {} };
  assert.equal(mergeItem(card, removed).deleted, true);
  assert.equal(mergeItem(removed, { ...card, updatedAt: 90 }).deleted, false);
  assert.equal(mergeItem({ ...card, updatedAt: 100 }, removed).deleted, false);
});

test("books that exist on only one side are both kept", () => {
  const merged = mergeSnapshots(
    [shelf("Alice's Adventures in Wonderland", "Carroll", 10)],
    [shelf("Treasure Island", "Stevenson", 20)],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.filter((item) => item.deleted).length, 0);
});

test("word books union by lemma and a later tombstone removes only that word", () => {
  const base = {
    words: [
      word("wander", 10),
      word("shore", 10),
    ],
    removed: [],
  };
  const preferred = {
    words: [word("lantern", 12), { ...word("shore", 8), meaning: "old meaning" }],
    removed: [{ lemma: "wander", updatedAt: 15 }],
  };
  const blob = mergeWordBlobs(base, preferred);
  const lemmas = blob.words.map((item) => item.lemma).sort();
  assert.deepEqual(lemmas, ["lantern", "shore"]);
  assert.equal(blob.words.find((item) => item.lemma === "shore").meaning, "the edge of the sea");
  assert.equal(blob.removed.length, 1);
  assert.equal(blob.removed[0].lemma, "wander");
});

test("a newer edit of the same word wins over an older tombstone", () => {
  const blob = mergeWordBlobs(
    { words: [], removed: [{ lemma: "shore", updatedAt: 5 }] },
    { words: [word("shore", 9)], removed: [] },
  );
  assert.equal(blob.words.length, 1);
  assert.equal(blob.removed.length, 0);
});

test("settings keep the newer preferences and the higher review counts", () => {
  const local = {
    kind: "settings",
    itemId: "main",
    updatedAt: 20,
    deleted: false,
    data: settings({ theme: "dark", reviewLog: { "2026-10-01": { reviewed: 3, correct: 2 } } }),
  };
  const remote = {
    kind: "settings",
    itemId: "main",
    updatedAt: 10,
    deleted: false,
    data: settings({ theme: "sepia", reviewLog: { "2026-10-01": { reviewed: 4, correct: 1 }, "2026-10-02": { reviewed: 1, correct: 1 } } }),
  };
  const merged = mergeItem(remote, local);
  assert.equal(merged.data.theme, "dark");
  assert.equal(merged.data.reviewLog["2026-10-01"].reviewed, 4);
  assert.equal(merged.data.reviewLog["2026-10-01"].correct, 2);
  assert.equal(merged.data.reviewLog["2026-10-02"].reviewed, 1);
});

test("a bad sync payload is rejected", () => {
  assert.equal(normalizeItem({ kind: "shelf", itemId: "nope", updatedAt: 1, data: {} }), null);
  assert.equal(normalizeItem({ kind: "other", itemId: "book:a|b", updatedAt: 1, data: {} }), null);
  const ok = normalizeItem({
    kind: "progress",
    itemId: "book:treasureisland|stevenson",
    updatedAt: 5,
    deleted: false,
    data: { chapter: 2, chapters: 10, scroll: 0.5, updatedAt: 5 },
  });
  assert.equal(ok.kind, "progress");
  assert.equal(ok.data.chapter, 2);
});

test("deleting a book records a tombstone, and a second card of the same book does not", () => {
  const book = {
    id: "1",
    title: "Treasure Island",
    author: "Stevenson",
    cloth: "ink",
    createdAt: 1,
    updatedAt: 1,
  };
  const base = { books: [book], words: [], progress: {}, settings: settings() };
  const gone = noteChanges(emptyMeta(), base, { ...base, books: [] }, 50);
  const key = bookSyncKey(book);
  assert.equal(gone.shelfDeleted[key], 50);
  const twin = noteChanges(
    emptyMeta(),
    base,
    { ...base, books: [{ ...book, id: "2" }] },
    50,
  );
  assert.equal(twin.shelfDeleted[key], undefined);
  const items = buildSyncItems({ ...base, books: [] }, gone);
  assert.equal(items.find((item) => item.kind === "shelf").deleted, true);
});

test("two devices adding different words do not drop either word in the snapshot merge", () => {
  const key = bookSyncKey({ id: "1", title: "Treasure Island", author: "Stevenson" });
  const left = {
    kind: "words",
    itemId: key,
    updatedAt: 10,
    deleted: false,
    data: { words: [word("shore", 10)], removed: [] },
  };
  const right = {
    kind: "words",
    itemId: key,
    updatedAt: 11,
    deleted: false,
    data: { words: [word("map", 11)], removed: [] },
  };
  const merged = mergeSnapshots([left], [right]);
  const lemmas = merged[0].data.words.map((item) => item.lemma).sort();
  assert.deepEqual(lemmas, ["map", "shore"]);
});

function word(lemma, updatedAt, meaning = "the edge of the sea") {
  return {
    id: `id-${lemma}`,
    surface: lemma,
    lemma,
    pos: "noun",
    meaning,
    whyHard: "",
    recommend: false,
    sentence: `A ${lemma} was there.`,
    stage: 0,
    dueAt: updatedAt,
    createdAt: updatedAt,
    reps: 0,
    lapses: 0,
    updatedAt,
  };
}

function settings(extra = {}) {
  return {
    theme: "light",
    font: "literata",
    size: 20,
    leading: 1.8,
    width: "medium",
    column: 39,
    focus: false,
    locale: "en",
    reviewLog: {},
    ...extra,
  };
}
