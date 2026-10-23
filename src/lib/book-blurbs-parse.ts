/**
 * Book summaries shown in the Discover detail sheet, one table per interface language.
 * The files are docs/blurbs/zh.json and docs/blurbs/en.json (Chinese may only live in docs/):
 *
 *   { "format": 1, "books": { "<book id>": "summary text" } }
 *
 * A book id is a pack id from packs/ or public-books/. Plain text only: it is drawn as text,
 * never as HTML. Pure, so it is tested alone.
 */
export type BlurbTable = Record<string, string>;

/** Longest summary kept. A longer one is cut, so a mistake cannot fill the sheet. */
export const BLURB_MAX = 600;
const BOOK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function parseBlurbs(value: unknown): BlurbTable {
  const out: BlurbTable = {};
  if (!value || typeof value !== "object") return out;
  const books = (value as { books?: unknown }).books;
  if (!books || typeof books !== "object" || Array.isArray(books)) return out;
  for (const [id, raw] of Object.entries(books as Record<string, unknown>)) {
    if (!BOOK_ID.test(id) || typeof raw !== "string") continue;
    const text = raw.replace(/\s+/g, " ").trim().slice(0, BLURB_MAX);
    if (text) out[id] = text;
  }
  return out;
}
