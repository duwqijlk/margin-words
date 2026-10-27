/** Discover browsing opens the introduction, even when the book is already on the shelf. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const discover = readFileSync(new URL("../src/components/discover.tsx", import.meta.url), "utf8");
const browse = readFileSync(new URL("../src/components/discover-browse.tsx", import.meta.url), "utf8");
const card = discover.slice(discover.indexOf("  function renderCard("), discover.indexOf("  const browsing ="));

test("grid covers and titles open details regardless of shelf ownership", () => {
  const cover = card.match(/<button\b[^>]*onClick=\{\(\) => setDetailId\(row\.key\)\}[^]*?data-card-detail[^]*?<\/button>/)?.[0];
  assert.ok(cover, "the cover has the same detail action for every book");
  assert.match(cover, /aria-label=\{t\("browse\.openAria"/);
  assert.match(cover, /<BookCover\b/);
  const title = card.match(/<h3\b[^]*?<\/h3>/)?.[0];
  assert.ok(title);
  assert.match(title, /onClick=\{\(\) => setDetailId\(row\.key\)\}/);
  assert.doesNotMatch(card, /held\s*&&\s*record/, "owned books must not branch into reading");
  assert.doesNotMatch(card, /onClick=\{[^\n]*onOpen\(/);
  assert.match(discover, /group\.rows\.map\(renderCard\)/, "collections use the same cards");
  assert.match(discover, /visible\.map\(renderCard\)/, "the all-books grid uses the same cards");
});

test("the featured book and every rail also open details", () => {
  const entries = discover.match(/<(?:FeaturedBook|BookRail)\b[^]*?\/>/g) ?? [];
  assert.equal(entries.length, 3, "featured, new books, and configured rails");
  for (const entry of entries) {
    assert.match(entry, /onOpen=\{\(row\) => setDetailId\(row\.key\)\}/);
  }
  for (const component of ["BookRail", "FeaturedBook"]) {
    const start = browse.indexOf(`export function ${component}(`);
    const next = browse.indexOf("export function ", start + 1);
    const source = browse.slice(start, next < 0 ? undefined : next);
    assert.match(source, /onClick=\{\(\) => onOpen\(row\)\}/);
    assert.match(source, /aria-label=\{t\("browse\.openAria"/);
  }
});

test("explicit open actions still open the held book", () => {
  const detail = discover.slice(discover.indexOf("  function detailAction("), discover.indexOf("  function renderCard("));
  assert.match(detail, /if \(m\.state === "on"\)[^]*?if \(m\.record\)[^]*?setDetailId\(""\);\s*onOpen\(m\.record\.bookId\);/);
  assert.match(discover, /onAction=\{\(\) => detailRow && detailAction\(detailRow\)\}/);
  assert.match(browse, /onClick=\{onAction\}[^]*?data-detail-action=\{model\.state\}/);
  assert.match(card, /<AddToShelfButton\b[^]*?onOpen=\{\(\) => record && onOpen\(record\.bookId\)\}/);
});

test("held copies remain explicitly openable during update, busy and error states", () => {
  const extra = browse.match(/\{model\.held && model\.state !== "on" \? \([^]*?data-detail-open[^]*?<\/button>/)?.[0];
  assert.ok(extra, "an installed copy has a separate action whenever the primary action is not Open");
  assert.match(extra, /onClick=\{onOpen\}/);
  assert.doesNotMatch(extra, /disabled=/);
  const handler = discover.match(/onOpen=\{\(\) => \{\s*if \(!detailRow\)[^]*?onOpen\(m\.record\.bookId\);\s*\}\}/)?.[0];
  assert.ok(handler);
  assert.match(handler, /if \(!m\.held \|\| !m\.record\) return;/);
  assert.doesNotMatch(handler, /state|updateReady|canAdd/);
});
