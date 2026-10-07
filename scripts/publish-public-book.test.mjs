import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicPublish, mergePublicCatalog } from "./lib/publish-public-book.mjs";

const live = {
  format: 1,
  name: "Margin Words book packs",
  updated: "2026-10-04",
  packs: [
    {
      id: "treasure-island",
      title: "Treasure Island",
      words: 1787,
      phrases: 40,
      rev: "b847b25487ee",
      epub: { url: "treasure-island/book.epub", bytes: 10, sha256: "a".repeat(64) },
      glossary: { url: "treasure-island/glossary.json", bytes: 20, sha256: "b".repeat(64) },
      zip: { url: "treasure-island.zip", bytes: 30, sha256: "c".repeat(64) },
    },
    {
      id: "anne",
      title: "Anne of Green Gables",
      words: 2440,
      epub: { url: "anne/book.epub", bytes: 11, sha256: "d".repeat(64) },
      glossary: { url: "anne/glossary.json", bytes: 21, sha256: "e".repeat(64) },
    },
  ],
};

const speech = {
  id: "back-to-school",
  title: "Back to School",
  category: "speech",
  words: 400,
  epub: { url: "back-to-school/book.epub", bytes: 12, sha256: "f".repeat(64) },
  glossary: { url: "back-to-school/glossary.json", bytes: 22, sha256: "1".repeat(64) },
  zip: { url: "back-to-school.zip", bytes: 40, sha256: "2".repeat(64) },
};

test("publishing one public book keeps every other file hash", () => {
  const next = mergePublicCatalog(live, speech, "2026-10-07T01:41:21.132Z");
  assert.equal(next.packs.length, 3);
  assert.equal(next.allPacks, undefined);
  assert.equal(next.packs[0].glossary.sha256, "b".repeat(64));
  assert.equal(next.packs[0].epub.sha256, "a".repeat(64));
  assert.equal(next.packs[0].words, 1787);
  assert.equal(next.packs[0].zip, null);
  assert.equal(next.packs[1].glossary.sha256, "e".repeat(64));
  assert.equal(next.packs[2].id, "back-to-school");
  assert.equal(next.packs[2].zip, null);
  assert.equal(live.packs[0].zip.sha256, "c".repeat(64));
});

test("publishing one book replaces that row only", () => {
  const again = mergePublicCatalog(
    live,
    {
      ...live.packs[0],
      words: 1818,
      glossary: { ...live.packs[0].glossary, sha256: "9".repeat(64) },
    },
    "2026-10-07",
  );
  assert.equal(again.packs.length, 2);
  assert.equal(again.packs[0].words, 1818);
  assert.equal(again.packs[0].glossary.sha256, "9".repeat(64));
  assert.equal(again.packs[1].glossary.sha256, "e".repeat(64));
  assert.equal(again.packs[1].epub.sha256, "d".repeat(64));
});

test("a rebuilt catalog that retargets another book is refused", () => {
  const rebuilt = {
    packs: [
      {
        ...live.packs[0],
        words: 1818,
        glossary: { ...live.packs[0].glossary, sha256: "9".repeat(64) },
      },
      live.packs[1],
      speech,
    ],
  };
  assert.throws(() => assertPublicPublish(live, rebuilt, "back-to-school"), /glossary hash of treasure-island/);
  assert.throws(
    () =>
      assertPublicPublish(
        live,
        {
          packs: [
            { ...live.packs[0], epub: { ...live.packs[0].epub, sha256: "8".repeat(64) } },
            live.packs[1],
            speech,
          ],
        },
        ["back-to-school"],
      ),
    /book file hash of treasure-island/,
  );
  assert.throws(() => assertPublicPublish(live, { packs: [live.packs[0], speech] }, "back-to-school"), /refusing to drop anne/);
});
