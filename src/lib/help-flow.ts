/**
 * Paragraph and sentence help. Everything is written ahead of time and comes from the book's
 * own word list (its book pack, or a list the user added). Nothing is made up while reading:
 * when the list has no note for a paragraph or sentence, the result is null and the screen
 * shows a friendly message.
 */
import { getParagraphHelp, getSentenceHelp } from "@/lib/help-lookup";

export type ParagraphView = {
  mainIdea: string;
  simple: string;
  hardWords: string[];
};

export type SentenceView = {
  simple: string;
  grammar: string;
};

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
// A list the user added may hold other writing; the notes shown to the learner stay English.
const clean = (value: unknown, max: number): string =>
  typeof value === "string" && !CJK.test(value)
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

function asParagraph(value: unknown): ParagraphView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const mainIdea = clean(row.mainIdea, 400);
  const simple = clean(row.simple, 4000);
  if (!mainIdea || !simple) return null;
  const hardWords = Array.isArray(row.hardWords)
    ? row.hardWords
        .map((item) => clean(item, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { mainIdea, simple, hardWords };
}

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
  chapter: number;
  paragraph: number;
  text: string;
}): Promise<ParagraphView | null> {
  try {
    return asParagraph(
      await getParagraphHelp(args.bookId, args.chapter, args.paragraph, args.text),
    );
  } catch {
    return null;
  }
}

export async function loadSentenceView(args: {
  bookId: string;
  chapter: number;
  text: string;
}): Promise<SentenceView | null> {
  try {
    return asSentence(await getSentenceHelp(args.bookId, args.chapter, args.text));
  } catch {
    return null;
  }
}
