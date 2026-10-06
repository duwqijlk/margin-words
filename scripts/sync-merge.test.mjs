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

/* ---- global wordbook ---------------------------------------------------- */

import {
  asProgress,
  asWordbookBlob,
  foldLegacyWords,
  mergeSourceRecords,
  sourceKey,
  wordbookItemId,
} from "../src/lib/sync-merge.ts";
import { captureSnapshot, loadMeta } from "../src/lib/sync-diff.ts";

const BOOK_A = bookSyncKey({ id: "a", title: "Alice", author: "Lewis Carroll" });
const BOOK_P = bookSyncKey({ id: "p", title: "Peter Pan", author: "J. M. Barrie" });

const rec = (lemma, sources, extra = {}) => ({
  id: `id-${lemma}`,
  surface: lemma,
  lemma,
  pos: "adjective",
  meaning: "m",
  whyHard: "",
  recommend: true,
  sentence: "s",
  stage: 0,
  dueAt: 10,
  createdAt: 10,
  reps: 0,
  lapses: 0,
  updatedAt: 100,
  sources,
  ...extra,
});
const live = (book, sentence, savedAt = 50) => ({
  k: `${book}#${sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 48)}`,
  book,
  title: book === BOOK_A ? "Alice" : "Peter Pan",
  author: "x",
  sentence,
  surface: "faint",
  savedAt,
});
const shard = (lemma, words, removed = [], updatedAt = 100) => ({
  kind: "wordbook",
  itemId: wordbookItemId(lemma[0]),
  updatedAt,
  deleted: false,
  data: { words, removed },
});

test("two devices that saved the same word in different books end with one card and both sources", () => {
  const onPhone = shard("faint", [rec("faint", [live(BOOK_A, "A faint light on the water.")])]);
  const onLaptop = shard("faint", [rec("faint", [live(BOOK_P, "The faint sound of a bell.")], { updatedAt: 120 })], [], 120);
  const merged = mergeSnapshots([onPhone], [onLaptop]);
  assert.equal(merged.length, 1);
  const blob = asWordbookBlob(merged[0].data);
  assert.equal(blob.words.length, 1);
  assert.equal(blob.words[0].sources.filter((s) => !("removed" in s)).length, 2);
  assert.equal(blob.words[0].updatedAt, 120);
});

test("the review state of the newer card wins and is not lost to an older copy", () => {
  const older = rec("faint", [live(BOOK_A, "A faint light on the water.")], { stage: 1, reps: 1, updatedAt: 100 });
  const newer = rec("faint", [live(BOOK_A, "A faint light on the water.")], { stage: 3, reps: 3, updatedAt: 200 });
  const merged = asWordbookBlob(mergeSnapshots([shard("faint", [newer], [], 200)], [shard("faint", [older])])[0].data);
  assert.equal(merged.words[0].stage, 3);
  assert.equal(merged.words[0].reps, 3);
});

test("a removed source stays removed against an older copy that still has it", () => {
  const k = live(BOOK_A, "A faint light on the water.").k;
  const kept = rec("faint", [live(BOOK_A, "A faint light on the water.", 50), live(BOOK_P, "The faint sound of a bell.", 60)]);
  const removed = rec("faint", [{ k, removed: 500 }, live(BOOK_P, "The faint sound of a bell.", 60)], { updatedAt: 500 });
  for (const [a, b] of [[kept, removed], [removed, kept]]) {
    const blob = asWordbookBlob(mergeSnapshots([shard("faint", [a])], [shard("faint", [b])])[0].data);
    const liveOnes = blob.words[0].sources.filter((s) => !("removed" in s));
    assert.deepEqual(liveOnes.map((s) => s.book), [BOOK_P]);
  }
  assert.equal(mergeSourceRecords([live(BOOK_A, "x y z", 900)], [{ k: live(BOOK_A, "x y z").k, removed: 500 }]).filter((s) => !("removed" in s)).length, 1);
});

test("a pointer without a sentence does not erase the paragraph saved on the other copy", () => {
  const ref = { list: "alice", chapter: 1, occurrence: 2, mark: "0123abcd", form: "faint" };
  const paragraph = "A faint light on the water.";
  const k = sourceKey({ book: BOOK_A, ref, surface: "faint" });
  const withSentence = {
    k,
    book: BOOK_A,
    title: "Alice",
    author: "Lewis Carroll",
    chapterTitle: "Down the Rabbit-Hole",
    sentence: paragraph,
    surface: "faint",
    savedAt: 50,
    ref,
  };
  const pointer = { k, book: BOOK_A, surface: "faint", savedAt: 50, ref };
  const newer = { ...pointer, savedAt: 80 };
  for (const [a, b] of [
    [withSentence, pointer],
    [pointer, withSentence],
    [withSentence, newer],
    [newer, withSentence],
  ]) {
    const kept = mergeSourceRecords([a], [b]).find((s) => !("removed" in s));
    assert.equal(kept.sentence, paragraph);
    assert.equal(kept.title, "Alice");
    assert.equal(kept.chapterTitle, "Down the Rabbit-Hole");
    assert.equal(kept.ref.list, "alice");
  }
  const gone = mergeSourceRecords([withSentence], [{ k, removed: 90 }]);
  assert.equal(gone.filter((s) => !("removed" in s)).length, 0);
});

test("a word removed on one device is removed on the other, unless it was saved again later", () => {
  const word = rec("faint", [live(BOOK_A, "A faint light on the water.")], { updatedAt: 100 });
  const gone = shard("faint", [], [{ lemma: "faint", updatedAt: 300 }], 300);
  assert.equal(asWordbookBlob(mergeSnapshots([shard("faint", [word])], [gone])[0].data).words.length, 0);
  const again = rec("faint", [live(BOOK_A, "A faint light on the water.", 400)], { updatedAt: 400 });
  assert.equal(asWordbookBlob(mergeSnapshots([gone], [shard("faint", [again], [], 400)])[0].data).words.length, 1);
});

test("per-book word lists of an older app fold into the global wordbook", () => {
  const legacy = (book, lemma, sentence) => ({
    kind: "words",
    itemId: book,
    updatedAt: 100,
    deleted: false,
    data: { words: [{ ...rec(lemma, []), sentence, surface: lemma }], removed: [] },
  });
  const items = [
    shelf("Alice", "x", 5),
    legacy(BOOK_A, "faint", "A faint light."),
    legacy(BOOK_P, "faint", "A faint bell."),
    legacy(BOOK_P, "glimmer", "A glimmer."),
  ];
  const folded = foldLegacyWords(items);
  assert.equal(folded.some((item) => item.kind === "words"), false);
  const f = asWordbookBlob(folded.find((item) => item.itemId === "w-f").data);
  assert.equal(f.words.length, 1);
  assert.deepEqual(f.words[0].sources.map((s) => s.book).sort(), [BOOK_A, BOOK_P].sort());
  assert.equal(asWordbookBlob(folded.find((item) => item.itemId === "w-g").data).words.length, 1);
  assert.equal(folded.some((item) => item.kind === "shelf"), true);
});

test("folding keeps a newer review state that is already in the wordbook shard", () => {
  const legacy = {
    kind: "words", itemId: BOOK_A, updatedAt: 100, deleted: false,
    data: { words: [{ ...rec("faint", []), stage: 1, updatedAt: 100 }], removed: [] },
  };
  const current = shard("faint", [rec("faint", [live(BOOK_A, "A faint light.")], { stage: 4, reps: 4, updatedAt: 900 })], [], 900);
  const folded = foldLegacyWords([legacy, current]);
  const blob = asWordbookBlob(folded.find((item) => item.itemId === "w-f").data);
  assert.equal(blob.words[0].stage, 4);
});

test("an older app that still sends per-book words is accepted by the server, and ids are checked", () => {
  assert.ok(normalizeItem({ kind: "words", itemId: BOOK_A, updatedAt: 1, data: { words: [], removed: [] } }));
  assert.ok(normalizeItem({ kind: "wordbook", itemId: "w-a", updatedAt: 1, data: { words: [], removed: [] } }));
  assert.ok(normalizeItem({ kind: "wordbook", itemId: "w-0", updatedAt: 1, data: { words: [], removed: [] } }));
  assert.equal(normalizeItem({ kind: "wordbook", itemId: "w-ab", updatedAt: 1, data: {} }), null);
  assert.equal(normalizeItem({ kind: "wordbook", itemId: "main", updatedAt: 1, data: {} }), null);
});

test("this device sends the wordbook in letter shards, and a deleted book does not delete its words", () => {
  const books = [{ id: "a1", title: "Alice", author: "x", cloth: "cloth", createdAt: 1, updatedAt: 1 }];
  const words = [
    { ...rec("faint", [live(BOOK_A, "A faint light.")]), sources: [{ ...live(BOOK_A, "A faint light."), k: undefined }] },
    rec("glimmer", [live(BOOK_A, "A glimmer here.")]),
  ];
  const withBook = captureSnapshot({ books, words, progress: {}, settings: {} });
  const items = buildSyncItems(withBook, emptyMeta());
  assert.deepEqual(items.filter((item) => item.kind === "wordbook").map((item) => item.itemId), ["w-f", "w-g"]);
  const sent = asWordbookBlob(items.find((item) => item.itemId === "w-f").data).words[0];
  assert.ok(sent.sources[0].k.startsWith(`${BOOK_A}#a faint light`));

  const noBook = captureSnapshot({ books: [], words, progress: {}, settings: {} });
  const meta = noteChanges(emptyMeta(), withBook, noBook, 777);
  assert.deepEqual(meta.wordRemoved, {});
  assert.equal(meta.shelfDeleted[Object.keys(meta.shelfDeleted)[0]], 777);
  const after = buildSyncItems(noBook, meta);
  assert.equal(after.filter((item) => item.kind === "wordbook").length, 2);
});

test("taking one source away is recorded so another device cannot bring it back", () => {
  const two = captureSnapshot({
    books: [],
    words: [rec("faint", [live(BOOK_A, "A faint light."), live(BOOK_P, "A faint bell.")])],
    progress: {},
    settings: {},
  });
  const one = captureSnapshot({
    books: [],
    words: [rec("faint", [live(BOOK_P, "A faint bell.")])],
    progress: {},
    settings: {},
  });
  const meta = noteChanges(emptyMeta(), two, one, 888);
  const stubs = Object.entries(meta.sourceRemoved.faint ?? {});
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0][1], 888);
  const sent = asWordbookBlob(buildSyncItems(one, meta).find((item) => item.itemId === "w-f").data).words[0];
  assert.equal(sent.sources.filter((s) => "removed" in s).length, 1);
});

test("removing a whole word is a tombstone by lemma, whatever book it came from", () => {
  const before = captureSnapshot({ books: [], words: [rec("faint", [live(BOOK_A, "A faint light.")])], progress: {}, settings: {} });
  const after = captureSnapshot({ books: [], words: [], progress: {}, settings: {} });
  const meta = noteChanges(emptyMeta(), before, after, 999);
  assert.equal(meta.wordRemoved.faint, 999);
  const sent = asWordbookBlob(buildSyncItems(after, meta).find((item) => item.itemId === "w-f").data);
  assert.deepEqual(sent.removed, [{ lemma: "faint", updatedAt: 999 }]);
});

test("sync meta written by the per-book version loads as one list by lemma", () => {
  const meta = loadMeta(JSON.stringify({
    shelfDeleted: {}, progressDeleted: {}, shelfTouched: {},
    wordTouched: { [BOOK_A]: { faint: 5, glimmer: 7 }, [BOOK_P]: { faint: 9 } },
    wordRemoved: { [BOOK_A]: { lost: 4 } },
    wordsDeleted: { [BOOK_P]: 3 },
    settingsUpdatedAt: 2,
  }));
  assert.deepEqual(meta.wordTouched, { faint: 9, glimmer: 7 });
  assert.deepEqual(meta.wordRemoved, { lost: 4 });
});

test("reading progress keeps the file-independent anchor and the old chapter and scroll hint", () => {
  const progress = asProgress({
    chapter: 3, chapters: 12, scroll: 0.4, updatedAt: 5,
    anchor: { chapter: 3, paragraph: 14, quote: "the rain fell on the old harbour town", offset: 3 },
  });
  assert.equal(progress.chapter, 3);
  assert.equal(progress.scroll, 0.4);
  assert.equal(progress.anchor.paragraph, 14);
  const old = asProgress({ chapter: 1, chapters: 2, scroll: 0.1, updatedAt: 1 });
  assert.equal(old.anchor, undefined);
  const bad = asProgress({ chapter: 1, chapters: 2, scroll: 0.1, updatedAt: 1, anchor: { quote: 5 } });
  assert.equal(bad.anchor, undefined);
  const item = normalizeItem({ kind: "progress", itemId: "b", updatedAt: 1, data: { chapter: 1, chapters: 2, scroll: 0.1, updatedAt: 1, anchor: progress.anchor } });
  assert.equal(item.data.anchor.paragraph, 14);
});

test("progress load and merge keep extraId and anchor, either field, or neither", () => {
  const anchor = { chapter: 1, paragraph: 2, quote: "the brass lantern hung above the stair", offset: 4 };
  const both = asProgress({ chapter: 1, chapters: 8, scroll: 0.2, updatedAt: 5, extraId: "x2", anchor });
  assert.equal(both.extraId, "x2");
  assert.equal(both.anchor.paragraph, 2);

  const onlyExtra = asProgress({ chapter: 3, chapters: 8, scroll: 0, updatedAt: 1, extraId: "x3" });
  assert.equal(onlyExtra.extraId, "x3");
  assert.equal(onlyExtra.anchor, undefined);

  const onlyAnchor = asProgress({ chapter: 3, chapters: 8, scroll: 0.5, updatedAt: 2, anchor });
  assert.equal(onlyAnchor.anchor.chapter, 1);
  assert.equal(onlyAnchor.extraId, undefined);

  const neither = asProgress({ chapter: 0, chapters: 4, scroll: 0.1, updatedAt: 1 });
  assert.equal(neither.extraId, undefined);
  assert.equal(neither.anchor, undefined);

  const cleared = asProgress({ chapter: 4, chapters: 8, scroll: 0, updatedAt: 9, extraId: "", anchor });
  assert.equal(cleared.extraId, "");
  assert.equal(cleared.anchor.paragraph, 2);

  const row = (updatedAt, data) => ({ kind: "progress", itemId: "book-1", updatedAt, deleted: false, data });
  const kept = mergeItem(row(1, { chapter: 0, chapters: 4, scroll: 0, updatedAt: 1, anchor }), row(5, both));
  assert.equal(kept.data.extraId, "x2");
  assert.equal(kept.data.anchor.paragraph, 2);

  const filledAnchor = mergeItem(
    row(1, { chapter: 0, chapters: 4, scroll: 0, updatedAt: 1, anchor }),
    row(5, { chapter: 2, chapters: 8, scroll: 0.3, updatedAt: 5, extraId: "x2" }),
  );
  assert.equal(filledAnchor.data.extraId, "x2");
  assert.equal(filledAnchor.data.anchor.paragraph, 2, "a newer save that never stored an anchor keeps the older one");

  const filledExtra = mergeItem(
    row(1, { chapter: 1, chapters: 8, scroll: 0, updatedAt: 1, extraId: "x3" }),
    row(6, { chapter: 4, chapters: 8, scroll: 0.2, updatedAt: 6, anchor }),
  );
  assert.equal(filledExtra.data.extraId, "x3");
  assert.equal(filledExtra.data.anchor.paragraph, 2);

  const left = mergeItem(
    row(1, { chapter: 1, chapters: 8, scroll: 0, updatedAt: 1, extraId: "x2" }),
    row(9, { chapter: 4, chapters: 8, scroll: 0.2, updatedAt: 9, extraId: "", anchor }),
  );
  assert.equal(left.data.extraId, "", "an explicit empty extraId is not replaced by an older extra");
  assert.equal(left.data.anchor.paragraph, 2);
});
