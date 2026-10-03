/**
 * The paragraph-level explanation of a word list (`paragraphs[]`, docs/GLOSSARY_FORMAT.md 7.1) and the one
 * rule for "which paragraph owns which note". The reader's lightbulb and the help panel both use it, so the
 * bulb is drawn exactly where the panel can open a real explanation, and nowhere else.
 *
 * A note has real text only when both `mainIdea` and `simple` are English text (an empty string, blanks, a
 * non-string or a value that holds Chinese is no text). Word entries, phrases and sentence help never make a
 * paragraph "explained". There is no minimum length: a one-line dialogue or a heading with a note has a bulb.
 *
 * A note belongs to ONE paragraph of the whole book (never borrowed by a second one). Numbered chapters and
 * extra spine files (`x0`, `x1`, …, including an appendix) are all part of that book. It is resolved in this order;
 * steps 1 and 2 skip a paragraph that already has an owner, step 3 does not:
 * 1. the paragraph with the note's own id (`paragraph`) in its own `chapter`, when its text contains the `context`.
 *    A chapter id such as `x2` names that extra, the same way a number names a numbered chapter;
 * 2. the paragraph of that chapter (or that extra) that contains the `context` and is nearest to the id;
 * 3. when the note's chapter does not exist or holds no match (an imported EPUB whose chapters are numbered or
 *    split differently), the whole book is searched, and the note is placed ONLY when exactly one paragraph in
 *    the whole book contains the `context`. Every matching paragraph is counted, in numbered chapters and in
 *    extras, also one that already owns notes. That one paragraph gets the note even if it owns others (a
 *    paragraph may own several notes; the first note placed is primary and the help panel shows it first). With
 *    no match, or two or more matches, the place is ambiguous: the note gets no paragraph (no lightbulb).
 * A short `context` ("Sora.") that is found in many paragraphs therefore lights at most the paragraph that its own
 * id and chapter name, never a guessed one.
 */
import { includesLoose } from "./flow-text.ts";
import type { ParagraphHelp } from "./glossary-extras.ts";
import { looseText } from "./help-match.ts";

export type ParagraphNote = {
  mainIdea: string;
  simple: string;
  hardWords: string[];
};

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/** Plain, trimmed, single-spaced English text, or "" for anything else. A list the user added may hold other writing. */
export const cleanNoteText = (value: unknown, max: number): string =>
  typeof value === "string" && !CJK.test(value)
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

/** The explanation held by one entry, or null when it lacks real text in `mainIdea` or `simple`. */
export function cleanParagraphNote(value: unknown): ParagraphNote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const mainIdea = cleanNoteText(row.mainIdea, 400);
  const simple = cleanNoteText(row.simple, 4000);
  if (!mainIdea || !simple) return null;
  const hardWords = Array.isArray(row.hardWords)
    ? row.hardWords
        .map((item) => cleanNoteText(item, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { mainIdea, simple, hardWords };
}

export type UnresolvedNote = (entry: ParagraphHelp, why: "no-match" | "ambiguous", matches: number) => void;

/**
 * The main owner of every paragraph of the book: `result[chapter][paragraph]` is the word-list entry that owns it,
 * or null. `chapters[c][i]` is the text of paragraph id `i` of chapter `c` (the numbering of `paragraphBlocks`); a
 * chapter that is `undefined` does not exist. Every entry with real text is placed on at most one paragraph.
 * A paragraph found by the whole-book step may already own another note: the new note then joins it (see
 * `resolveParagraphNoteLists` for all of them); the main owner is the note placed first.
 */
/** One extra spine file, in the same paragraph order the reader shows. `id` is `x0`, `x1`, …. */
export type SpineExtraTexts = { id: string; paragraphs: readonly string[] };

/** Notes placed across numbered chapters and extras. Each paragraph's list has the primary note first. */
export type PlacedParagraphNotes = {
  chapters: ParagraphHelp[][][];
  extras: Record<string, ParagraphHelp[][]>;
};

type NoteKey = number | string;

function placeParagraphNotes(
  list: readonly ParagraphHelp[],
  chapters: readonly (readonly string[] | undefined)[],
  extras: readonly SpineExtraTexts[],
  onUnresolved?: UnresolvedNote,
): PlacedParagraphNotes {
  const chapterRows: ParagraphHelp[][][] = chapters.map((texts) => (texts ?? []).map(() => []));
  const extraRows: Record<string, ParagraphHelp[][]> = {};
  const looseChapter = chapters.map((texts) => (texts ?? []).map((text) => looseText(text)));
  const looseExtra: Record<string, string[]> = {};
  for (const extra of extras) {
    if (!extra.id || extraRows[extra.id]) continue;
    extraRows[extra.id] = extra.paragraphs.map(() => []);
    looseExtra[extra.id] = extra.paragraphs.map((text) => looseText(text));
  }
  const ownersChapter: (ParagraphHelp | null)[][] = chapters.map((texts) => (texts ?? []).map(() => null));
  const ownersExtra: Record<string, (ParagraphHelp | null)[]> = {};
  for (const id of Object.keys(extraRows)) ownersExtra[id] = (extraRows[id] ?? []).map(() => null);

  const notes = list.filter((entry) => cleanParagraphNote(entry) !== null);
  if (notes.length === 0) return { chapters: chapterRows, extras: extraRows };

  const contexts = new Map<ParagraphHelp, string>(notes.map((entry) => [entry, looseText(entry.context)]));
  const textAt = (key: NoteKey, i: number): string =>
    typeof key === "number" ? (looseChapter[key]?.[i] ?? "") : (looseExtra[key]?.[i] ?? "");
  const fits = (entry: ParagraphHelp, key: NoteKey, i: number) => {
    const context = contexts.get(entry) ?? "";
    const text = textAt(key, i);
    return context !== "" && text !== "" && includesLoose(text, context);
  };
  const free = (key: NoteKey, i: number) =>
    typeof key === "number" ? ownersChapter[key]?.[i] === null : ownersExtra[key]?.[i] === null;
  const lengthOf = (key: NoteKey) =>
    typeof key === "number" ? (looseChapter[key]?.length ?? 0) : (looseExtra[key]?.length ?? 0);
  const exists = (entry: ParagraphHelp) =>
    typeof entry.chapter === "string"
      ? looseExtra[entry.chapter] !== undefined
      : Number.isInteger(entry.chapter) && entry.chapter >= 0 && chapters[entry.chapter] !== undefined;
  const claimed = new Set<ParagraphHelp>();
  const claim = (entry: ParagraphHelp, key: NoteKey, i: number) => {
    if (typeof key === "number") {
      (ownersChapter[key] as (ParagraphHelp | null)[])[i] ??= entry;
      chapterRows[key]?.[i]?.push(entry);
    } else {
      (ownersExtra[key] as (ParagraphHelp | null)[])[i] ??= entry;
      extraRows[key]?.[i]?.push(entry);
    }
    claimed.add(entry);
  };
  const near = (a: number, b: number) => Math.abs(a - (Number.isFinite(b) ? b : 0));

  for (const entry of notes) {
    const c = entry.chapter;
    const i = entry.paragraph;
    if (exists(entry) && Number.isInteger(i) && free(c, i) && fits(entry, c, i)) claim(entry, c, i);
  }
  for (const entry of notes) {
    if (claimed.has(entry) || !exists(entry)) continue;
    const c = entry.chapter;
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < lengthOf(c); i += 1) {
      if (!free(c, i) || !fits(entry, c, i)) continue;
      const gap = near(i, entry.paragraph);
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best >= 0) claim(entry, c, best);
  }
  for (const entry of notes) {
    if (claimed.has(entry)) continue;
    const found: Array<[NoteKey, number]> = [];
    for (let c = 0; c < looseChapter.length; c += 1) {
      const row = looseChapter[c] ?? [];
      for (let i = 0; i < row.length; i += 1) if (fits(entry, c, i)) found.push([c, i]);
    }
    for (const [id, row] of Object.entries(looseExtra)) {
      for (let i = 0; i < row.length; i += 1) if (fits(entry, id, i)) found.push([id, i]);
    }
    const only = found.length === 1 ? found[0] : undefined;
    if (only) claim(entry, only[0], only[1]);
    else onUnresolved?.(entry, found.length === 0 ? "no-match" : "ambiguous", found.length);
  }
  return { chapters: chapterRows, extras: extraRows };
}

function primaryOf(placed: PlacedParagraphNotes): {
  chapters: (ParagraphHelp | null)[][];
  extras: Record<string, (ParagraphHelp | null)[]>;
} {
  const extras: Record<string, (ParagraphHelp | null)[]> = {};
  for (const [id, rows] of Object.entries(placed.extras)) extras[id] = rows.map((notes) => notes[0] ?? null);
  return {
    chapters: placed.chapters.map((row) => row.map((notes) => notes[0] ?? null)),
    extras,
  };
}

export function resolveParagraphNotes(
  list: readonly ParagraphHelp[],
  chapters: readonly (readonly string[] | undefined)[],
  onUnresolved?: UnresolvedNote,
): (ParagraphHelp | null)[][] {
  return resolveParagraphNoteLists(list, chapters, onUnresolved).map((row) => row.map((notes) => notes[0] ?? null));
}

/** Every note of every paragraph: `result[chapter][paragraph]` lists its notes, the main owner first. */
export function resolveParagraphNoteLists(
  list: readonly ParagraphHelp[],
  chapters: readonly (readonly string[] | undefined)[],
  onUnresolved?: UnresolvedNote,
): ParagraphHelp[][][] {
  return placeParagraphNotes(list, chapters, [], onUnresolved).chapters;
}

/**
 * The same three steps as `resolveParagraphNoteLists`, counting extra spine files as chapters.
 * A note whose `chapter` is `x2` is placed inside that extra. The whole-book step counts a match in an
 * extra the same as a match in a numbered chapter.
 */
export function resolveParagraphNoteListsInBook(
  list: readonly ParagraphHelp[],
  chapters: readonly (readonly string[] | undefined)[],
  extras: readonly SpineExtraTexts[],
  onUnresolved?: UnresolvedNote,
): PlacedParagraphNotes {
  return placeParagraphNotes(list, chapters, extras, onUnresolved);
}

/** Primary owner of every paragraph, in numbered chapters and in extras. The primary is the note placed first. */
export function resolveParagraphNotesInBook(
  list: readonly ParagraphHelp[],
  chapters: readonly (readonly string[] | undefined)[],
  extras: readonly SpineExtraTexts[],
  onUnresolved?: UnresolvedNote,
): { chapters: (ParagraphHelp | null)[][]; extras: Record<string, (ParagraphHelp | null)[]> } {
  return primaryOf(placeParagraphNotes(list, chapters, extras, onUnresolved));
}

/**
 * For each paragraph text of one chapter (in paragraph order): the entry that owns it, or null. Only this
 * chapter is known here, so a note of another chapter can only land in it by step 3 (see above). The reader
 * resolves with the whole book (`resolveParagraphNotes`).
 */
export function paragraphNoteOwners(
  list: readonly ParagraphHelp[],
  chapter: number,
  texts: readonly string[],
): (ParagraphHelp | null)[] {
  const chapters: (readonly string[] | undefined)[] = [];
  chapters[chapter] = texts;
  return resolveParagraphNotes(list, chapters)[chapter] ?? texts.map(() => null);
}

/** The explanation of paragraph `index` of a chapter, or null. */
export function paragraphNoteAt(
  list: readonly ParagraphHelp[],
  chapter: number,
  texts: readonly string[],
  index: number,
): ParagraphNote | null {
  return cleanParagraphNote(paragraphNoteOwners(list, chapter, texts)[index] ?? null);
}

/** For each paragraph text of a chapter (in paragraph order): does it own an explanation? */
export function paragraphNoteFlags(
  list: readonly ParagraphHelp[],
  chapter: number,
  texts: readonly string[],
): boolean[] {
  return paragraphNoteOwners(list, chapter, texts).map((entry) => entry !== null);
}
