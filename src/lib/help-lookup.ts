/**
 * Paragraph help, sentence help and phrase lookup for the reader.
 * Hook-free API: plain async functions. The data comes from the word list that was
 * loaded into the book (the book pack's list, or a list the user added); see saveBookExtras.
 * Nothing here goes online.
 * The matching rules themselves are in help-match.ts (pure, unit tested).
 */
import { extrasRevision, loadBookExtras, type BookExtras } from "@/lib/book-db";
import type { ParagraphHelp, PhraseEntry, SentenceHelp } from "@/lib/glossary-extras";
import { pickParagraphHelp, pickPhrase, pickSentenceHelp } from "@/lib/help-match";

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

/** Help for the whole paragraph the reader shows, or null. `paragraph` is 0-based (see docs/GLOSSARY_FORMAT.md). */
export async function getParagraphHelp(
  bookId: string,
  chapter: number,
  paragraph: number,
  paragraphText: string,
): Promise<ParagraphHelp | null> {
  try {
    const extras = await extrasOf(bookId);
    if (!extras?.paragraphs.length) return null;
    return pickParagraphHelp(extras.paragraphs, chapter, paragraph, paragraphText);
  } catch {
    return null;
  }
}

/** Help for one sentence, or null. Matches by the `context` snippet inside the sentence. */
export async function getSentenceHelp(
  bookId: string,
  chapter: number,
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
 * phrases that share a word can show the one that covers the tap.
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
