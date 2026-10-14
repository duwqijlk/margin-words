/**
 * One pass from stored chapter html to the page the reader shows.
 * Words, phrase marks, and hyphenation share one document, so a chapter
 * change does not parse and serialize the chapter three times.
 */
import type { GlossarySense } from "./glossary-format.ts";
import { fillReadingRoot, markWordRangesOn } from "./glossary-format.ts";
import type { PhraseEntry } from "./glossary-extras.ts";
import { phraseWordRanges } from "./help-match.ts";
import { hyphenateReadingRoot } from "./hyphenate.ts";

const CACHE_LIMIT = 8;

const chapterCache = new WeakMap<object, WeakMap<object, Map<string, string>>>();

function chapterBucket(book: object, phrases: object): Map<string, string> {
  let byPhrase = chapterCache.get(book);
  if (!byPhrase) {
    byPhrase = new WeakMap();
    chapterCache.set(book, byPhrase);
  }
  let map = byPhrase.get(phrases);
  if (!map) {
    map = new Map();
    byPhrase.set(phrases, map);
  }
  return map;
}

export function peekChapterHtml(book: object, phrases: object, key: string): string | undefined {
  const map = chapterCache.get(book)?.get(phrases);
  if (!map) return undefined;
  const html = map.get(key);
  if (html === undefined) return undefined;
  map.delete(key);
  map.set(key, html);
  return html;
}

export function rememberChapterHtml(book: object, phrases: object, key: string, html: string): void {
  const map = chapterBucket(book, phrases);
  if (map.has(key)) map.delete(key);
  map.set(key, html);
  while (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function linkChapterHtml(
  html: string,
  ready: Set<string>,
  resolve: (surface: string) => string,
  chapter: number,
  sparse: Map<string, { senseOnly?: boolean; senses?: GlossarySense[] }>,
  tricky: ReadonlyMap<string, { senses?: GlossarySense[] }>,
  phrases?: Record<string, PhraseEntry> | null,
): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  fillReadingRoot(root, ready, resolve, chapter, sparse, tricky);
  if (phrases && Object.keys(phrases).length > 0) {
    markWordRangesOn(root, (paragraph) => phraseWordRanges(phrases, paragraph), "book-phrase");
  }
  hyphenateReadingRoot(root);
  return root.innerHTML;
}
