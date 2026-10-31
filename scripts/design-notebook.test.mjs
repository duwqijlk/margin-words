// Design system "Keep reading", batch 4 (notebook and review): the review launcher every round passes
// through, the remembered way to review, dictionary rows instead of cards, numbers on tiles, the flash
// card that turns over without changing size, and the one celebration at the end of a round.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CLOZE_MIN_WORDS, isReviewMode, usableMode } from "../src/lib/review-mode.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the way to review is remembered, and Fill the blank falls back when there are too few words", () => {
  assert.equal(CLOZE_MIN_WORDS, 4);
  assert.equal(usableMode("cloze", 3), "cards");
  assert.equal(usableMode("cloze", 4), "cloze");
  assert.equal(usableMode("spell", 1), "spell");
  assert.ok(isReviewMode("spell") && !isReviewMode("quiz"));
  assert.match(read("src/lib/review-mode.ts"), /"cibian-review-mode-v1"/);
});

test("the notebook starts every round from its launcher, which carries the pool and the way", () => {
  const notebook = read("src/components/notebook.tsx");
  const header = notebook.indexOf("<header");
  const launcher = notebook.indexOf("<ReviewLauncher", header);
  const list = notebook.indexOf("data-word-list", header);
  assert.ok(header < launcher && launcher < list, "header, launcher, then the list");
  assert.doesNotMatch(notebook, /<StatRow/, "no row of four numbers (design system Notebook visual tidy-up)");
  assert.match(notebook, /<ModeCards\s+compact/);
  assert.match(notebook, /<WeekChart upcoming=\{stats\.upcoming\} mini \/>/);
  assert.match(notebook, /const PAGE = 30;/);
  assert.match(notebook, /role="tablist"[^]*?<TabInk selected=\{filter\} \/>/, "status tabs with a sliding line, not a segmented control");
  assert.doesNotMatch(notebook, /Segmented/);
  const app = read("src/components/margin-app.tsx");
  assert.match(app, /state: \{ review: pool, mode \}/);
  assert.match(app, /state: \{ review: "overview" \}/);
  const router = read("src/lib/router.ts");
  assert.match(router, /export function reviewIntent\(\): ReviewIntent \| null/);
});

test("a saved word is a ruled dictionary row with its own UK / US speakers and a memory ladder", () => {
  const notebook = read("src/components/notebook.tsx");
  const row = notebook.slice(notebook.indexOf("function WordRow("), notebook.indexOf("function ReviewLauncher("));
  assert.match(row, /border-b border-line/);
  assert.doesNotMatch(row, /rounded-2xl bg-card/, "no card");
  assert.match(row, /<WordIpa /);
  assert.match(row, /<MemoryLadder stage=\{word\.stage\} \/>/);
  assert.doesNotMatch(row, /head-mark/, "green means learned: no yellow highlighter on a headword (ColorRoles)");
  assert.match(notebook, /mastered \? "rounded-sm bg-accent-soft px-1 font-semibold text-accent"/);
  assert.match(read("src/styles.css"), /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.nb-actions \{\s*opacity: 0;/);
  const parts = read("src/components/review-parts.tsx");
  assert.match(parts, /role="radio"/);
  assert.match(parts, /done \|\| index < stage \? "bg-accent" : "bg-line"/);
});

test("numbers sit on sheet tiles in Literata; learned counts in brand green, never on a highlighter", () => {
  const ui = read("src/components/ui.tsx");
  const stat = ui.slice(ui.indexOf("export function StatRow("), ui.indexOf("export function Segmented<"));
  assert.match(stat, /rounded-2xl bg-sheet/);
  assert.match(stat, /font-display/);
  assert.match(stat, /item\.tone === "mark" && "text-accent"/);
  assert.doesNotMatch(read("src/styles.css"), /\.num-mark/);
  assert.match(read("src/styles.css"), /\[data-theme="eink"\] \.stat-tile \{\s*background: none;/);
});

test("the flash card turns over in place, and the round ends with the one celebration", () => {
  const review = read("src/components/review.tsx");
  assert.match(review, /review-flip-inner/);
  assert.match(review, /!revealed && "invisible"/, "the back is laid out but hidden until it turns");
  assert.match(review, /inert=\{revealed \|\| undefined\}/);
  assert.match(review, /if \(correct\) await stampPause\(\);\s*else await shake\(cardRef\.current\);\s*await slideOut\(cardRef\.current, correct \? "right" : "left"\);/);
  assert.match(review, /confetti\(host\.current\);/);
  assert.match(review, /countUp\(rightRef\.current, right/);
  assert.match(review, /data-summary-other/, "other ways to practise the same words");
  const css = read("src/styles.css");
  assert.match(css, /\.review-flip\.is-flipped \.review-flip-inner \{\s*transform: rotateY\(180deg\);/);
  const motion = read("src/lib/motion.ts");
  // Animation.finished needs Chrome 84; the e-ink readers are on Chrome 69.
  assert.doesNotMatch(motion, /\.finished\.then\(/);
  for (const name of ["shake", "slideOut", "countUp", "confetti"]) {
    const body = motion.slice(motion.indexOf(`export function ${name}(`));
    assert.match(body.slice(0, 400), /motionOff\(\)/, `${name} checks motionOff`);
  }
});
