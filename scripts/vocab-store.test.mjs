import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// Load the real store with Node's type stripping and the app's alias resolution.
// Replace only IndexedDB IO so a no-op can assert that neither persistence path runs.
const writes = [];
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = {
  getItem: () => null,
  setItem: (...args) => writes.push(args),
  removeItem: () => {},
};
globalThis.__noteWrites = [];
register(`data:text/javascript,${encodeURIComponent(`
  const root = ${JSON.stringify(new URL("../src/", import.meta.url).href)};
  export function resolve(specifier, context, next) {
    if (specifier === "@/lib/book-db") {
      return { shortCircuit: true, url: "data:text/javascript,export async function saveNotes(words) { globalThis.__noteWrites.push(words); }" };
    }
    if (specifier.startsWith("@/")) return next(new URL(specifier.slice(2) + ".ts", root).href, context);
    return next(specifier, context);
  }
`)}`, import.meta.url);
const { useVocab, markVocabHydrated } = await import("../src/lib/vocab-store.ts");
const { bookSyncKey } = await import("../src/lib/sync-merge.ts");
markVocabHydrated();
const home = { id: "reader-test", title: "A lantern", author: "Test" };
const placeholder = "The meaning is still being prepared.";
const word = (meaning = placeholder) => ({
  id: "lantern", lemma: "lantern", pos: "noun", meaning, whyHard: "",
  sources: [{ book: bookSyncKey(home) }],
});
function reset(words) {
  useVocab.setState({ books: [home], words });
  writes.length = 0;
  globalThis.__noteWrites.length = 0;
}

test("opening with no prepared meanings preserves identity and performs no persistence", () => {
  for (const words of [[], [word("A portable light.")], [word()]]) {
    reset(words);
    const before = useVocab.getState();
    useVocab.getState().fillPrepared(home.id, {});
    assert.equal(useVocab.getState(), before);
    assert.equal(writes.length, 0);
    assert.equal(globalThis.__noteWrites.length, 0);
  }
});

test("prepared meanings update only matching placeholders and persist once", () => {
  const ready = word("Already ready.");
  reset([word(), ready]);
  useVocab.getState().fillPrepared(home.id, {
    lantern: { pos: "noun", meaning: "A portable light.", whyHard: "An object." },
  });
  assert.equal(useVocab.getState().words[0].meaning, "A portable light.");
  assert.equal(useVocab.getState().words[1], ready);
  assert.equal(writes.length, 1);
  assert.equal(globalThis.__noteWrites.length, 1);
  useVocab.getState().fillPrepared(home.id, {});
  assert.equal(writes.length, 1);
});

test("unchanged placeholder and another book's sources do not trigger writes", () => {
  const foreign = { ...word(), sources: [{ book: "another-book" }] };
  reset([word(), foreign]);
  useVocab.getState().fillPrepared(home.id, {
    lantern: { pos: "noun", meaning: placeholder, whyHard: "" },
  });
  assert.equal(writes.length, 0);
  assert.equal(globalThis.__noteWrites.length, 0);
});
