/**
 * Quotes: sentences and paragraphs a reader keeps from a book. Separate from the wordbook: no
 * review schedule, only the text, where it is, and when it was kept.
 *
 * Both the text and the place are stored. The text is what the quote book shows (it needs no book
 * file); the place takes the reader back to it. The place is the same file-independent anchor the
 * reading place uses (position.ts): chapter and paragraph ids plus a short piece of the paragraph,
 * so another device with a slightly different copy of the book still finds the sentence.
 *
 * Sync: one item per book (kind `quotes`, item id = bookSyncKey), so a reader who keeps quotes from
 * one book rewrites one small row, never a row that grows with the whole library. A quote never
 * changes after it is kept; removing one leaves a tombstone, and two devices' lists are joined by id.
 *
 * Pure: no DOM, no store. Used by the app, by the sync merge on the server, and by the tests.
 */
import { asAnchor, makeAnchor, normalizeQuote, QUOTE_MAX, type TextAnchor } from "./position.ts";
import { QUOTE_TEXT_MAX, QUOTES_PER_BOOK } from "./limits.ts";
import { sentenceAround } from "./note-sentence.ts";

export type QuoteRecord = {
  /** random, from the device that kept it */
  id: string;
  /** bookSyncKey of the book */
  book: string;
  title: string;
  author: string;
  /** 0-based chapter, as the app splits the book */
  chapter: number;
  chapterTitle?: string;
  /** 0-based paragraph in that chapter (docs/GLOSSARY_FORMAT.md 3.4) */
  paragraph: number;
  /** [start, end) of the quote inside the paragraph text */
  start: number;
  end: number;
  /** the quote as the book has it, at most QUOTE_TEXT_MAX characters */
  text: string;
  /** the whole paragraph (shown with a "paragraph" tag) */
  whole?: true;
  /** the paragraph was longer than QUOTE_TEXT_MAX: `text` ends with an ellipsis */
  cut?: true;
  /** where it is, found again in another copy of the book the way a reading place is */
  at: TextAnchor;
  savedAt: number;
};

/** A quote taken away. Kept so a pull from another device does not bring it back. */
export type QuoteGone = { id: string; removed: number };

/** One book's quotes as a sync item's data. */
export type QuoteBlob = { quotes: QuoteRecord[]; removed: QuoteGone[] };

/**
 * A book row holds at most this many: twice the per-book limit, so two devices that each kept many
 * quotes offline still keep all of them when they meet. Adding stops at QUOTES_PER_BOOK.
 */
export const QUOTE_BLOB_MAX = QUOTES_PER_BOOK * 2;
/** Tombstones kept per book, newest first. */
export const QUOTE_GONE_MAX = 500;

const QUOTE_ID = /^[a-z0-9][a-z0-9-]{5,47}$/;

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 9_000_000_000_000);
}

function int(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** A new quote id: random, lower case, safe in the item data. */
export function newQuoteId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

/**
 * The quote text to keep: spaces folded; a longer text is cut at a word end and marked with an
 * ellipsis. `cut` says whether it was.
 */
export function quoteText(raw: string): { text: string; cut: boolean } {
  const folded = raw.replace(/\s+/g, " ").trim();
  if (folded.length <= QUOTE_TEXT_MAX) return { text: folded, cut: false };
  let end = folded.lastIndexOf(" ", QUOTE_TEXT_MAX - 1);
  if (end < QUOTE_TEXT_MAX / 2) end = QUOTE_TEXT_MAX - 1;
  return { text: `${folded.slice(0, end).trimEnd()}…`, cut: true };
}

/** Validate one quote from storage or from the server. `book` is the row it came in, when known. */
export function asQuote(value: unknown, book?: string): QuoteRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!QUOTE_ID.test(id)) return null;
  const key = book ?? text(raw.book, 200);
  if (!key) return null;
  const body = text(raw.text, QUOTE_TEXT_MAX + 1);
  if (normalizeQuote(body).length < 2) return null;
  const chapter = int(raw.chapter, 0, 100_000);
  const paragraph = int(raw.paragraph, 0, 1_000_000);
  const start = int(raw.start, 0, 10_000_000);
  const end = Math.max(start, int(raw.end, 0, 10_000_000));
  const at =
    asAnchor(raw.at) ??
    asAnchor({ chapter, paragraph, quote: body.slice(0, QUOTE_MAX), offset: start }) ?? {
      chapter,
      paragraph,
      quote: body.slice(0, QUOTE_MAX),
      offset: start,
    };
  const out: QuoteRecord = {
    id,
    book: key,
    title: text(raw.title, 300),
    author: text(raw.author, 300),
    chapter,
    paragraph,
    start,
    end,
    text: body,
    at,
    savedAt: time(raw.savedAt),
  };
  const chapterTitle = text(raw.chapterTitle, 200);
  if (chapterTitle) out.chapterTitle = chapterTitle;
  if (raw.whole === true) out.whole = true;
  if (raw.cut === true) out.cut = true;
  return out;
}

function asGone(value: unknown): QuoteGone | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!QUOTE_ID.test(id)) return null;
  return { id, removed: time(raw.removed) };
}

const byTime = (a: QuoteRecord, b: QuoteRecord) => a.savedAt - b.savedAt || a.id.localeCompare(b.id);

/**
 * One book row in a stable order (oldest first, tombstones by id), so the same list always writes
 * the same JSON and sync can tell "unchanged" by comparing it. Over the limits the oldest quotes
 * and the oldest tombstones go first.
 */
function tidy(quotes: Iterable<QuoteRecord>, removed: Iterable<QuoteGone>): QuoteBlob {
  const gone = new Map<string, number>();
  for (const row of removed) gone.set(row.id, Math.max(gone.get(row.id) ?? 0, row.removed));
  const byId = new Map<string, QuoteRecord>();
  for (const quote of quotes) {
    if (gone.has(quote.id)) continue;
    const prior = byId.get(quote.id);
    // A quote never changes; the same id twice is the same quote. Keep the earlier one.
    if (!prior || quote.savedAt < prior.savedAt) byId.set(quote.id, quote);
  }
  const kept = [...byId.values()].sort(byTime).slice(-QUOTE_BLOB_MAX);
  const stones = [...gone]
    .map(([id, at]) => ({ id, removed: at }))
    .sort((a, b) => b.removed - a.removed || a.id.localeCompare(b.id))
    .slice(0, QUOTE_GONE_MAX)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { quotes: kept, removed: stones };
}

/** Validate one book row. Every quote is filed under `book` (the row's item id). */
export function asQuoteBlob(data: unknown, book: string): QuoteBlob {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const quotes: QuoteRecord[] = [];
  if (Array.isArray(raw.quotes)) {
    for (const value of raw.quotes.slice(0, QUOTE_BLOB_MAX * 2)) {
      const quote = asQuote(value, book);
      if (quote) quotes.push(quote);
    }
  }
  const removed: QuoteGone[] = [];
  if (Array.isArray(raw.removed)) {
    for (const value of raw.removed.slice(0, QUOTE_GONE_MAX * 2)) {
      const row = asGone(value);
      if (row) removed.push(row);
    }
  }
  return tidy(quotes, removed);
}

/** Two devices' rows for one book: every quote either kept, less the ones either took away. */
export function mergeQuoteBlobs(left: QuoteBlob, right: QuoteBlob): QuoteBlob {
  return tidy([...left.quotes, ...right.quotes], [...left.removed, ...right.removed]);
}

/** The time of a row: its newest quote or tombstone. */
export function quoteBlobTime(blob: QuoteBlob): number {
  let at = 0;
  for (const quote of blob.quotes) at = Math.max(at, quote.savedAt);
  for (const row of blob.removed) at = Math.max(at, row.removed);
  return at;
}

/** A local tombstone also names its book, so it goes into the right row. */
export type LocalQuoteGone = QuoteGone & { book: string };

/** This device's quotes as rows, one per book that has any quote or tombstone. */
export function quoteRows(
  quotes: readonly QuoteRecord[],
  removed: readonly LocalQuoteGone[],
): Array<{ book: string; blob: QuoteBlob; updatedAt: number }> {
  const books = new Map<string, { quotes: QuoteRecord[]; removed: QuoteGone[] }>();
  const slot = (book: string) => {
    const found = books.get(book) ?? { quotes: [], removed: [] };
    books.set(book, found);
    return found;
  };
  for (const quote of quotes) slot(quote.book).quotes.push(quote);
  for (const row of removed) slot(row.book).removed.push({ id: row.id, removed: row.removed });
  return [...books]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([book, rows]) => {
      const blob = tidy(rows.quotes, rows.removed);
      return { book, blob, updatedAt: quoteBlobTime(blob) };
    });
}

/**
 * Quotes that sit next to each other in one paragraph are one quote: picking three sentences in a
 * row keeps them as one passage. `gap` is the text between two spans; only white space joins them.
 */
export function joinSpans<T extends { paragraph: number; start: number; end: number }>(
  spans: readonly T[],
  gap: (paragraph: number, from: number, to: number) => string,
): Array<{ paragraph: number; start: number; end: number }> {
  const sorted = [...spans].sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
  const out: Array<{ paragraph: number; start: number; end: number }> = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && last.paragraph === span.paragraph && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    if (last && last.paragraph === span.paragraph && !gap(span.paragraph, last.end, span.start).trim()) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    out.push({ paragraph: span.paragraph, start: span.start, end: span.end });
  }
  return out;
}

/** The sentences of a paragraph as [start, end) spans, cut the way a tapped word's sentence is. */
export function sentenceSpans(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /\s/.test(text[at] ?? "")) at += 1;
    if (at >= text.length) break;
    const span = sentenceAround(text, at, at);
    const start = Math.max(at, span.start);
    const end = span.end > start ? span.end : text.length;
    out.push({ start, end });
    at = end;
  }
  return out;
}

/**
 * The span to keep for a selection [from, to) of a paragraph: the whole sentences it touches. A
 * selection that already ends on a full stop does not reach into the next sentence.
 */
export function sentencesOf(text: string, from: number, to: number): { start: number; end: number } {
  const last = Math.max(from, to - 1);
  const head = sentenceAround(text, from, from);
  const tail = sentenceAround(text, last, last);
  return { start: head.start, end: Math.max(head.start, tail.end) };
}

/** Does the span [start, end) hold the whole paragraph `text` (more than one sentence)? */
export function wholeParagraph(text: string, start: number, end: number): boolean {
  const body = text.trim();
  if (!body) return false;
  const lead = text.length - text.trimStart().length;
  return start <= lead && end >= lead + body.length && sentenceSpans(text).length > 1;
}

/**
 * A quote of [start, end) of one paragraph, ready to keep. `text` is the paragraph as the reader
 * shows it; the anchor starts at the quote, so the place found again is the quote's own start.
 */
export function makeQuote(input: {
  book: string;
  title: string;
  author: string;
  chapter: number;
  chapterTitle?: string;
  paragraph: number;
  text: string;
  start: number;
  end: number;
  now: number;
  id?: string;
}): QuoteRecord {
  const start = Math.max(0, Math.min(input.start, input.text.length));
  const end = Math.max(start, Math.min(input.end, input.text.length));
  const kept = quoteText(input.text.slice(start, end));
  const quote: QuoteRecord = {
    id: input.id ?? newQuoteId(),
    book: input.book,
    title: input.title.replace(/\s+/g, " ").trim().slice(0, 300),
    author: input.author.replace(/\s+/g, " ").trim().slice(0, 300),
    chapter: input.chapter,
    paragraph: input.paragraph,
    start,
    end,
    text: kept.text,
    at: makeAnchor({
      chapter: input.chapter,
      paragraph: input.paragraph,
      text: input.text,
      at: start,
      length: Math.min(end - start, QUOTE_MAX / 2),
    }),
    savedAt: input.now,
  };
  const chapterTitle = (input.chapterTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (chapterTitle) quote.chapterTitle = chapterTitle;
  if (wholeParagraph(input.text, start, end)) quote.whole = true;
  if (kept.cut) quote.cut = true;
  return quote;
}
