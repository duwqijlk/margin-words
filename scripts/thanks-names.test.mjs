import assert from "node:assert/strict";
import test from "node:test";
import { thanksFrame } from "../src/lib/thanks-names.ts";

test("an empty thank-you list has nothing to show", () => {
  assert.equal(thanksFrame([], 0), null);
});

test("names take turns, and the first name comes back", () => {
  const names = ["Ada", "Lin", "Mei"];
  assert.deepEqual(thanksFrame(names, 0), { name: "Ada", next: 1 });
  assert.deepEqual(thanksFrame(names, 1), { name: "Lin", next: 2 });
  assert.deepEqual(thanksFrame(names, 2), { name: "Mei", next: 0 });
  assert.deepEqual(thanksFrame(names, 3), { name: "Ada", next: 1 });
});
