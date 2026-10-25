import test from "node:test";
import assert from "node:assert/strict";
import { assertWordListPublish, mergeWordListCatalog } from "./lib/publish-word-list.mjs";

const live = {
  format: 1,
  name: "Word lists",
  updated: "2026-10-04",
  lists: [
    {
      id: "charlie",
      title: "Charlie",
      words: 10,
      glossary: { url: "charlie/glossary.json", bytes: 4, sha256: "a".repeat(64) },
    },
    {
      id: "matilda",
      title: "Matilda",
      glossary: { url: "matilda/glossary.json", bytes: 4, sha256: "b".repeat(64) },
    },
  ],
};

const speech = {
  id: "spacex-allhands-2026",
  title: "SpaceX Company Talk",
  author: "Elon Musk",
  category: "speech",
  words: 158,
  paragraphs: 0,
  sentences: 7,
  phrases: 42,
  glossary: { url: "spacex-allhands-2026/glossary.json", bytes: 8, sha256: "c".repeat(64) },
};

test("publish adds one word list and keeps every live glossary hash", () => {
  const next = mergeWordListCatalog(live, speech, "2026-10-05");
  assert.equal(next.lists.length, 3);
  assert.equal(next.updated, "2026-10-05");
  assert.equal(next.lists[0].glossary.sha256, "a".repeat(64));
  assert.equal(next.lists[0].words, 10);
  assert.equal(next.lists[1].id, "matilda");
  assert.equal(next.lists[2].id, "spacex-allhands-2026");
  assert.equal(next.lists[2].category, "speech");
  assert.equal(live.lists.length, 2);
  assert.equal(live.updated, "2026-10-04");
});

test("publish replaces one list in place", () => {
  const again = mergeWordListCatalog(
    mergeWordListCatalog(live, speech, "2026-10-05"),
    { ...speech, words: 160, glossary: { ...speech.glossary, sha256: "d".repeat(64) } },
    "2026-10-05",
  );
  assert.equal(again.lists.length, 3);
  assert.equal(again.lists[2].words, 160);
  assert.equal(again.lists[0].glossary.sha256, "a".repeat(64));
  assert.equal(again.lists[1].glossary.sha256, "b".repeat(64));
});

test("publish refuses a catalog that drops a book or changes another hash", () => {
  assert.throws(
    () => assertWordListPublish(live, { lists: [live.lists[0], speech] }, speech.id),
    /refusing to drop matilda/,
  );
  const changed = {
    lists: [
      { ...live.lists[0], glossary: { ...live.lists[0].glossary, sha256: "e".repeat(64) } },
      live.lists[1],
      speech,
    ],
  };
  assert.throws(() => assertWordListPublish(live, changed, speech.id), /glossary hash of charlie/);
});

test("a new book gets added once, and a new list for it keeps that time", () => {
  const first = mergeWordListCatalog(live, speech, "2026-10-05T08:00:00.000Z");
  assert.equal(first.lists[2].added, "2026-10-05T08:00:00.000Z");
  assert.equal(first.lists[0].added, undefined);
  const again = mergeWordListCatalog(
    first,
    { ...speech, updated: "2026-10-12T08:00:00.000Z", glossary: { ...speech.glossary, sha256: "d".repeat(64) } },
    "2026-10-12T08:00:00.000Z",
  );
  assert.equal(again.lists[2].added, "2026-10-05T08:00:00.000Z");
  assert.equal(again.lists[2].updated, "2026-10-12T08:00:00.000Z");
});

test("replacing a glossary remembers when the previous file was uploaded", () => {
  const dated = {
    ...live,
    lists: live.lists.map((row, index) => (index === 0 ? { ...row, updated: "2026-10-01T00:00:00.000Z" } : row)),
  };
  const next = mergeWordListCatalog(
    dated,
    {
      ...dated.lists[0],
      updated: "2026-10-14T00:00:00.000Z",
      glossary: { ...dated.lists[0].glossary, sha256: "f".repeat(64) },
    },
    "2026-10-14T00:00:00.000Z",
  );
  assert.equal(next.lists[0].previousUpdated, "2026-10-01T00:00:00.000Z");
  assert.equal(next.lists[0].updated, "2026-10-14T00:00:00.000Z");
  assert.equal(next.lists[1].previousUpdated, undefined);
  const same = mergeWordListCatalog(
    next,
    { ...next.lists[0], updated: "2026-10-15T00:00:00.000Z" },
    "2026-10-15T00:00:00.000Z",
  );
  assert.equal(same.lists[0].previousUpdated, "2026-10-01T00:00:00.000Z");
});

test("a rebuilt list that would undo live changes is reported", async () => {
  const { liveListLosses } = await import("./lib/publish-word-list.mjs");
  const live = {
    glossary: {
      dive: { meaning: "To jump in head first.", credit: "aaaaaaaaaaaa" },
      lantern: { meaning: "A portable light." },
      odds: { meaning: "Chances.", senses: [{ meaning: "Chances." }, { meaning: "Against all odds.", credit: "bbbbbbbbbbbb" }] },
      huge: { meaning: "Very big." },
    },
    phrases: { "against all odds": { meaning: "Even though it seemed unlikely." } },
  };
  const rebuilt = {
    glossary: {
      lantern: { meaning: "A light you carry." },
      odds: { meaning: "Chances.", senses: [{ meaning: "Chances." }] },
      huge: { meaning: "Very big." },
    },
    phrases: {},
  };
  const losses = liveListLosses(live, rebuilt);
  assert.deepEqual(losses.dropped, ["dive"]);
  assert.deepEqual(losses.changed, ["lantern", "odds"]);
  assert.deepEqual(losses.credits, ["dive (aaaaaaaaaaaa)", "odds#2 (bbbbbbbbbbbb)"]);
  assert.deepEqual(losses.phrases, ["against all odds"]);

  // The same list, or one that only adds, loses nothing.
  assert.deepEqual(liveListLosses(live, live), { dropped: [], changed: [], credits: [], phrases: [] });
  const more = structuredClone(live);
  more.glossary.new = { meaning: "Added." };
  assert.deepEqual(liveListLosses(live, more), { dropped: [], changed: [], credits: [], phrases: [] });
});
