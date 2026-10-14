import assert from "node:assert/strict";
import { test } from "node:test";
import { applyGlossaryWork, GLOSSARY_WORK_LIMIT, normalizeGlossaryWork, readWorkToggle } from "../src/lib/glossary-work.ts";

const NOW = "2026-10-14T06:02:00.000Z";
const LATER = "2026-10-14T08:00:00.000Z";

test("a mark keeps its time, and clearing one book leaves the others", () => {
  const charlie = applyGlossaryWork([], "lists", "charlie", true, NOW);
  assert.deepEqual(charlie, [{ kind: "lists", id: "charlie", since: NOW }]);
  const again = applyGlossaryWork(charlie, "lists", "charlie", true, LATER);
  assert.equal(again[0].since, NOW);
  const both = applyGlossaryWork(again, "public", "alice", true, LATER);
  const left = applyGlossaryWork(both, "lists", "charlie", false, LATER);
  assert.deepEqual(left, [{ kind: "public", id: "alice", since: LATER }]);
});

test("a saved list is kept only when every row is a book and a time", () => {
  assert.deepEqual(normalizeGlossaryWork({ items: [] }), { ok: true, items: [] });
  assert.equal(normalizeGlossaryWork({ items: [{ kind: "lists", id: "charlie", since: NOW }] }).ok, true);
  assert.equal(normalizeGlossaryWork({ rails: [] }).ok, false);
  assert.equal(normalizeGlossaryWork({ items: [{ kind: "lists", id: "charlie", since: "yesterday" }] }).ok, false);
  assert.equal(normalizeGlossaryWork({ items: [{ kind: "lists", id: "charlie", since: NOW }, { kind: "lists", id: "charlie", since: LATER }] }).ok, false);
  assert.equal(readWorkToggle({ kind: "public", id: "alice", making: false })?.making, false);
  assert.equal(readWorkToggle({ kind: "shelf", id: "alice", making: true }), null);
});

test("the in-progress list stops at its cap", () => {
  let items = [];
  for (let n = 0; n < GLOSSARY_WORK_LIMIT; n += 1) {
    items = applyGlossaryWork(items, "lists", `book-${n}`, true, NOW);
  }
  assert.equal(items.length, GLOSSARY_WORK_LIMIT);
  assert.equal(applyGlossaryWork(items, "lists", "one-more", true, NOW), null);
});
