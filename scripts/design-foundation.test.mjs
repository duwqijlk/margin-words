// The design system "Keep reading", batch 1 (the foundation): four reading themes with the same
// tokens, the retired Clear theme reading as paper, three radii with no pills on buttons and chips,
// the interface and book-voice fonts, one icon stroke, and no motion on e-ink.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { asSettings } from "../src/lib/sync-merge.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/styles.css");

const TOKENS = ["paper", "sheet", "card", "ink", "muted", "faint", "line", "edge", "accent", "accent-ink", "accent-soft", "mark", "warn", "warn-soft"];
const block = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} has a block`);
  return css.slice(at, css.indexOf("}", at));
};

test("four reading themes, each with every colour and a matching -rgb twin", () => {
  for (const selector of ['[data-theme="light"]', '[data-theme="sepia"]', '[data-theme="dark"]', '[data-theme="eink"]']) {
    const body = block(selector);
    for (const name of TOKENS) {
      const hex = body.match(new RegExp(`--${name}: #([0-9a-f]{6});`))?.[1];
      assert.ok(hex, `${selector} --${name}`);
      const rgb = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(" ");
      assert.match(body, new RegExp(`--${name}-rgb: ${rgb};`), `${selector} --${name}-rgb matches`);
    }
  }
  assert.doesNotMatch(css, /data-theme="clear"/, "the Clear theme is gone");
  assert.doesNotMatch(css, /backdrop-filter/, "no frosted glass anywhere");
});

test("the brand green is the same on paper and sepia, and the theme picker offers e-ink", () => {
  const accent = (selector) => block(selector).match(/--accent: (#[0-9a-f]{6});/)[1];
  assert.equal(accent('[data-theme="light"]'), accent('[data-theme="sepia"]'));
  assert.match(read("src/components/reader-settings.tsx"), /value: "eink"/);
  assert.match(read("src/components/get-books.tsx"), /value: "eink" as const/);
});

test("a reader who had the Clear theme reads on paper, also from an older device's sync", () => {
  assert.equal(asSettings({ theme: "clear" }).theme, "light");
  assert.equal(asSettings({ theme: "eink" }).theme, "eink");
  const prefs = read("src/lib/reader-prefs.ts");
  assert.match(prefs, /saved\.theme === "sepia" \|\| saved\.theme === "dark" \|\| saved\.theme === "eink" \? saved\.theme : "light"/);
  assert.match(prefs, /t==="eink"/, "the boot script knows e-ink");
  assert.doesNotMatch(prefs, /t==="clear"/);
});

test("three radii, and buttons, fields and chips are not pills", () => {
  const config = read("tailwind.config.js");
  for (const [key, value] of [["sm", "2px"], ["DEFAULT", "4px"], ["md", "4px"], ["lg", "4px"], ["xl", "4px"], ['"2xl"', "8px"], ['"3xl"', "8px"], ["card", "1.25rem"], ["sheet", "1.5rem"]]) {
    assert.match(config, new RegExp(`${key}: "${value.replace(".", "\\.")}"`), `${key} is ${value}`);
  }
  const ui = read("src/components/ui.tsx");
  const presets = ui.slice(ui.indexOf("const btnBase"), ui.indexOf("export const subTabs"));
  assert.doesNotMatch(presets, /rounded-full/);
  assert.match(presets, /font-bold/, "button labels are bold");
  assert.match(presets, /border border-edge/, "secondary buttons and fields have an edge border");
});

test("floating layers share one look: paper, 8px, the lift shadow, a 32% overlay", () => {
  const files = ["account-dialog", "own-epub-dialog", "shelf-book-info", "sponsor-dialog", "step-dialog", "share-dialog", "qq-dialog"];
  for (const name of files) {
    const body = read(`src/components/${name}.tsx`);
    assert.doesNotMatch(body, /shadow-pop/, `${name} uses shadow-lift`);
    assert.doesNotMatch(body, /bg-black\/(40|45)\b/, `${name} overlay is 32%`);
  }
  assert.match(read("src/components/word-card.tsx"), /shadow-pop/, "the word card keeps its own shadow");
});

test("the interface font and the self-hosted Chinese serif are wired in", () => {
  assert.match(css, /--font-sans:\s*"Atkinson Hyperlegible"/);
  assert.match(css, /--font-display: "Literata", "inputread Serif SC"/);
  for (const file of ["atkinson-hyperlegible-normal-400", "atkinson-hyperlegible-normal-700", "atkinson-hyperlegible-italic-400"]) {
    assert.ok(existsSync(new URL(`../public/fonts/${file}.woff2`, import.meta.url)), file);
  }
  assert.match(read("src/main.tsx"), /import "\.\/fonts-zh-serif\.css";/);
  const zh = read("src/fonts-zh-serif.css");
  for (const src of zh.matchAll(/url\("\/fonts\/zh-serif\/([0-9]+\.woff2)"\)/g)) {
    assert.ok(existsSync(new URL(`../public/fonts/zh-serif/${src[1]}`, import.meta.url)), src[1]);
  }
});

test("one icon stroke, and nothing moves on e-ink", () => {
  assert.match(css, /\.lucide \{\s*stroke-width: 1\.5;/);
  assert.match(css, /\[data-theme="eink"\] \*,[\s\S]{0,80}animation: none !important;\s*transition: none !important;/);
});
