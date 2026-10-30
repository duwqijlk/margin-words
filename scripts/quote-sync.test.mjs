// Quotes: what is kept (text and place), how two devices' lists join, and the sync rows they travel in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSyncItems, captureSnapshot, emptyMeta, syncBatches } from "../src/lib/sync-diff.ts";
import { QUOTE_TEXT_MAX, QUOTES_PER_BOOK, SYNC_BODY_TARGET } from "../src/lib/limits.ts";
import {
  asQuoteBlob,
  joinSpans,
  makeQuote,
  mergeQuoteBlobs,
  quoteRows,
  quoteText,
  sentenceSpans,
  sentencesOf,
  wholeParagraph,
} from "../src/lib/quote-model.ts";
import { resolveAnchor } from "../src/lib/position.ts";
import { bookSyncKey, mergeItem, normalizeItem, SYNC_KINDS } from "../src/lib/sync-merge.ts";

const BOOK = bookSyncKey({ id: "w", title: "Wonder", author: "R. J. Palacio" });
const P = "I know I'm not an ordinary ten-year-old kid. I mean, sure, I do ordinary things. Mr. Brown said \"Hi.\" I eat ice cream.";

function quote(id, start, end, savedAt, text = P) {
  return makeQuote({ id, book: BOOK, title: "Wonder", author: "R. J. Palacio", chapter: 2, chapterTitle: "Ordinary", paragraph: 4, text, start, end, now: savedAt });
}

test("sentences are cut at sentence ends, not at titles or inside quotes", () => {
  assert.deepEqual(
    sentenceSpans(P).map((span) => P.slice(span.start, span.end)),
    ["I know I'm not an ordinary ten-year-old kid.", "I mean, sure, I do ordinary things.", 'Mr. Brown said "Hi."', "I eat ice cream."],
  );
});

test("a selection keeps its whole sentences, and one ending on a full stop stops there", () => {
  const at = P.indexOf("sure");
  const span = sentencesOf(P, at, at + 4);
  assert.equal(P.slice(span.start, span.end), "I mean, sure, I do ordinary things.");
  const from = P.indexOf("I mean");
  const to = P.indexOf("things.") + "things.".length;
  const exact = sentencesOf(P, from, to);
  assert.equal(P.slice(exact.start, exact.end), "I mean, sure, I do ordinary things.");
});

test("sentences next to each other join into one quote; a gap with words keeps them apart", () => {
  const spans = sentenceSpans(P).map((span) => ({ paragraph: 4, ...span }));
  const gap = (_p, from, to) => P.slice(from, to);
  assert.deepEqual(joinSpans([spans[1], spans[0]], gap), [{ paragraph: 4, start: spans[0].start, end: spans[1].end }]);
  assert.equal(joinSpans([spans[0], spans[2]], gap).length, 2);
  assert.equal(joinSpans([spans[0], { ...spans[1], paragraph: 5 }], gap).length, 2);
});

test("a kept quote holds the text and a place that is found again in another copy of the book", () => {
  const start = P.indexOf("I mean");
  const end = P.indexOf("things.") + 7;
  const kept = quote("q-000001", start, end, 10);
  assert.equal(kept.text, "I mean, sure, I do ordinary things.");
  assert.equal(kept.at.chapter, 2);
  assert.equal(kept.at.paragraph, 4);
  // Another copy: two more paragraphs before it, curly quotes.
  const other = ["Title page.", "Contents.", ...Array.from({ length: 4 }, (_, i) => `Filler ${i}.`), P.replace(/"/g, "“")];
  const hit = resolveAnchor(kept.at, [[], [], other]);
  assert.equal(hit.chapter, 2);
  assert.equal(hit.paragraph, 6);
  assert.ok(!kept.whole);
  assert.ok(quote("q-000002", 0, P.length, 11).whole);
  assert.ok(!wholeParagraph("One sentence only.", 0, 18));
});

test("a long paragraph is kept to the limit with an ellipsis", () => {
  const long = "Word after word goes on. ".repeat(80);
  const kept = quoteText(long);
  assert.ok(kept.cut);
  assert.ok(kept.text.length <= QUOTE_TEXT_MAX);
  assert.ok(kept.text.endsWith("…"));
  const record = makeQuote({ book: BOOK, title: "W", author: "A", chapter: 0, paragraph: 0, text: long, start: 0, end: long.length, now: 1 });
  assert.equal(record.cut, true);
  assert.equal(record.whole, true);
});

test("two devices' lists join by id, and a removal on either side wins", () => {
  const a = quote("q-aaaaaa", 0, 44, 10);
  const b = quote("q-bbbbbb", 45, 80, 20);
  const c = quote("q-cccccc", 81, 101, 30);
  const left = { quotes: [a, b], removed: [] };
  const right = { quotes: [a, c], removed: [{ id: "q-bbbbbb", removed: 25 }] };
  const merged = mergeQuoteBlobs(left, right);
  assert.deepEqual(merged.quotes.map((q) => q.id), ["q-aaaaaa", "q-cccccc"]);
  assert.deepEqual(merged.removed, [{ id: "q-bbbbbb", removed: 25 }]);
  // The same list in another order writes the same JSON.
  assert.deepEqual(mergeQuoteBlobs(right, left), merged);
});

test("the server reads a quotes row, files every quote under that book, and joins rows on push", () => {
  const a = quote("q-aaaaaa", 0, 44, 10);
  const item = normalizeItem({ kind: "quotes", itemId: BOOK, updatedAt: 10, deleted: false, data: { quotes: [{ ...a, book: "book:other|x" }, { id: "BAD", text: "x" }], removed: [] } }, 100);
  assert.ok(SYNC_KINDS.includes("quotes"));
  assert.equal(item.kind, "quotes");
  assert.equal(item.data.quotes.length, 1);
  assert.equal(item.data.quotes[0].book, BOOK);
  const other = { kind: "quotes", itemId: BOOK, updatedAt: 20, deleted: false, data: { quotes: [quote("q-bbbbbb", 45, 80, 20)], removed: [{ id: "q-aaaaaa", removed: 15 }] } };
  const merged = mergeItem(item, normalizeItem(other, 100));
  assert.deepEqual(merged.data.quotes.map((q) => q.id), ["q-bbbbbb"]);
  assert.equal(merged.updatedAt, 20);
  assert.equal(normalizeItem({ kind: "quotez", itemId: BOOK, updatedAt: 1, data: {} }), null);
});

test("this device's quotes go up as one row per book, after shelf and progress", () => {
  const other = bookSyncKey({ id: "c", title: "Charlotte's Web", author: "E. B. White" });
  const snapshot = captureSnapshot({
    books: [],
    words: [],
    progress: {},
    settings: {},
    quotes: [quote("q-aaaaaa", 0, 44, 10), { ...quote("q-cccccc", 0, 44, 12), book: other }],
    quotesRemoved: [{ id: "q-bbbbbb", book: BOOK, removed: 30 }],
  });
  const items = buildSyncItems(snapshot, emptyMeta()).filter((item) => item.kind === "quotes");
  assert.deepEqual(items.map((item) => item.itemId).sort(), [BOOK, other].sort());
  const row = items.find((item) => item.itemId === BOOK);
  assert.equal(row.updatedAt, 30);
  assert.deepEqual(row.data.removed, [{ id: "q-bbbbbb", removed: 30 }]);
  const order = syncBatches([...items, { kind: "settings", itemId: "main", updatedAt: 1, deleted: false, data: {} }]).flat();
  assert.equal(order[0].kind, "settings");
});

test("a full book row stays well under one upload", () => {
  const long = "Word after word goes on and on. ".repeat(60);
  const quotes = Array.from({ length: QUOTES_PER_BOOK * 2 }, (_, i) =>
    makeQuote({ id: `q-${String(i).padStart(6, "0")}`, book: BOOK, title: "Wonder", author: "R. J. Palacio", chapter: 1, paragraph: i, text: long, start: 0, end: long.length, now: i + 1 }),
  );
  const [row] = quoteRows(quotes, []);
  const blob = asQuoteBlob(row.blob, BOOK);
  assert.equal(blob.quotes.length, QUOTES_PER_BOOK * 2);
  assert.ok(JSON.stringify({ kind: "quotes", itemId: BOOK, data: blob }).length < SYNC_BODY_TARGET);
});
