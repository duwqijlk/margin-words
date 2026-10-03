/**
 * Paragraph help, sentence help and phrase lookup for the reader.
 * Hook-free API: plain async functions. The data comes from the word list that was
 * loaded into the book (the book pack's list, or a list the user added); see saveBookExtras.
 * Nothing here goes online.
 * The matching rules themselves are in help-match.ts (pure, unit tested).
 */
import { extrasRevision, loadBookExtras, loadStoredBook, type BookExtras, type StoredChapter } from "@/lib/book-db";
import { flowText } from "@/lib/flow-text";
import type { ParagraphHelp, PhraseEntry, SentenceHelp } from "@/lib/glossary-extras";
import { paragraphBlocks, pickPhrase, pickSentenceHelp } from "@/lib/help-match";
import { resolveParagraphNotesInBook } from "@/lib/paragraph-note";

export type { ParagraphHelp, PhraseEntry, SentenceHelp };
/** The paragraph numbering rule (position among the chapter's paragraph blocks). See docs/GLOSSARY_FORMAT.md section 3.4. */
export { paragraphBlocks } from "@/lib/help-match";

const memory = new Map<string, { rev: number; data: Promise<BookExtras | null> }>();

function extrasOf(bookId: string): Promise<BookExtras | null> {
  const rev = extrasRevision(bookId);
  const known = memory.get(bookId);
  if (known && known.rev === rev) return known.data;
  const data = loadBookExtras(bookId).catch(() => null);
  memory.set(bookId, { rev, data });
  return data;
}

/** The text of every paragraph of a stored chapter, numbered the way the reader and the word lists number them. */
function chapterTexts(chapter: Pick<StoredChapter, "html" | "paragraphs">): string[] {
  if (chapter.html && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(`<div>${chapter.html}</div>`, "text/html");
    return paragraphBlocks(doc.body).map((block) => flowText(block));
  }
  return chapter.paragraphs ?? [];
}

type StoredTexts = {
  chapters: string[][];
  extras: { id: string; paragraphs: string[] }[];
};

const bookTexts = new Map<string, { rev: number; data: Promise<StoredTexts | null> }>();

function textsOf(bookId: string): Promise<StoredTexts | null> {
  const rev = extrasRevision(bookId);
  const known = bookTexts.get(bookId);
  if (known && known.rev === rev) return known.data;
  const data = loadStoredBook(bookId)
    .then((book) =>
      book
        ? {
            chapters: book.chapters.map(chapterTexts),
            extras: (book.extras ?? []).map((extra) => ({ id: extra.id, paragraphs: chapterTexts(extra) })),
          }
        : null,
    )
    .catch(() => null);
  bookTexts.set(bookId, { rev, data });
  return data;
}

const reported = new Set<string>();

/** Development only: say once which paragraph note found no single paragraph (and so has no lightbulb). */
function reportUnresolved(bookId: string, entry: ParagraphHelp, why: string, matches: number): void {
  const key = `${bookId}|${entry.chapter}|${entry.paragraph}|${entry.context}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(
    `[paragraph notes] no lightbulb for the note at chapter ${entry.chapter}, paragraph ${entry.paragraph} ` +
      `("${entry.context.slice(0, 60)}"): ${why}${matches ? ` (${matches} matching paragraphs in the book)` : ""}`,
  );
}

/**
 * The paragraph notes of the book, resolved over ALL chapters and extra spine files (each note has one
 * paragraph, see paragraph-note.ts), as the owners of the chapter on screen. `chapter` is a 0-based index or
 * an extra id such as `x2`. `texts` is that chapter as the reader shows it; it replaces the stored copy when
 * the two differ, so the paragraph numbers always fit the screen.
 */
async function noteOwnersOf(
  bookId: string,
  chapter: number | string,
  texts: readonly string[],
): Promise<(ParagraphHelp | null)[]> {
  const extras = await extrasOf(bookId);
  if (!extras?.paragraphs.length) return texts.map(() => null);
  const stored = await textsOf(bookId);
  const chapters: (readonly string[] | undefined)[] = stored ? [...stored.chapters] : [];
  const spine = stored ? stored.extras.map((extra) => ({ id: extra.id, paragraphs: [...extra.paragraphs] })) : [];
  if (typeof chapter === "string") {
    const at = spine.findIndex((extra) => extra.id === chapter);
    if (at >= 0) spine[at] = { id: chapter, paragraphs: [...texts] };
    else spine.push({ id: chapter, paragraphs: [...texts] });
  } else {
    chapters[chapter] = texts;
  }
  const placed = resolveParagraphNotesInBook(
    extras.paragraphs,
    chapters,
    spine,
    import.meta.env.DEV ? (entry, why, matches) => reportUnresolved(bookId, entry, why, matches) : undefined,
  );
  if (typeof chapter === "string") return placed.extras[chapter] ?? texts.map(() => null);
  return placed.chapters[chapter] ?? texts.map(() => null);
}

/**
 * Help for the whole paragraph the reader shows, or null. `paragraph` is 0-based (see docs/GLOSSARY_FORMAT.md)
 * and `texts` holds the text of every paragraph of the chapter, so a note is given only to the paragraph that
 * owns it (the same rule as the lightbulb, see paragraph-note.ts).
 */
export async function getParagraphHelp(
  bookId: string,
  chapter: number | string,
  paragraph: number,
  texts: readonly string[],
): Promise<ParagraphHelp | null> {
  try {
    return (await noteOwnersOf(bookId, chapter, texts))[paragraph] ?? null;
  } catch {
    return null;
  }
}

/** For each paragraph text of a chapter: does that paragraph own a real paragraph explanation of the word list? */
export async function getParagraphNoteFlags(
  bookId: string,
  chapter: number | string,
  texts: readonly string[],
): Promise<boolean[]> {
  try {
    return (await noteOwnersOf(bookId, chapter, texts)).map((owner) => owner !== null);
  } catch {
    return texts.map(() => false);
  }
}

/** Help for one sentence, or null. Matches by the `context` snippet inside the sentence. */
export async function getSentenceHelp(
  bookId: string,
  chapter: number | string,
  sentenceText: string,
): Promise<SentenceHelp | null> {
  try {
    const extras = await extrasOf(bookId);
    if (!extras?.sentences.length) return null;
    return pickSentenceHelp(extras.sentences, chapter, sentenceText);
  } catch {
    return null;
  }
}

/**
 * The listed phrase (phrasal verb or idiom) that the tapped word is part of in this sentence, or null.
 * `tappedAt` is the character offset of that word inside `sentenceText`, so a sentence with two
 * phrases that share a word can show the one that covers the tap. The span is every token from
 * the first matched word through the last, including a gap. A tap outside that span does not
 * open the phrase.
 * `matched` is the text of the phrase as written in the sentence (from its first to its last word).
 */
export async function findPhrase(
  bookId: string,
  sentenceText: string,
  tappedWord: string,
  tappedAt?: number,
): Promise<{ key: string; entry: PhraseEntry; matched: string } | null> {
  try {
    const extras = await extrasOf(bookId);
    if (!extras || Object.keys(extras.phrases).length === 0) return null;
    return pickPhrase(extras.phrases, sentenceText, tappedWord, tappedAt);
  } catch {
    return null;
  }
}

/** Does this book have any paragraph, sentence or phrase help at all? */
export async function hasHelpData(bookId: string): Promise<boolean> {
  const extras = await extrasOf(bookId);
  return Boolean(
    extras &&
    (extras.paragraphs.length || extras.sentences.length || Object.keys(extras.phrases).length),
  );
}
