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

test("paper is pure white with a fresh brand green, and the theme picker offers e-ink", () => {
  const token = (selector, name) => block(selector).match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];
  assert.equal(token('[data-theme="light"]', "paper"), "#ffffff");
  assert.equal(token('[data-theme="light"]', "accent"), "#17804f");
  assert.equal(token('[data-theme="eink"]', "accent"), "#000000");
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

test("radii 2 / 10 / 16 and 6 for covers, and buttons, fields and chips are not pills", () => {
  const config = read("tailwind.config.js");
  for (const [key, value] of [["sm", "2px"], ["DEFAULT", "10px"], ["md", "10px"], ["lg", "10px"], ["xl", "10px"], ['"2xl"', "16px"], ['"3xl"', "16px"], ["cover", "6px"], ["card", "1.25rem"], ["sheet", "1.5rem"]]) {
    assert.match(config, new RegExp(`${key}: "${value.replace(".", "\\.")}"`), `${key} is ${value}`);
  }
  const ui = read("src/components/ui.tsx");
  const presets = ui.slice(ui.indexOf("const btnBase"), ui.indexOf("export const subTabs"));
  assert.doesNotMatch(presets, /rounded-full/);
  assert.match(presets, /font-bold/, "button labels are bold");
  assert.match(presets, /border border-edge/, "secondary buttons and fields have an edge border");
});

test("floating layers share one look: paper, 16px, the lift shadow, a 32% overlay", () => {
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

test("interface titles and numbers use the bold interface font; the book's own words stay in Literata", () => {
  // Dialog and page titles: the interface face, bold, -0.02em.
  for (const [file, text] of [["get-books", '{t("settings.title")}'], ["step-dialog", 'data("heading") : {})}>'], ["shelf-book-info", '{t("shelf.info")}']]) {
    const body = read(`src/components/${file}.tsx`);
    const at = body.indexOf(text);
    const line = body.slice(body.lastIndexOf("\n", body.lastIndexOf("className", at)), at);
    assert.match(line, /font-bold tracking-\[-0\.02em\]/, `${file}: ${text}`);
    assert.doesNotMatch(line, /font-display/, `${file}: ${text}`);
  }
  // Book titles and headwords keep Literata.
  assert.match(read("src/components/word-card.tsx"), /font-display text-\[1\.85rem\] leading-tight font-bold/);
  assert.match(read("src/components/shelf-book-info.tsx"), /font-display text-lg leading-snug font-semibold" lang="en"/);
  assert.match(read("src/components/book-cover.tsx"), /rounded-cover/);
});
