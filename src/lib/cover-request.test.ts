import assert from "node:assert/strict";
import { test } from "node:test";
import { coverCrossOrigin, fetchCover } from "./cover-request.ts";

test("cover images ask for a CORS response on network urls", () => {
  assert.equal(
    coverCrossOrigin("https://books.inputread.site/public-books/alice/cover.jpg"),
    "anonymous",
  );
  assert.equal(coverCrossOrigin("./word-lists/charlie/cover.jpg"), "anonymous");
  assert.equal(coverCrossOrigin("data:image/jpeg;base64,abc"), undefined);
  assert.equal(coverCrossOrigin("blob:http://localhost/x"), undefined);
  assert.equal(coverCrossOrigin(undefined), undefined);
});

test("cover fetch skips the HTTP cache", async () => {
  const calls: RequestInit[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(new Uint8Array([1]), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await fetchCover("https://books.inputread.site/word-lists/wof1/cover.jpg");
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cache, "no-store");
  } finally {
    globalThis.fetch = original;
  }
});
