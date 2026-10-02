/**
 * The "basic words" check: is a word one of the ~2000 most common English words
 * (or a simple inflection of one)? Used to keep definitions and help text easy.
 * Pure code (relative imports only) so scripts and tests can load it.
 */
import { BASIC_WORDS_TEXT } from "./basic-words-data.ts";
import { verbForms } from "./help-match.ts";

export const BASIC_WORDS: ReadonlySet<string> = new Set(
  BASIC_WORDS_TEXT.split(/\s+/).filter(Boolean),
);

// Words that are so basic that any learner knows them, but are missing from the frequency list
// (the list drops names, abbreviations and some words with other uses).
const EXTRA = new Set(
  "a an the i me my we us our you your he him his she her it its they them their am is are was were be been being do does did done doing have has had having will would can could shall should may might must not no yes ok okay mr mrs miss ms sir lady one two three four five six seven eight nine ten hundred thousand first second third".split(
    " ",
  ),
);

// inflected form -> base, for the common irregular verbs and nouns
let irregular: Map<string, string> | null = null;
function irregularMap(): Map<string, string> {
  if (irregular) return irregular;
  irregular = new Map();
  for (const base of BASIC_WORDS) {
    for (const form of verbForms(base))
      if (form !== base && !irregular.has(form)) irregular.set(form, base);
  }
  const nouns: Record<string, string> = {
    men: "man",
    women: "woman",
    children: "child",
    feet: "foot",
    teeth: "tooth",
    mice: "mouse",
    people: "person",
    wives: "wife",
    knives: "knife",
    lives: "life",
    leaves: "leaf",
    wolves: "wolf",
    thieves: "thief",
    geese: "goose",
    better: "good",
    best: "good",
    worse: "bad",
    worst: "bad",
    more: "much",
    most: "much",
    less: "little",
    least: "little",
  };
  for (const [form, base] of Object.entries(nouns)) irregular.set(form, base);
  return irregular;
}

function candidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w.length >= 2) out.push(w);
  };
  const w = word;
  if (w.endsWith("ies")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("ied")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("ier")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("iest")) add(`${w.slice(0, -4)}y`);
  if (w.endsWith("ily")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3));
  }
  if (w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(`${w.slice(0, -3)}e`);
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4));
  }
  if (w.endsWith("ly")) {
    add(w.slice(0, -2));
    if (w.endsWith("ally")) add(w.slice(0, -4));
    if (w.endsWith("ably") || w.endsWith("ibly")) add(`${w.slice(0, -1)}e`.replace(/ye$/, "le"));
  }
  if (w.endsWith("er")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    if (/(.)\1er$/.test(w)) add(w.slice(0, -3));
  }
  if (w.endsWith("est")) {
    add(w.slice(0, -3));
    add(w.slice(0, -2));
    if (/(.)\1est$/.test(w)) add(w.slice(0, -4));
  }
  if (w.endsWith("ness")) {
    add(w.slice(0, -4));
    if (w.endsWith("iness")) add(`${w.slice(0, -5)}y`);
  }
  // un- (unable, unhappy, unclear): the rest must be a word on its own
  if (w.startsWith("un") && w.length > 5) {
    const rest = w.slice(2);
    add(rest);
    for (const c of candidates(rest)) add(c);
  }
  if (w.startsWith("dis") && w.length > 6) add(w.slice(3));
  if (w.endsWith("ment") && w.length > 6) add(w.slice(0, -4));
  if (w.endsWith("able") && w.length > 6) {
    add(w.slice(0, -4));
    add(`${w.slice(0, -4)}e`);
  }
  if (w.endsWith("ful")) add(w.slice(0, -3));
  if (w.endsWith("less")) add(w.slice(0, -4));
  return out;
}

/** Is this one word (letters and apostrophes) a basic word or a simple form of one? */
export function isBasicWord(raw: string): boolean {
  let w = raw.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (!w) return true;
  w = w
    .replace(/n't$/, "")
    .replace(/'(s|ll|re|d|ve|m|t)$/, "")
    .replace(/'+/g, "");
  if (!w || BASIC_WORDS.has(w) || EXTRA.has(w)) return true;
  if (irregularMap().has(w)) return true;
  return candidates(w).some((c) => BASIC_WORDS.has(c) || EXTRA.has(c));
}

const WORD = /[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;

/**
 * The words of `text` that are outside the basic list. Skipped on purpose:
 * numbers; names (a capital letter that does not start a sentence); the entry's own word and its forms
 * (`allow`); words found in `extraAllowed`. A hyphenated word is checked part by part.
 */
/**
 * Text that only tells the reader how another country writes the word is not part of the
 * explanation: "(American English: trash or garbage.)", "(British English: lift.)".
 */
export function withoutDialectNotes(text: string): string {
  return text.replace(/\((?:American|British|Old|Old-fashioned|Informal|Slang)[^)]*\)/gi, " ");
}

export function outsideBasic(
  text: string,
  allow: Iterable<string> = [],
  extraAllowed?: ReadonlySet<string>,
): string[] {
  text = withoutDialectNotes(text);
  const allowed = new Set<string>();
  for (const item of allow)
    for (const part of item.toLowerCase().split(/[^a-z']+/)) if (part) allowed.add(part);
  const out: string[] = [];
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null = WORD.exec(text);
  while (m) {
    const word = m[0];
    const before = text.slice(0, m.index).replace(/["'\u201c\u201d\u2018\u2019(\s]+$/, "");
    const startsSentence = before === "" || /[.!?:;]$/.test(before);
    const capital = /^[A-Z]/.test(word);
    const lower = word.toLowerCase().replace(/\u2019/g, "'");
    const stripped = lower.replace(/'(s|ll|re|d|ve|m|t)$/, "");
    const ok =
      allowed.has(lower) ||
      allowed.has(stripped) ||
      Boolean(extraAllowed?.has(lower) || extraAllowed?.has(stripped)) ||
      candidates(lower).some((c) => extraAllowed?.has(c)) ||
      (capital && !startsSentence) || // a name
      isBasicWord(lower) ||
      candidates(lower).some((c) => allowed.has(c)); // a simple form of the word being defined
    if (!ok && !out.includes(lower)) out.push(lower);
    m = WORD.exec(text);
  }
  return out;
}
