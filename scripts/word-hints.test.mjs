import assert from "node:assert/strict";
import { test } from "node:test";
import { wordHintPrefs } from "../src/lib/word-hints.ts";

const PREFS_KEY = "cibian-prefs-v1";
const modes = ["subtle", "underline", "off"];
const expected = (wordHints) => ({ wordHints, quietMarks: wordHints === "off" });
const hintsOf = ({ wordHints, quietMarks }) => ({ wordHints, quietMarks });
let storeId = 0;

// Import a fresh real Zustand store for each device/reload, replacing only browser storage.
async function loadPrefs(t, saved) {
  const values = new Map();
  if (saved !== undefined) values.set(PREFS_KEY, JSON.stringify({ state: saved, version: 0 }));
  for (const [name, value] of Object.entries({
    window: {},
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  const fresh = async () => (await import(`../src/lib/reader-prefs.ts?word-hints-test=${++storeId}`)).usePrefs;
  return { store: await fresh(), fresh, values };
}

test("word hints default to subtle and only literal legacy true turns them off", () => {
  assert.deepEqual(wordHintPrefs({}), expected("subtle"));
  for (const quietMarks of [undefined, null, false, "true", "false", 0, 1, {}, []]) {
    assert.deepEqual(wordHintPrefs({ quietMarks }), expected("subtle"));
  }
  assert.deepEqual(wordHintPrefs({ quietMarks: true }), expected("off"));
});

test("valid hint enums win conflicts and always repair the legacy mirror", () => {
  for (const wordHints of modes) {
    for (const quietMarks of [undefined, null, false, true, "true", 1]) {
      const result = wordHintPrefs({ wordHints, quietMarks });
      assert.deepEqual(result, expected(wordHints));
      assert.deepEqual(wordHintPrefs(JSON.parse(JSON.stringify(result))), result);
    }
  }
});

test("invalid hint enums fall back to the legacy flag, not truthiness", () => {
  for (const wordHints of [undefined, null, "", "UNDERLINE", "quiet", "none", false, true, 0, {}, []]) {
    for (const quietMarks of [undefined, false, true, "true", 1]) {
      const raw = { wordHints, quietMarks };
      assert.deepEqual(wordHintPrefs(raw), expected(quietMarks === true ? "off" : "subtle"));
      assert.equal(raw.wordHints, wordHints, "normalization does not mutate its input");
      assert.equal(raw.quietMarks, quietMarks);
    }
  }
});

test("fresh preferences use subtle hints and defer persisted legacy migration until hydration", async (t) => {
  const { store } = await loadPrefs(t, { quietMarks: true, size: 24 });
  assert.equal(store.persist.hasHydrated(), false);
  assert.deepEqual(hintsOf(store.getState()), expected("subtle"));
  await store.persist.rehydrate();
  assert.equal(store.persist.hasHydrated(), true);
  assert.deepEqual(hintsOf(store.getState()), expected("off"), "legacy true is normalized before the subtle default can mask it");
  assert.equal(store.getState().size, 24);
});

test("preference hydration normalizes missing, invalid, and conflicting saved hint fields", async (t) => {
  const cases = [
    [undefined, "subtle"],
    [{}, "subtle"],
    [{ quietMarks: false }, "subtle"],
    [{ quietMarks: "true" }, "subtle"],
    [{ wordHints: "invalid", quietMarks: true }, "off"],
    [{ wordHints: null, quietMarks: false }, "subtle"],
    ...modes.map((wordHints) => [{ wordHints, quietMarks: wordHints !== "off" }, wordHints]),
  ];
  for (const [saved, mode] of cases) {
    await t.test(`saved ${JSON.stringify(saved)}`, async (t) => {
      const { store } = await loadPrefs(t, saved);
      await store.persist.rehydrate();
      assert.deepEqual(hintsOf(store.getState()), expected(mode));
    });
  }
});

test("the preference setter honors explicit modes, legacy-only patches, and invalid fallbacks", async (t) => {
  const { store } = await loadPrefs(t);
  for (const wordHints of modes) {
    store.getState().set({ wordHints, quietMarks: wordHints !== "off" });
    assert.deepEqual(hintsOf(store.getState()), expected(wordHints));
  }
  store.getState().set({ wordHints: "underline" });
  store.getState().set({ quietMarks: true });
  assert.deepEqual(hintsOf(store.getState()), expected("off"));
  store.getState().set({ wordHints: "underline" });
  store.getState().set({ quietMarks: false });
  assert.deepEqual(hintsOf(store.getState()), expected("subtle"), "an old client cannot express underline");
  store.getState().set({ wordHints: "invalid", quietMarks: true });
  assert.deepEqual(hintsOf(store.getState()), expected("off"));
  store.getState().set({ wordHints: undefined });
  assert.deepEqual(hintsOf(store.getState()), expected("subtle"), "a present but missing enum uses the patch fallback, not stale state");
});

test("unrelated preference patches preserve every hint mode through storage and reload", async (t) => {
  const { store, fresh, values } = await loadPrefs(t);
  for (const wordHints of modes) {
    store.getState().set({ wordHints });
    store.getState().set({ size: 26, theme: "sepia" });
    store.getState().set({});
    assert.deepEqual(hintsOf(store.getState()), expected(wordHints));
    const saved = JSON.parse(values.get(PREFS_KEY)).state;
    assert.deepEqual(hintsOf(saved), expected(wordHints));
    assert.equal(saved.size, 26);
    assert.equal("set" in saved, false, "only persisted preferences are serialized");
    const reloaded = await fresh();
    await reloaded.persist.rehydrate();
    assert.deepEqual(hintsOf(reloaded.getState()), expected(wordHints));
    assert.equal(reloaded.getState().theme, "sepia");
    assert.equal(reloaded.getState().size, 26);
  }
});

test("preference persistence repairs a stale mirror even after direct store updates", async (t) => {
  const { store, fresh, values } = await loadPrefs(t);
  for (const wordHints of modes) {
    store.setState({ wordHints, quietMarks: wordHints !== "off" });
    assert.deepEqual(hintsOf(JSON.parse(values.get(PREFS_KEY)).state), expected(wordHints));
    const reloaded = await fresh();
    await reloaded.persist.rehydrate();
    assert.deepEqual(hintsOf(reloaded.getState()), expected(wordHints));
  }
});
