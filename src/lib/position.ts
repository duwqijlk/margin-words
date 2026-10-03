/**
 * File-independent places in a book.
 *
 * Two devices can hold slightly different EPUB files of the same edition (a re-packaged file, a different
 * paragraph split, a title page more or less). A raw position such as "chapter 3, 41% down" then lands in
 * different places, and a saved word's sentence cannot be found again. So a place is stored in a form that
 * does not depend on the file:
 *
 *   chapter, paragraph  the word list's own ids: the 0-based chapter and the 0-based paragraph in it, counted the
 *                       way docs/GLOSSARY_FORMAT.md sections 3.1 and 3.4 count (the same numbers the glossary's
 *                       `paragraphs[]` and `anchors[]` use)
 *   quote, offset       a short piece of the book's own text and where it starts inside that paragraph
 *
 * Each device resolves the place against the text it has imported: first the paragraph with that id, if the
 * quote is really in it; else the paragraph of that chapter that holds the quote, nearest to the id; else any
 * chapter that holds it, nearest to the chapter; else the nearest paragraph to the stored ids. No book file is
 * ever downloaded or replaced to make this work.
 *
 * Pure: no DOM, no store. Used by the app, by the sync merge (which only validates the shape) and the tests.
 */

export type TextAnchor = {
  /** 0-based chapter, as the app splits the book */
  chapter: number;
  /** 0-based paragraph inside that chapter (docs/GLOSSARY_FORMAT.md 3.4) */
  paragraph: number;
  /** up to 80 characters of the paragraph, copied as it reads */
  quote: string;
  /** where `quote` starts inside the paragraph text, in characters */
  offset: number;
};

export type Resolved = {
  chapter: number;
  paragraph: number;
  /** character offset of the quote inside the resolved paragraph (best effort) */
  offset: number;
  /**
   * paragraph: found at the stored ids; chapter: found elsewhere in the stored chapter; book: found in another
   * chapter; nearest: the quote is nowhere in this file, so the closest ids are used
   */
  via: "paragraph" | "chapter" | "book" | "nearest";
};

export const QUOTE_MAX = 80;
const QUOTE_MIN_MATCH = 14;

/** Letters and digits only, lower case, single spaces: a quote still matches after curly quotes or dashes change. */
export function normalizeQuote(text: string): string {
  return String(text ?? "")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .replace(/(\w)'(?=\w)/g, "$1\ue000")
    .replace(/[^a-z0-9\ue000]+/g, " ")
    .replace(/\ue000/g, "'")
    .trim();
}

const clampInt = (value: unknown, min: number, max: number): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, n));
};

/**
 * The place of `[at, at + length)` inside a paragraph. The quote is the stretch of text around it (whole words,
 * at most QUOTE_MAX characters), so it still identifies the paragraph when words elsewhere in it change.
 */
export function makeAnchor(input: {
  chapter: number;
  paragraph: number;
  text: string;
  at: number;
  length?: number;
}): TextAnchor {
  const text = input.text;
  const length = Math.max(0, input.length ?? 0);
  const at = clampInt(input.at, 0, Math.max(0, text.length));
  let start = Math.max(0, at - Math.floor((QUOTE_MAX - length) / 2));
  let end = Math.min(text.length, start + QUOTE_MAX);
  start = Math.max(0, Math.min(start, end - QUOTE_MAX));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at + length) end = space;
  }
  const quote = text.slice(start, end).replace(/\s+/g, " ").trim();
  return {
    chapter: clampInt(input.chapter, 0, 100_000),
    paragraph: clampInt(input.paragraph, 0, 1_000_000),
    quote,
    offset: start,
  };
}

/** Validate an anchor from storage or from the server. Returns null for anything that is not one. */
export function asAnchor(value: unknown): TextAnchor | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.quote !== "string") return null;
  const quote = raw.quote.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX + 20);
  if (normalizeQuote(quote).length < 3) return null;
  return {
    chapter: clampInt(raw.chapter, 0, 100_000),
    paragraph: clampInt(raw.paragraph, 0, 1_000_000),
    quote,
    offset: clampInt(raw.offset, 0, 1_000_000),
  };
}

/** Pieces of the quote to try, longest first: the whole quote, then each half (a small edit breaks only one). */
function needles(quote: string): string[] {
  const whole = normalizeQuote(quote);
  const words = whole.split(" ");
  const out = [whole];
  if (words.length >= 6) {
    const mid = Math.floor(words.length / 2);
    out.push(words.slice(0, mid).join(" "), words.slice(mid).join(" "));
  }
  return out.filter((piece) => piece.length >= QUOTE_MIN_MATCH || piece === whole);
}

const holds = (haystack: string, needle: string): boolean => needle !== "" && ` ${haystack} `.includes(` ${needle} `);

/**
 * Find a place on this device. `chapters[i][j]` is the text of paragraph j of chapter i of the imported book
 * (the reader's `chapter.paragraphs`). Never throws; an empty book gives chapter 0, paragraph 0.
 */
export function resolveAnchor(anchor: TextAnchor, chapters: ReadonlyArray<ReadonlyArray<string>>): Resolved {
  if (chapters.length === 0) return { chapter: 0, paragraph: 0, offset: 0, via: "nearest" };
  const home = Math.min(Math.max(0, anchor.chapter), chapters.length - 1);
  const wanted = needles(anchor.quote);
  const normalized = new Map<string, string>();
  const textOf = (c: number, p: number): string => {
    const key = `${c}:${p}`;
    let value = normalized.get(key);
    if (value === undefined) {
      value = normalizeQuote(chapters[c]?.[p] ?? "");
      normalized.set(key, value);
    }
    return value;
  };
  const where = (c: number, p: number): number => {
    const raw = chapters[c]?.[p] ?? "";
    const at = raw.indexOf(anchor.quote);
    return at >= 0 ? at : Math.min(anchor.offset, raw.length);
  };
  const finish = (c: number, p: number, via: Resolved["via"]): Resolved => ({
    chapter: c,
    paragraph: p,
    offset: where(c, p),
    via,
  });

  for (const needle of wanted) {
    const here = anchor.paragraph;
    if (here < (chapters[home]?.length ?? 0) && holds(textOf(home, here), needle)) return finish(home, here, "paragraph");
  }
  for (const needle of wanted) {
    let best = -1;
    const count = chapters[home]?.length ?? 0;
    for (let p = 0; p < count; p += 1) {
      if (!holds(textOf(home, p), needle)) continue;
      if (best < 0 || Math.abs(p - anchor.paragraph) < Math.abs(best - anchor.paragraph)) best = p;
    }
    if (best >= 0) return finish(home, best, "chapter");
  }
  const order = chapters
    .map((_, c) => c)
    .filter((c) => c !== home)
    .sort((a, b) => Math.abs(a - home) - Math.abs(b - home) || a - b);
  for (const needle of wanted) {
    for (const c of order) {
      const count = chapters[c]?.length ?? 0;
      let best = -1;
      for (let p = 0; p < count; p += 1) {
        if (!holds(textOf(c, p), needle)) continue;
        if (best < 0 || Math.abs(p - anchor.paragraph) < Math.abs(best - anchor.paragraph)) best = p;
      }
      if (best >= 0) return finish(c, best, "book");
    }
  }
  const last = Math.max(0, (chapters[home]?.length ?? 1) - 1);
  return { chapter: home, paragraph: Math.min(anchor.paragraph, last), offset: 0, via: "nearest" };
}

/** Does this paragraph hold the anchor's quote (loosely)? */
export function anchorFits(anchor: TextAnchor, paragraphText: string): boolean {
  const text = normalizeQuote(paragraphText);
  return needles(anchor.quote).some((needle) => holds(text, needle));
}

/**
 * Find a saved sentence in a book that has no stored place yet (words saved before places were stored).
 * Searches from `hintChapter` outwards. Returns the anchor of the paragraph, or null when it is not in the text.
 */
export function findSentence(
  sentence: string,
  surface: string,
  chapters: ReadonlyArray<ReadonlyArray<string>>,
  hintChapter?: number,
): TextAnchor | null {
  const wanted = needles(sentence.length > QUOTE_MAX ? sentence.slice(0, QUOTE_MAX) : sentence);
  if (wanted[0] === undefined || wanted[0].length < QUOTE_MIN_MATCH) return null;
  const start = typeof hintChapter === "number" ? Math.min(Math.max(0, hintChapter), chapters.length - 1) : 0;
  const order = chapters
    .map((_, c) => c)
    .sort((a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b);
  for (const needle of wanted) {
    for (const c of order) {
      const list = chapters[c] ?? [];
      for (let p = 0; p < list.length; p += 1) {
        const raw = list[p] ?? "";
        if (!holds(normalizeQuote(raw), needle)) continue;
        const exact = raw.indexOf(sentence.slice(0, 30));
        const at = exact >= 0 ? exact : Math.max(0, raw.toLowerCase().indexOf(surface.toLowerCase()));
        return makeAnchor({ chapter: c, paragraph: p, text: raw, at, length: surface.length });
      }
    }
  }
  return null;
}

export type ReadingPlace = {
  chapter: number;
  extraId?: string;
  anchor?: TextAnchor;
};

export type RestoredReading = {
  /** "" when the open page is a numbered chapter. */
  extraId: string;
  chapter: number;
  /** Paragraph to scroll to. Null means use the saved scroll fraction instead. */
  paragraph: number | null;
};

/**
 * Where to reopen a saved reading position.
 * An `extraId` that names an extra in this book wins: the anchor is resolved only inside that extra,
 * so a quote that also appears in a numbered chapter does not leave the extra. With no extra (or an id
 * this book does not have), the anchor is resolved across numbered chapters. A place with neither field
 * stays on `chapter` and uses the scroll fraction.
 */
export function restoreReadingPlace(
  saved: ReadingPlace | null | undefined,
  book: {
    chapters: ReadonlyArray<ReadonlyArray<string>>;
    extras?: ReadonlyArray<{ id: string; paragraphs: readonly string[] }>;
  },
): RestoredReading {
  const chapter = saved && Number.isFinite(saved.chapter) ? Math.max(0, Math.floor(saved.chapter)) : 0;
  const extra = saved?.extraId ? book.extras?.find((item) => item.id === saved.extraId) : undefined;
  if (extra) {
    let paragraph: number | null = null;
    if (saved?.anchor && extra.paragraphs.length > 0) {
      const hit = resolveAnchor(saved.anchor, [extra.paragraphs]);
      if (hit.via !== "nearest") paragraph = hit.paragraph;
    }
    return { extraId: extra.id, chapter, paragraph };
  }
  if (saved?.anchor && book.chapters.length > 0) {
    const hit = resolveAnchor(saved.anchor, book.chapters);
    if (hit.via !== "nearest") return { extraId: "", chapter: hit.chapter, paragraph: hit.paragraph };
  }
  return { extraId: "", chapter, paragraph: null };
}

/**
 * A place made only from a sentence, for words saved before places were stored. The reader searches the whole
 * book for the sentence (starting at `chapter`), so this still finds a spot when the paragraph id is unknown.
 */
export function sentenceAnchor(sentence: string, chapter = 0): TextAnchor {
  const quote = sentence.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
  return { chapter: clampInt(chapter, 0, 100_000), paragraph: 0, quote, offset: 0 };
}
