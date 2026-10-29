// Design system "Keep reading", batch 3 (shelf and Discover): a book's own colour picked from its
// cover and mixed without CSS color-mix (Chrome 69), the continue card on every screen, Lexile only in
// the book detail, and the add-to-shelf feedback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hexToRgb, mixOklab, pickTone, toneStyle } from "../src/lib/tone-math.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pixels = (rgb, n = 24 * 36) => Array.from({ length: n }, () => [...rgb, 255]).flat();

test("a cover's colour: the strongest hue, none for a grey or white cover", () => {
  assert.equal(pickTone(pixels([63, 107, 74])), "#3f6b4a");
  assert.equal(pickTone(pixels([128, 128, 130])), "", "grey: no colour");
  assert.equal(pickTone(pixels([250, 250, 250])), "", "white: no colour");
  // A pale cover still gives a visible colour (lightness clamped to 0.35-0.65 in OKLCH).
  const pale = hexToRgb(pickTone(pixels([220, 160, 160])));
  assert.ok(pale && Math.max(...pale) < 235, "pale cover darkened");
});

test("the shades are mixed in OKLab per theme, and e-ink falls back to sheet and ink", () => {
  assert.equal(mixOklab("#3f6b4a", "#ffffff", 1), "#3f6b4a");
  assert.equal(mixOklab("#3f6b4a", "#ffffff", 0), "#ffffff");
  const light = toneStyle("#3f6b4a", "light");
  assert.equal(light["--book-wash"], mixOklab("#3f6b4a", "#ffffff", 0.2));
  assert.equal(light["--book-tint"], mixOklab("#3f6b4a", "#ffffff", 0.44));
  const dark = toneStyle("#3f6b4a", "dark");
  assert.equal(dark["--book-shadow"], "#000000");
  const eink = toneStyle("#3f6b4a", "eink");
  assert.equal(eink["--book-wash"], "#f2f2f2");
  assert.equal(eink["--book-deep"], "#000000");
  assert.equal(toneStyle("", "light")["--book-wash"], "#f3f5f4", "no colour: sheet");
  // No color-mix() anywhere: the e-ink readers (Chrome 69) cannot parse it.
  assert.doesNotMatch(read("src/styles.css"), /color-mix\(/);
});

test("the continue card shows on phones too and has no Lexile; list cards show no Lexile either", () => {
  const shelf = read("src/components/shelf.tsx");
  const hero = shelf.slice(shelf.indexOf("function ContinueCard("), shelf.indexOf("function ShelfSkeleton("));
  assert.doesNotMatch(hero, /hidden sm:grid/, "not hidden on a phone");
  assert.doesNotMatch(hero, /LexileBadge/);
  assert.match(hero, /tone-ground/);
  assert.match(hero, /ProgressRing/);
  assert.match(hero, /data-continue-words/, "the words saved from this book open the notebook");
  const discover = read("src/components/discover.tsx");
  const card = discover.slice(discover.indexOf("  function renderCard("), discover.indexOf("  const browsing ="));
  assert.doesNotMatch(card, /data-lexile=\{/);
  assert.match(read("src/components/discover-browse.tsx"), /model\.lexile \? \[\{ label: t\("browse\.fact\.level"\)/, "Lexile tile only when there is a measure");
});

test("adding a book: a ring with the real progress, then a +1 to the Shelf tab and a short toast", () => {
  const actions = read("src/components/shelf-actions.tsx");
  assert.match(actions, /before\.current === "busy" && state === "on"[^]*?flyTo\(button\.current, shelfTabTarget\(\)\)/);
  assert.match(actions, /setTimeout\(dismissNotice, 2600\)/);
  assert.match(read("src/components/margin-app.tsx"), /data-nav=\{id\}/);
  assert.match(read("src/components/margin-app.tsx"), /data-nav=\{tab\.id\}/);
});
