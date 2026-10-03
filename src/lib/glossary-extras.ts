/**
 * Glossary v2 extras (shared types). Everything here is OPTIONAL in a glossary file.
 * Files without these fields stay valid.
 */

/**
 * Where a paragraph or sentence note sits.
 * A whole number is a chapter index (0-based). `x0`, `x1`, … is an extra id for a
 * contents file that had no paragraphs (see docs/GLOSSARY_FORMAT.md).
 */
export type NoteChapter = number | string;

/** A paragraph help entry. Locate by chapter + paragraph index; `context` (a short verbatim snippet) validates it. */
export type ParagraphHelp = {
  chapter: NoteChapter; // 0-based chapter, or an extra id such as "x3"
  paragraph: number; // 0-based index of the paragraph inside the chapter, as the app parses it
  context: string; // 6-14 words copied exactly from the paragraph
  mainIdea: string; // 1-2 short sentences
  simple: string; // the whole paragraph in very common words, restating only the original
  hardWords?: string[]; // hardest words or phrases from the ORIGINAL paragraph; shown as tappable
};

/** A sentence explanation. Locate by chapter + context (verbatim snippet from the sentence). */
export type SentenceHelp = {
  chapter: NoteChapter;
  context: string; // 6-14 words copied exactly from the sentence
  simple: string; // the sentence in easier English
  grammar: string; // ONE line naming the tricky grammar and what it means
};

/** A phrase entry (phrasal verb or idiom). Key in the `phrases` map is the base form, lower case, e.g. "give up". */
export type PhraseEntry = {
  meaning: string;
  pos?: "phrasal verb" | "idiom" | "phrase";
  forms?: string[]; // e.g. ["gave up", "giving up", "gives up"]
  example?: string;
};

export type GlossaryExtras = {
  paragraphs?: ParagraphHelp[];
  sentences?: SentenceHelp[];
  phrases?: Record<string, PhraseEntry>;
};

/** On a lemma entry (and sense): `coined: true` means the author invented the word. */
export type CoinedFlag = { coined?: boolean };
