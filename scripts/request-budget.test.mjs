// Free-plan request budget: reading uploads at most once a minute, and a catalog is downloaded once
// per minute however many parts of the page ask for it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { forgetSharedFetches, SHARED_TEXT_MS, sharedJson, sharedText } from "../src/lib/shared-fetch.ts";
import { READING_DELAY_MS } from "../src/lib/sync-pace.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("callers within a minute share one catalog download, and each gets its own parsed copy", async () => {
  forgetSharedFetches();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ packs: [{ id: "a" }] }), { status: 200 });
  };
  const [a, b] = await Promise.all([sharedJson("https://books.example/c.json"), sharedJson("https://books.example/c.json")]);
  assert.equal(calls, 1);
  assert.notEqual(a, b, "fresh objects");
  a.packs.push({ id: "changed" });
  assert.equal((await sharedJson("https://books.example/c.json")).packs.length, 1);
  assert.equal(calls, 1);
  await sharedText("https://books.example/c.json", Date.now() + SHARED_TEXT_MS + 1);
  assert.equal(calls, 2, "a minute later it is downloaded again");
});

test("a failed download is not kept", async () => {
  forgetSharedFetches();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("", { status: 503 }) : new Response("{}", { status: 200 });
  };
  await assert.rejects(sharedJson("https://books.example/d.json"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(await sharedJson("https://books.example/d.json"), {});
  assert.equal(calls, 2);
});

test("the catalogs go through the shared download", () => {
  assert.match(read("src/lib/packs.ts"), /const json = await sharedJson\(resolveAgainst\(url, ""\)\);/);
  assert.match(read("src/lib/word-list-catalog.ts"), /json = await sharedJson\(url\);/);
});

test("an open book uploads its reading place at most once a minute, and at once on leaving", () => {
  assert.equal(READING_DELAY_MS, 60_000);
  const engine = read("src/lib/sync-engine.ts");
  assert.match(engine, /if \(delay === undefined && readingHolds > 0 && holds === 0\) \{\s*if \(timer\) return;\s*delay = READING_DELAY_MS;/);
  assert.match(engine, /if \(holds === 0 && timer\) schedulePush\(PUSH_DELAY_MS\);/);
  assert.match(read("src/components/reader.tsx"), /useEffect\(\(\) => holdSyncPushes\(\{ reading: true \}\), \[\]\);/);
});
