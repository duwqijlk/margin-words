import assert from "node:assert/strict";
import { test } from "node:test";
import { createIpaLookup } from "../src/lib/local-ipa.ts";

const entry = (ipa, us = ipa) => ({ UK: ipa ? [{ ipa }] : [], US: us ? [{ ipa: us }] : [] });
const shard = (words, version = "fixture") => ({ schemaVersion: 1, version, words });

test("IPA lookup is exact before controlled initial-capital fallback", async () => {
  const lookup = createIpaLookup(async () => ({ version: "fixture", loaders: {
    b: async () => shard({ bow: entry("baʊ"), Bow: entry("bəʊ"), bath: entry("bɑːθ", "bæθ") }),
    w: async () => shard({ water: entry("ˈwɔːtə(r)"), Water: entry("w", "") }),
  } }));
  assert.equal((await lookup("bow")).entry.UK[0].ipa, "baʊ");
  assert.equal((await lookup("Bow")).entry.UK[0].ipa, "bəʊ");
  assert.equal((await lookup("Bath")).match, "lowercase-fallback");
  assert.deepEqual((await lookup("Water")).entry.US, []);
  for (const word of ["BOW", "bOw", "baths", "bath time", "__proto__", "", "constructor"]) assert.equal(await lookup(word), null, word);
});

test("IPA shares a shard in flight and after success", async () => {
  let loads = 0, manifests = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const lookup = createIpaLookup(async () => { manifests++; return { version: "fixture", loaders: {
    b: async () => { loads++; await gate; return shard({ book: entry("bʊk"), bath: entry("bɑːθ", "bæθ") }); },
  } }; });
  const first = lookup("book"), second = lookup("bath");
  release(); await Promise.all([first, second]); await lookup("Book");
  assert.equal(manifests, 1); assert.equal(loads, 1);
});

test("IPA rejects damaged data and can retry the application loader", async () => {
  let calls = 0;
  const lookup = createIpaLookup(async () => ({ version: "fixture", loaders: {
    b: async () => ++calls === 1 ? shard({ book: entry("bʊk") }, "wrong") : shard({ book: entry("bʊk") }),
  } }));
  await assert.rejects(lookup("book"), /version/);
  assert.equal((await lookup("book")).entry.US[0].ipa, "bʊk");
  for (const bad of [null, [], { schemaVersion: 1, version: "fixture", words: { book: entry("<script>") } }, shard({ bath: { UK: [], US: [] } }), shard({ bath: { UK: "bad", US: [] } })]) {
    const damaged = createIpaLookup(async () => ({ version: "fixture", loaders: { b: async () => bad } }));
    await assert.rejects(damaged("book"));
  }
});

test("IPA manifest failures retry and default empty data does not fetch", async () => {
  let attempts = 0;
  const lookup = createIpaLookup(async () => { if (++attempts === 1) throw Error("network"); return { version: "", loaders: {} }; });
  await assert.rejects(lookup("book"), /network/);
  assert.equal(await lookup("book"), null);
  assert.equal(attempts, 2);
});

test("a word whose shard is in memory answers at once, so the card draws it on its first frame", async () => {
  const lookup = createIpaLookup(async () => ({ version: "fixture", loaders: {
    b: async () => shard({ book: entry("bʊk") }),
  } }));
  assert.equal(lookup.now("book"), undefined, "nothing is known before the shard arrives");
  await lookup("book");
  assert.equal(lookup.now("book").entry.UK[0].ipa, "bʊk");
  assert.equal(lookup.now("Book").match, "lowercase-fallback");
  assert.equal(lookup.now("bath"), null, "a word the shard does not have is known to be missing");
  assert.equal(lookup.now("not a word"), null);
});

test("warming fetches each needed shard once, ahead of the tap, and a failure stays quiet", async () => {
  const loads = { b: 0, w: 0 };
  let failW = true;
  const lookup = createIpaLookup(async () => ({ version: "fixture", loaders: {
    b: async () => { loads.b++; return shard({ book: entry("bʊk") }); },
    w: async () => { loads.w++; if (failW) throw Error("network"); return shard({ water: entry("ˈwɔːtə") }); },
  } }));
  lookup.warm(["b", "w", "b", "z", "?"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lookup.now("book").entry.UK[0].ipa, "bʊk", "warmed before any lookup");
  assert.equal(loads.b, 1);
  lookup.warm(["b"]);
  await lookup("book");
  assert.equal(loads.b, 1, "a warmed shard is not fetched again");
  // the failed warm left no broken entry: a later lookup fetches again and succeeds
  failW = false;
  assert.equal((await lookup("water")).entry.UK[0].ipa, "ˈwɔːtə");
  assert.equal(loads.w, 2);
});
