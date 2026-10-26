/**
 * Paragraph and sentence help. Everything is written ahead of time and comes from the book's
 * own word list (its book pack, or a list the user added). Nothing is made up while reading:
 * when the list has no note for a paragraph or sentence, the result is null and the screen
 * shows a friendly message.
 */
import { getParagraphHelp, getSentenceHelp, getSentenceNotesIn } from "@/lib/help-lookup";
import { cleanNoteText, cleanParagraphNote, type ParagraphNote } from "@/lib/paragraph-note";

export type ParagraphView = ParagraphNote;

export type SentenceView = {
  simple: string;
  grammar: string;
  /** Public id of the reader whose explanation this note uses. */
  credit?: string;
};

/** A sentence note shown in the paragraph panel: the words that name the sentence, then its help. */
export type SentenceInParagraph = SentenceView & { context: string };

/** What the bulb of one paragraph opens: its paragraph note, its sentence notes, or both. */
export type ParagraphHelpView = {
  paragraph: ParagraphView | null;
  sentences: SentenceInParagraph[];
};

const clean = cleanNoteText;

function asSentence(value: unknown): SentenceView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const simple = clean(row.simple, 800);
  // The easier sentence is the note; the grammar line is extra help and may be absent.
  if (!simple) return null;
  const grammar = clean(row.grammar, 300);
  const credit = typeof row.credit === "string" && /^[a-z0-9]{12}$/.test(row.credit) ? row.credit : undefined;
  return { simple, grammar, ...(credit ? { credit } : {}) };
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

/** Everything the bulb of paragraph `paragraph` opens, or null when it has no help at all. */
export async function loadParagraphHelpView(args: {
  bookId: string;
  chapter: number | string;
  paragraph: number;
  texts: readonly string[];
}): Promise<ParagraphHelpView | null> {
  const [paragraph, notes] = await Promise.all([
    loadParagraphView(args),
    getSentenceNotesIn(args.bookId, args.chapter, args.texts[args.paragraph] ?? "").catch(() => []),
  ]);
  const sentences: SentenceInParagraph[] = [];
  for (const note of notes) {
    const view = asSentence(note);
    const context = clean(note.context, 300);
    if (view && context) sentences.push({ ...view, context });
  }
  return paragraph || sentences.length ? { paragraph, sentences } : null;
}
