// The reader's own record: the "finished" mark on a shelf book and the reading days
// (src/lib/reading-stats.ts), and how both survive account sync (src/lib/sync-merge.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addReadDay,
  asFinishedAt,
  asReadDays,
  matchesFinished,
  mergeReadDays,
  READ_DAYS_MAX,
  readingOverview,
} from "../src/lib/reading-stats.ts";
import { asSettings, asShelf, mergeItem, normalizeItem } from "../src/lib/sync-merge.ts";

const book = (id, extra = {}) => ({ id, title: `Book ${id}`, author: "A", cloth: "cloth", createdAt: 1, updatedAt: 1, ...extra });
const word = (lemma, stage = 0) => ({ id: lemma, lemma, stage });

test("reading days are valid local dates, sorted, without repeats, and capped at the newest", () => {
  assert.deepEqual(asReadDays(["2026-10-29", "2026-10-28", "2026-10-29", "29/10/2026", 5, null]), ["2026-10-28", "2026-10-29"]);
  assert.deepEqual(asReadDays("2026-10-29"), []);
  const many = Array.from({ length: READ_DAYS_MAX + 10 }, (_, i) => new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10));
  const kept = asReadDays(many);
  assert.equal(kept.length, READ_DAYS_MAX);
  assert.equal(kept.at(-1), many.at(-1), "the newest days stay");
});

test("adding a day that is already there returns the same array, so the store does not change", () => {
  const days = ["2026-10-28"];
  assert.equal(addReadDay(days, "2026-10-28"), days);
  assert.deepEqual(addReadDay(days, "2026-10-29"), ["2026-10-28", "2026-10-29"]);
  assert.equal(addReadDay(days, "not a day"), days);
});

test("the overview counts finished books (latest first), reading days, saved and mastered words", () => {
  const books = [book("a", { finishedAt: 100 }), book("b"), book("c", { finishedAt: 300 }), book("d", { finishedAt: -1 })];
  const overview = readingOverview(books, [word("x", 7), word("y", 2), word("z", 7)], ["2026-10-28", "2026-10-29"]);
  assert.deepEqual(overview.finished.map((item) => item.id), ["c", "a"]);
  assert.equal(overview.readDays, 2);
  assert.equal(overview.words, 3);
  assert.equal(overview.mastered, 2);
});

test("the shelf filter splits finished and unfinished books", () => {
  assert.equal(matchesFinished({ finishedAt: 5 }, "finished"), true);
  assert.equal(matchesFinished({}, "finished"), false);
  assert.equal(matchesFinished({}, "unfinished"), true);
  assert.equal(matchesFinished({ finishedAt: 5 }, "all"), true);
  assert.equal(asFinishedAt(0), undefined);
  assert.equal(asFinishedAt(12.7), 12);
});

test("the finished mark travels with the shelf card through sync and a bad value is dropped", () => {
  assert.equal(asShelf(book("a", { finishedAt: 1_800_000_000_000 })).finishedAt, 1_800_000_000_000);
  assert.equal("finishedAt" in asShelf(book("a", { finishedAt: "yes" })), false);
  assert.equal("finishedAt" in asShelf(book("a")), false);
  const item = normalizeItem({ kind: "shelf", itemId: "book:a", updatedAt: 10, deleted: false, data: book("a", { finishedAt: 42 }) }, 1_000);
  assert.equal(item.data.finishedAt, 42, "the server keeps it");
});

test("reading days merge as a union, also against a device that does not know them", () => {
  const settings = (readDays, updatedAt) => ({
    kind: "settings",
    itemId: "main",
    updatedAt,
    deleted: false,
    data: { ...asSettings({}), ...(readDays ? { readDays } : {}), reviewLog: {} },
  });
  const merged = mergeItem(settings(["2026-10-01", "2026-10-03"], 5), settings(["2026-10-02"], 9));
  assert.deepEqual(merged.data.readDays, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  const older = settings(null, 20);
  delete older.data.readDays;
  assert.deepEqual(mergeItem(settings(["2026-10-01"], 5), older).data.readDays, ["2026-10-01"], "an older device does not wipe them");
  assert.deepEqual(mergeReadDays(undefined, ["2026-10-02"]), ["2026-10-02"]);
});
