// The design system "Keep reading", batch 1 (the foundation): four reading themes with the same
// tokens, the retired Clear theme reading as paper, three radii with no pills on buttons and chips,
// the interface and book-voice fonts, one icon stroke, and no motion on e-ink.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { asSettings } from "../src/lib/sync-merge.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/styles.css");

const TOKENS = ["paper", "sheet", "card", "ink", "muted", "faint", "line", "edge", "accent", "accent-ink", "accent-soft", "mark", "mark-hover", "mark-active", "mark-inverse", "warn", "warn-soft"];
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
  // The only material is the bars' (design system ScrollChrome), with an opaque ground where it cannot blur.
  for (const rule of css.match(/[^{}]*\{[^{}]*backdrop-filter[^{}]*\}/g) ?? []) assert.match(rule, /\.chrome-bar/, "frosted glass only on the bars");
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
});

test("amber backgrounds and inverse actions stay readable in every theme", () => {
  const luminance = (hex) => {
    const rgb = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const theme of ["light", "sepia", "dark", "eink"]) {
    const body = block(`[data-theme="${theme}"]`);
    const color = name => body.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];
    for (const name of ["mark", "mark-hover", "mark-active"]) assert.ok(contrast(color("ink"), color(name)) >= 4.5, `${theme} ink on ${name}`);
    assert.ok(contrast(color("word-hint"), color("paper")) >= 4.5, `${theme} hint on paper`);
    assert.ok(contrast(color("mark-inverse"), color("ink")) >= 4.5, `${theme} inverse action`);
    const blend = (a, b) => '#' + [1, 3, 5].map(at => Math.round(parseInt(a.slice(at, at + 2), 16) * 0.15 + parseInt(b.slice(at, at + 2), 16) * 0.85).toString(16).padStart(2, '0')).join('');
    assert.ok(contrast(color("mark-inverse"), blend(color("paper"), color("ink"))) >= 4.5, `${theme} hovered inverse action`);
  }
  for (const name of ["passage-feedback", "quote-tools", "quote-book", "quote-flow", "shelf-actions"]) {
    const source = read(`src/components/${name}.tsx`);
    assert.doesNotMatch(source, /\btext-mark(?=[\s"`])/);
    assert.match(source, /text-mark-inverse/);
  }
  assert.doesNotMatch(read("src/components/help-panels.tsx"), /bg-mark\/\d/);
});

test("word hints offer subtle, underline and off without changing the focus switch", () => {
  const settings = read("src/components/reader-settings.tsx");
  assert.match(settings, /value=\{prefs\.wordHints\}/);
  assert.match(settings, /set\(\{ wordHints \}\)/);
  assert.match(settings, /data-reader-word-hints/);
  assert.doesNotMatch(settings, /data-reader-quiet-marks|<Underline|<BookOpen|<Focus/);
  for (const mode of ["subtle", "underline", "off"]) assert.match(settings, new RegExp(`value: "${mode}"`));
  assert.match(settings, /checked=\{prefs\.focus\}/);
  assert.match(read("src/lib/i18n-en.ts"), /"rs.wordHints": "Word hints"/);
});

test("paper is pure white with a brand green that passes AA, and the theme picker offers e-ink", () => {
  const token = (selector, name) => block(selector).match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];
  assert.equal(token('[data-theme="light"]', "paper"), "#ffffff");
  assert.equal(token('[data-theme="light"]', "accent"), "#167a4b");
  assert.equal(token('[data-theme="eink"]', "accent"), "#000000");
  assert.match(read("src/components/ui.tsx"), /\{ value: "eink", bg: "#ffffff", fg: "#000000", brand: "#000000" \}/);
  assert.match(read("src/components/reader-settings.tsx"), /<ThemeTiles/);
  assert.doesNotMatch(read("src/components/get-books.tsx"), /<ThemeTiles/);
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

test("non-reader pages and portals share the display face without changing reader defaults", () => {
  const scope = 'html[data-ui-font="display"]';
  assert.match(block(scope), /--font-sans: var\(--font-display\);/);
  assert.match(block(`${scope} body`), /font-variant-numeric: lining-nums;/);
  assert.match(block(`${scope} kbd`), /font-family: var\(--font-display\);/);
  assert.match(block(`${scope} [class~="[font-variant-numeric:tabular-nums]"]`), /font-variant-numeric: lining-nums tabular-nums;/);
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /const reading = screen\.kind === "read";/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*?if \(reading\) root\.removeAttribute\("data-ui-font"\);\s*else root\.setAttribute\("data-ui-font", "display"\);\s*return \(\) => root\.removeAttribute\("data-ui-font"\);\s*\}, \[reading\]\);/);
  assert.match(block(".book-body"), /font-family: var\(--reader-font, var\(--font-display\)\);/);
  assert.match(block(".word-ipa"), /font-family: "Inter"/);
});

test("one icon stroke, and nothing moves on e-ink", () => {
  assert.match(css, /\.lucide \{\s*stroke-width: 1\.5;/);
  assert.match(css, /\[data-theme="eink"\] \*,[\s\S]{0,80}animation: none !important;\s*transition: none !important;/);
});

test("account owns settings, with one avatar entry and no outdated guest-reading copy", () => {
  const app = read("src/components/margin-app.tsx");
  const account = read("src/components/account-dialog.tsx");
  assert.doesNotMatch(app, /data-settings-button|SettingsDialog|settingsOpen/);
  assert.match(app, /signedIn \? \([\s\S]*?<Avatar key=[^\n]*size=\{24\}[\s\S]*?: \(\s*<UserRound className="size-5"/, "only signed-in accounts show an avatar; guests keep the original account icon");
  assert.match(app, /className="\[&>svg\]:!size-5"/, "fallback person stays as visible as the notebook icon");
  assert.doesNotMatch(account, /data-account-settings|data-account-back|data-settings-panel|setView\(/);
  assert.match(account, /<AccountPreferences onDismiss=\{dismissForNavigation\}/);
  assert.match(account, /role === "admin" \|\| isSponsorAdmin\(emailSaved\)/);
  assert.match(account, /data-account-admin/);
  assert.doesNotMatch(account, /account\.forgotBody/);
  for (const locale of ["en", "zh"]) assert.doesNotMatch(read(`src/lib/i18n-${locale}.ts`), /"account\.forgotBody"/);
});

test("title hierarchy stays bold and book titles retain their display face", () => {
  // Dialog and page titles: the interface face, bold, -0.02em.
  // The account directly contains preferences; its title retains the shared panel style.
  assert.match(read("src/components/account-dialog.tsx"), /<Dialog\.Title className=\{panel\.title\}>/);
  assert.match(read("src/components/ui.tsx"), /title: "m-0 text-2xl leading-tight font-bold tracking-\[-0\.02em\]"/);
  for (const [file, text] of [["step-dialog", 'data("heading") : {})}>'], ["shelf-book-info", '{t("shelf.info")}']]) {
    const body = read(`src/components/${file}.tsx`);
    const at = body.indexOf(text);
    const line = body.slice(body.lastIndexOf("\n", body.lastIndexOf("className", at)), at);
    assert.match(line, /font-bold tracking-\[-0\.02em\]/, `${file}: ${text}`);
    assert.doesNotMatch(line, /font-display/, `${file}: ${text}`);
  }
  // Book titles and headwords keep Literata.
  assert.match(read("src/components/word-card.tsx"), /font-display leading-tight font-bold/);
  assert.match(read("src/components/shelf-book-info.tsx"), /font-display text-lg leading-snug font-semibold" lang="en"/);
  assert.match(read("src/components/book-cover.tsx"), /rounded-cover/);
});
