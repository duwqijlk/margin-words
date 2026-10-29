// Share images drawn on the device (src/lib/share-card.ts): line wrapping and the QR code.
// The drawing itself needs a canvas, so it is checked in a browser, not here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CARD_H, CARD_W, PALETTES, qrModules, SHARE_THEMES, SHARE_URL, wrapLines } from "../src/lib/share-card.ts";

// Every character is 10 units wide.
const measure = (text) => [...text].length * 10;

test("lines break between words and never run past the width", () => {
  const lines = wrapLines(measure, "The Adventures of Tom Sawyer", 120, 3);
  assert.deepEqual(lines, ["The", "Adventures", "of Tom\u2026"]);
  for (const line of lines) assert.ok(measure(line) <= 120, line);
  assert.deepEqual(wrapLines(measure, "Alice in Wonderland", 400, 2), ["Alice in Wonderland"]);
  assert.deepEqual(wrapLines(measure, "Alice in Wonderland", 100, 2), ["Alice in", "Wonderland"]);
});

test("a cut text ends with an ellipsis on its last allowed line", () => {
  const lines = wrapLines(measure, "one two three four five six seven", 100, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"), lines[1]);
  assert.ok(measure(lines[1]) <= 100);
});

test("a word wider than the line is cut by characters; Chinese breaks between characters", () => {
  const long = wrapLines(measure, "Supercalifragilistic", 80, 4);
  for (const line of long) assert.ok(measure(line) <= 80, line);
  assert.equal(long.join("").replace(/…$/, ""), "Supercalifragilistic".slice(0, long.join("").replace(/…$/, "").length));
  const zh = wrapLines(measure, "\u6211\u8bfb\u5b8c\u4e86\u4e00\u672c\u82f1\u6587\u539f\u8457", 40, 3);
  assert.deepEqual(zh, ["\u6211\u8bfb\u5b8c\u4e86", "\u4e00\u672c\u82f1\u6587", "\u539f\u8457"]);
  assert.deepEqual(wrapLines(measure, "   ", 100, 2), []);
});

test("the QR code is a square grid with the three finder patterns of a real code", () => {
  const grid = qrModules(SHARE_URL);
  const n = grid.length;
  assert.ok(n >= 21 && (n - 17) % 4 === 0, `size ${n}`);
  for (const row of grid) assert.equal(row.length, n);
  // A finder pattern: dark 7x7 ring, light ring, dark 3x3 centre.
  const finder = (r, c) => grid[r][c] && grid[r + 6][c + 6] && !grid[r + 1][c + 1] && grid[r + 3][c + 3];
  assert.ok(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0));
});

test("three styles, a 3:4 card, and the QR code always points at the site", () => {
  assert.deepEqual([...SHARE_THEMES], ["paper", "forest", "night"]);
  for (const theme of SHARE_THEMES) assert.ok(PALETTES[theme].bg && PALETTES[theme].accent);
  assert.equal(CARD_W * 4, CARD_H * 3);
  assert.equal(SHARE_URL, "https://inputread.site/");
  // The dialog is loaded on the first tap, so the canvas code and the QR encoder stay out of the start.
  const button = readFileSync(new URL("../src/components/share-button.tsx", import.meta.url), "utf8");
  assert.match(button, /lazy\(\(\) => import\("@\/components\/share-dialog"\)\)/);
});
