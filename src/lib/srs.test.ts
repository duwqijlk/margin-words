import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReview, INTERVALS_DAYS, summarize } from "./srs.ts";
import type { VocabEntry } from "./vocab-model.ts";

const T0 = new Date(2026, 9, 1, 15, 30).getTime();
const day0 = new Date(2026, 9, 1).getTime();

function card(stage = 0): VocabEntry {
  return {
    id: "a",
    bookId: "b",
    surface: "glimmer",
    lemma: "glimmer",
    pos: "singular noun",
    meaning: "A small light.",
    whyHard: "",
    recommend: true,
    sentence: "A glimmer.",
    stage,
    dueAt: T0,
    createdAt: T0,
    reps: 0,
    lapses: 0,
  };
}

test("ladder is 1/2/4/7/15/30", () => {
  assert.deepEqual([...INTERVALS_DAYS], [1, 2, 4, 7, 15, 30]);
});

test("successful reviews walk the ladder then master", () => {
  let c = card();
  const gaps: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    c = applyReview(c, true, T0);
    gaps.push(Math.round((c.dueAt - day0) / 86_400_000));
  }
  assert.deepEqual(gaps, [1, 2, 4, 7, 15, 30]);
  assert.equal(c.stage, 6);
  c = applyReview(c, true, T0);
  assert.equal(c.stage, 7);
});

test("a miss resets to stage 0 and is due now", () => {
  const c = applyReview(card(4), false, T0);
  assert.equal(c.stage, 0);
  assert.equal(c.dueAt, T0);
  assert.equal(c.lapses, 1);
});

test("summarize counts due, mastered and upcoming", () => {
  const a = card(0);
  const b = { ...card(3), id: "b", dueAt: day0 + 2 * 86_400_000 };
  const m = { ...card(7), id: "m", dueAt: Number.MAX_SAFE_INTEGER };
  const s = summarize([a, b, m], T0);
  assert.equal(s.total, 3);
  assert.equal(s.due, 1);
  assert.equal(s.mastered, 1);
  assert.equal(s.upcoming[0], 1);
  assert.equal(s.upcoming[2], 1);
});
