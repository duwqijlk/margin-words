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
