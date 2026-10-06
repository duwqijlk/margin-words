import type { GlossPoint } from "./gloss-point.ts";
import type { TextAnchor } from "./position.ts";

export type { GlossPoint };

export type AnalyzedWord = {
  surface: string;
  lemma: string;
  pos: string;
  meaning: string;
  whyHard: string;
  recommend: boolean;
  sentence: string;
  seen?: number;
  uses?: string;
};

export type Cloth = "cloth" | "ribbon" | "ink" | "sage";

export type Book = {
  id: string;
  title: string;
  author: string;
  cloth: Cloth;
  createdAt: number;
  updatedAt: number;
  source?: "epub" | "notes";
  /** Lexile measure for this edition, such as "880L". Absent when the book has none. */
  lexile?: string;
  /** ISBN-13 of this edition. Absent when the edition is not known. */
  isbn?: string;
  /** Series title. Absent when the book is not in a series. */
  series?: string;
  /** 1-based place in `series`. */
  seriesNumber?: number;
  /** Percent of the word list's snippets found in the reader's own e-book. */
  matchRate?: number;
  /** The word list is on the shelf, and the reader still needs to add their own e-book. */
  needsEpub?: boolean;
  /** The English is too old for a beginner. Absent when the book is not flagged. */
  oldFashioned?: boolean;
  /** Short English reason from the catalog. Book content, so it stays English. */
  oldFashionedReason?: string;
};

/**
 * Where a saved word was met. A word can have several (one per book it was saved from). The book is named by
 * its sync key (title and author), not by this device's shelf card, so it means the same on every device.
 *
 * A save keeps the sentence, so the notebook can show that paragraph. The meaning is read from the word
 * list when this device has it, so a later edit to the list replaces the explanation. An older save may
 * still carry `title` and `at` as well.
 */
export type WordSource = {
  /** `bookSyncKey` of the book: the same on every device */
  book: string;
  /** book title and author as they were when the word was saved (kept even if the book leaves the shelf) */
  title?: string;
  author?: string;
  /** 0-based chapter, when known (words saved by older versions have none until the book is opened) */
  chapter?: number;
  chapterTitle?: string;
  /** the sentence that holds the word, shown on the notebook card */
  sentence?: string;
  /** the word as it was written there */
  surface: string;
  /** the meaning that fitted that sentence, when it differs from the card's meaning */
  meaning?: string;
  pos?: string;
  /** file-independent place of the word in the book (docs: src/lib/position.ts). Not set on a `ref` save. */
  at?: TextAnchor;
  savedAt: number;
  /** Where this word sits in a word list. The list, not this field, holds the snippet. */
  ref?: GlossPoint;
};

export type VocabEntry = AnalyzedWord & {
  id: string;
  /**
   * Old per-book field, kept so an older build of the app still shows the word. The wordbook is global:
   * the books a word came from are in `sources`.
   */
  bookId?: string;
  /** where the word was met; never empty for a word saved by this version */
  sources: WordSource[];
  /**
   * Spaced-repetition stage: 0 = new (or forgotten), 1..6 = number of successful
   * reviews on the 1/2/4/7/15/30-day ladder, 7 = mastered. See `lib/srs.ts`.
   */
  stage: number;
  dueAt: number;
  createdAt: number;
  /** successful and failed answers over the life of the card */
  reps: number;
  lapses: number;
  lastReviewedAt?: number;
};

export const POS_LABELS: ReadonlySet<string> = new Set([
  "singular noun",
  "plural noun",
  "uncountable noun",
  "adjective",
  "comparative adjective",
  "superlative adjective",
  "adverb",
  "base verb",
  "third-person verb",
  "past-tense verb",
  "present participle",
  "past participle",
  "modal verb",
  "pronoun",
  "preposition",
  "conjunction",
  "determiner",
  "gerund",
  "interjection",
]);

const POS_ALIAS: Record<string, string> = {
  noun: "singular noun",
  "countable noun": "singular noun",
  "common noun": "singular noun",
  plural: "plural noun",
  "plural form": "plural noun",
  "plural noun form": "plural noun",
  nouns: "plural noun",
  "noun plural": "plural noun",
  "plural nouns": "plural noun",
  uncountable: "uncountable noun",
  "mass noun": "uncountable noun",
  adj: "adjective",
  "comparative adjective": "comparative adjective",
  "adjective comparative": "comparative adjective",
  comparative: "comparative adjective",
  "superlative adjective": "superlative adjective",
  superlative: "superlative adjective",
  adv: "adverb",
  verb: "base verb",
  "base form": "base verb",
  infinitive: "base verb",
  "bare infinitive": "base verb",
  "third person verb": "third-person verb",
  "third-person singular": "third-person verb",
  "third person singular": "third-person verb",
  "present tense": "third-person verb",
  "past tense": "past-tense verb",
  "past tense verb": "past-tense verb",
  "simple past": "past-tense verb",
  "past simple": "past-tense verb",
  "past-tense": "past-tense verb",
  "present participle verb": "present participle",
  "v-ing": "present participle",
  "past participle verb": "past participle",
  modal: "modal verb",
  prep: "preposition",
  conj: "conjunction",
  article: "determiner",
  numeral: "determiner",
  number: "determiner",
};

const EASY = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "am",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "by",
  "as",
  "he",
  "she",
  "it",
  "they",
  "we",
  "i",
  "you",
  "his",
  "her",
  "their",
  "my",
  "this",
  "that",
  "these",
  "those",
  "very",
  "not",
  "but",
  "so",
  "if",
  "when",
]);

export function normalizePos(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  if (POS_LABELS.has(key)) return key;
  return POS_ALIAS[key] ?? raw.trim();
}

export function cleanEnglish(input: string): string {
  return input
    .replace(/[\uff08(][^()\uff08\uff09]{0,80}[\u3400-\u9fff][^()\uff08\uff09]{0,80}[)\uff09]/g, "")
    .replace(/[\u3400-\u9fff]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function hasCjk(input: string): boolean {
  return /[\u3400-\u9fff]/.test(input);
}

function asText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Could not read the word entries");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export function parseModelJson(raw: string): {
  sourceText: string;
  words: AnalyzedWord[];
  dropped: number;
} {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") throw new Error("Could not read the word entries");
  const record = data as { sourceText?: unknown; words?: unknown };
  const sourceText = cleanEnglish(asText(record.sourceText, 6000));
  const list = Array.isArray(record.words) ? record.words : [];
  const words: AnalyzedWord[] = [];
  let dropped = 0;
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") {
      dropped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const surface = cleanEnglish(asText(row.surface, 48));
    const lemma = cleanEnglish(asText(row.lemma, 48)) || surface;
    const meaning = cleanEnglish(asText(row.meaning, 320));
    const whyHard = cleanEnglish(asText(row.whyHard, 220));
    const sentence = cleanEnglish(asText(row.sentence, 400)) || sourceText.slice(0, 400);
    const pos = cleanEnglish(normalizePos(asText(row.pos, 48)));
    const key = lemma.toLowerCase();

    if (
      !surface ||
      !lemma ||
      !meaning ||
      !pos ||
      hasCjk(surface + lemma + meaning + whyHard + pos + sentence) ||
      meaning.toLowerCase() === key ||
      EASY.has(key) ||
      seen.has(key)
    ) {
      dropped += 1;
      continue;
    }

    seen.add(key);
    words.push({
      surface,
      lemma,
      pos,
      meaning,
      whyHard: whyHard || "This word is harder than everyday English.",
      recommend: row.recommend === true || row.recommend === "true",
      sentence,
    });
    if (words.length >= 10) break;
  }

  return { sourceText, words, dropped };
}

export const SAMPLE_SENTENCE =
  "The sailor saw a faint glimmer on the dark water, and a sudden swell lifted his small boat.";

export const DEMO_BOOK_TITLE = "Sea Story (Sample)";

export function demoWords(): AnalyzedWord[] {
  const sentence = SAMPLE_SENTENCE;
  return [
    {
      surface: "glimmer",
      lemma: "glimmer",
      pos: "singular noun",
      meaning: "A small, weak light. Here it is a little light on the water.",
      whyHard: "Junior-high books rarely teach this word for a weak light.",
      recommend: true,
      sentence,
    },
    {
      surface: "swell",
      lemma: "swell",
      pos: "singular noun",
      meaning: "A large, slow wave. In this sentence it is a thing, not the verb swell.",
      whyHard: "The same spelling can be a noun or a verb, so the part of speech is easy to miss.",
      recommend: true,
      sentence,
    },
    {
      surface: "faint",
      lemma: "faint",
      pos: "adjective",
      meaning: "Not strong, and not easy to see. The light was very small.",
      whyHard: "Students often know faint as a verb, but here it describes the light.",
      recommend: true,
      sentence,
    },
    {
      surface: "lifted",
      lemma: "lift",
      pos: "past-tense verb",
      meaning: "Moved something up. The wave moved the boat up. Lifted is the past form of lift.",
      whyHard: "The -ed ending shows the past, and the meaning is physical, not a feeling.",
      recommend: false,
      sentence,
    },
    {
      surface: "sudden",
      lemma: "sudden",
      pos: "adjective",
      meaning: "Very fast, when you did not expect it. The wave came quickly.",
      whyHard: "It is useful, but many students already know a simpler word like quick.",
      recommend: false,
      sentence,
    },
  ];
}

/** Stage at which a card counts as mastered (after the last 30-day review). */
export const MASTERED_STAGE = 7;

export function isMastered(entry: VocabEntry): boolean {
  return entry.stage >= MASTERED_STAGE;
}

export function isDue(entry: VocabEntry, now = Date.now()): boolean {
  return entry.stage < MASTERED_STAGE && entry.dueAt <= now;
}
