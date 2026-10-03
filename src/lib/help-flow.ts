/**
 * Paragraph and sentence help. Everything is written ahead of time and comes from the book's
 * own word list (its book pack, or a list the user added). Nothing is made up while reading:
 * when the list has no note for a paragraph or sentence, the result is null and the screen
 * shows a friendly message.
 */
import { getParagraphHelp, getSentenceHelp } from "@/lib/help-lookup";
import { cleanNoteText, cleanParagraphNote, type ParagraphNote } from "@/lib/paragraph-note";

export type ParagraphView = ParagraphNote;

export type SentenceView = {
  simple: string;
  grammar: string;
};

const clean = cleanNoteText;

function asSentence(value: unknown): SentenceView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const simple = clean(row.simple, 800);
  const grammar = clean(row.grammar, 300);
  if (!simple || !grammar) return null;
  return { simple, grammar };
}

export async function loadParagraphView(args: {
  bookId: string;
  chapter: number | string;
  paragraph: number;
  /** the text of every paragraph of the chapter, in paragraph order */
  texts: readonly string[];
}): Promise<ParagraphView | null> {
  try {
    return cleanParagraphNote(
      await getParagraphHelp(args.bookId, args.chapter, args.paragraph, args.texts),
    );
  } catch {
    return null;
  }
}

export async function loadSentenceView(args: {
  bookId: string;
  chapter: number | string;
  text: string;
}): Promise<SentenceView | null> {
  try {
    return asSentence(await getSentenceHelp(args.bookId, args.chapter, args.text));
  } catch {
    return null;
  }
}
