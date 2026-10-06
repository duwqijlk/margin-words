import { EASY } from "@/lib/easy-words";
import { plainSurface, WORD_PATTERN } from "@/lib/glossary-format";

export const PREPARE_LIMIT = 240;

const IRREGULAR: Record<string, string> = {
  children: "child",
  men: "man",
  women: "woman",
  mice: "mouse",
  teeth: "tooth",
  feet: "foot",
  geese: "goose",
  leaves: "leaf",
  knives: "knife",
  wolves: "wolf",
  lives: "life",
  wives: "wife",
};

export function lookupKey(token: string): string {
  const w = plainSurface(token).replace(/'s$/, "").replace(/'$/, "");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes|oes)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is") &&
    w.length > 3
  ) {
    return w.slice(0, -1);
  }
  return w;
}

export function contextPos(surface: string, basePos: string): string {
  const raw = plainSurface(surface).replace(/'s$/, "");
  const key = lookupKey(surface);
  if (raw !== key && basePos.includes("noun") && !basePos.startsWith("plural"))
    return "plural noun";
  if (
    raw.endsWith("ing") &&
    basePos.includes("verb") &&
    !basePos.includes("participle") &&
    !basePos.includes("gerund")
  ) {
    return "present participle";
  }
  if (raw.endsWith("ed") && basePos.includes("verb") && !basePos.includes("past"))
    return "past-tense verb";
  return basePos;
}

// Stems left when a curly contraction is counted (`don’t` -> `don` + `t`). The tap button
// is the whole word, but these stems stay easy so the counted fragment is not a hard word.
// Also keys whose plural/verb "s" was stripped from a word on the easy list (`always` -> `alway`).
const CONTRACTION_STEMS = new Set([
  "don",
  "didn",
  "doesn",
  "wasn",
  "weren",
  "isn",
  "aren",
  "hasn",
  "haven",
  "hadn",
  "couldn",
  "wouldn",
  "shouldn",
  "won",
  "ain",
  "mustn",
  "needn",
  "mightn",
  "shan",
]);

export function isEasyKey(key: string): boolean {
  return key.length < 3 || EASY.has(key) || CONTRACTION_STEMS.has(key) || EASY.has(`${key}s`);
}

/**
 * Glossary key for a tapped word.
 * `keys` maps a stored spelling (and its straight-apostrophe form) to the stored key.
 * A plural stem matches a lemma (`carvings` -> `carving` when that entry exists).
 * It does not match a form of some other entry: `roses` is not `rise` just because
 * `rose` is a form of `rise`, and `numbers` is not `numb` because `number` is a form.
 * `forms` is consulted only for the word as written.
 */
export function resolveGlossKey(
  surface: string,
  keys: ReadonlyMap<string, string>,
  forms: ReadonlyMap<string, string>,
): string {
  const plain = lookupKey(surface);
  const stored = keys.get(plain);
  if (stored) return stored;
  const exact = plainSurface(surface);
  return keys.get(exact) ?? forms.get(exact) ?? forms.get(surface.toLowerCase()) ?? plain;
}

export function collectHardWords(paragraphs: string[], limit: number = PREPARE_LIMIT): string[] {
  const counts = new Map<string, { count: number; lower: number }>();
  const token = new RegExp(WORD_PATTERN, "gu");
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(token)) {
      const surface = match[0];
      const key = lookupKey(surface);
      if (!/^[a-z][a-z'-]*$/.test(key) || isEasyKey(key)) continue;
      const stat = counts.get(key) ?? { count: 0, lower: 0 };
      stat.count += 1;
      const first = surface[0] ?? "";
      if (first === first.toLowerCase() && first !== first.toUpperCase()) stat.lower += 1;
      counts.set(key, stat);
    }
  }
  return [...counts.entries()]
    .filter(([, stat]) => !(stat.count >= 2 && stat.lower === 0))
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * Character index of `surface` in `paragraph`.
 * An exact slice at `at` wins. If that slice is not the word, the nearest whole-word
 * copy wins (a later `his` does not snap back to the first `his`, and `his` inside
 * `this` does not count). With no `at`, the first copy is used.
 */
export function surfaceOffset(paragraph: string, surface: string, at?: number): number {
  const want = surface.toLowerCase();
  if (!want) return -1;
  if (
    at !== undefined &&
    at >= 0 &&
    paragraph.slice(at, at + surface.length).toLowerCase() === want
  ) {
    return at;
  }
  const hay = paragraph.toLowerCase();
  if (at === undefined) return hay.indexOf(want);
  const letter = /[\p{L}\p{M}]/u;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let from = 0;
  while (from <= hay.length - want.length) {
    const i = hay.indexOf(want, from);
    if (i < 0) break;
    const before = i > 0 ? hay[i - 1] : "";
    const after = i + want.length < hay.length ? hay[i + want.length] : "";
    if ((!before || !letter.test(before)) && (!after || !letter.test(after))) {
      const dist = Math.abs(i - at);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    from = i + 1;
  }
  return best;
}

const SENTENCE_LIMIT = 280;

/**
 * Shorten `text` so the word at `wordAt` stays whole. A cut side is marked with an ellipsis.
 * Cutting from the start of a long sentence used to drop the word when it sat past the limit.
 */
export function clipAroundWord(text: string, wordAt: number, wordLength: number, limit = SENTENCE_LIMIT): string {
  const length = Math.max(0, wordLength);
  const wordEnd = wordAt + length;
  if (wordAt < 0 || wordAt > text.length || wordEnd > text.length) {
    return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
  }
  if (length >= limit) {
    const body = text.slice(wordAt, wordEnd);
    return `${wordAt > 0 ? "…" : ""}${body}${wordEnd < text.length ? "…" : ""}`;
  }
  if (text.length <= limit) return text;
  let start = wordAt;
  let end = wordEnd;
  let budget = limit - length;
  while (budget > 0 && (start > 0 || end < text.length)) {
    if (start > 0) {
      start -= 1;
      budget -= 1;
    }
    if (budget > 0 && end < text.length) {
      end += 1;
      budget -= 1;
    }
  }
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < wordAt) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space >= wordEnd) end = space;
  }
  const body = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/** The sentence to show for a saved word: long lines keep the word, they do not cut it off. */
export function focusSentence(sentence: string, surface: string, limit = 220): string {
  const clean = sentence.trim();
  if (!surface || clean.length <= limit) return clean;
  const at = surfaceOffset(clean, surface);
  if (at < 0) return clean;
  return clipAroundWord(clean, at, surface.length, limit);
}

/** True when `surface` stands on its own in `text` (not inside a longer word). */
export function sentenceHasWord(text: string, surface: string): boolean {
  // A negative place skips the raw index check, so "fond" is not found inside "fondly".
  return surfaceOffset(text, surface, -1) >= 0;
}

/**
 * A sentence saved by the old start-cut keeps the opening and drops a word that sat past the
 * limit. `paragraphs` are this device's own chapter text. Returns a sentence that still
 * contains the word, or null when no paragraph here is the one that was saved.
 */
export function recoverClippedSentence(
  stored: string,
  surface: string,
  paragraphs: readonly string[],
): string | null {
  const word = surface.trim();
  if (!word || sentenceHasWord(stored, word)) return null;
  const prefix = stored
    .replace(/…+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  if (prefix.length < 12) return null;
  const needle = prefix.slice(0, 24);
  for (const paragraph of paragraphs) {
    if (!sentenceHasWord(paragraph, word)) continue;
    if (!paragraph.replace(/\s+/g, " ").includes(needle)) continue;
    const next = sentenceAround(paragraph, word);
    if (sentenceHasWord(next, word) && next !== stored) return next;
  }
  return null;
}

/**
 * The sentence that holds the nth time `surface` appears in this chapter (1-based),
 * counted the same way the reader numbers a tap. Empty when that occurrence is not here.
 */
export function sentenceForOccurrence(paragraphs: readonly string[], surface: string, occurrence: number): string {
  const form = surface.trim().toLowerCase();
  if (!form || occurrence < 1) return "";
  const pattern = new RegExp(WORD_PATTERN, "gu");
  let seen = 0;
  for (const paragraph of paragraphs) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(paragraph))) {
      if (match[0].toLowerCase() !== form) continue;
      seen += 1;
      if (seen === occurrence) return sentenceAround(paragraph, match[0], match.index);
    }
  }
  return "";
}

/** The first sentence in these paragraphs that contains `surface`. */
export function firstSentenceWith(paragraphs: readonly string[], surface: string): string {
  return sentenceForOccurrence(paragraphs, surface, 1);
}

/**
 * The sentence a notebook card lost, taken from this device's own chapter text.
 * A numbered occurrence wins. A list snippet is the next try. Otherwise the first
 * sentence that contains the word.
 */
export function restoreParagraph(input: {
  surface: string;
  phrase?: boolean;
  chapter?: number;
  occurrence?: number;
  /** A short quote from the word list, used when the occurrence is not in this file. */
  hint?: string;
  /** When false, do not guess the first sentence. Used while the word list is still loading. */
  guess?: boolean;
  chapters: readonly { paragraphs: readonly string[] }[];
  extras?: readonly { paragraphs: readonly string[] }[];
}): string {
  const surface = input.surface.trim();
  if (!surface) return "";
  const chapter =
    input.chapter !== undefined && input.chapter >= 0 ? (input.chapters[input.chapter]?.paragraphs ?? []) : [];
  const all = [
    ...input.chapters.flatMap((item) => item.paragraphs),
    ...(input.extras ?? []).flatMap((item) => item.paragraphs),
  ];
  if (!input.phrase && chapter.length && input.occurrence !== undefined && input.occurrence >= 1) {
    const exact = sentenceForOccurrence(chapter, surface, input.occurrence);
    if (exact) return exact;
  }
  const hint = (input.hint ?? "").replace(/\s+/g, " ").trim();
  if (hint.length >= 8) {
    const held = (chapter.length ? sentenceHolding(chapter, hint) : "") || sentenceHolding(all, hint);
    if (held) return held;
  }
  if (input.phrase || /\s/.test(surface)) {
    return (chapter.length ? sentenceHolding(chapter, surface) : "") || sentenceHolding(all, surface);
  }
  if (input.guess === false) return "";
  return (chapter.length ? firstSentenceWith(chapter, surface) : "") || firstSentenceWith(all, surface);
}

/** The sentence that holds this snippet, when the snippet is a phrase or a short quote. */
export function sentenceHolding(paragraphs: readonly string[], snippet: string): string {
  const needle = snippet.replace(/\s+/g, " ").trim().toLowerCase();
  if (needle.length < 2) return "";
  for (const paragraph of paragraphs) {
    const flat = paragraph.replace(/\s+/g, " ");
    const at = flat.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const word = snippet.trim().split(/\s+/)[0] ?? snippet;
    return sentenceAround(flat, word, at);
  }
  return "";
}

export function sentenceAround(paragraph: string, surface: string, at?: number): string {
  // `at` is where the tapped word really is in the paragraph (so a word that appears
  // twice shows the sentence that was tapped, not the first one).
  const idx = surfaceOffset(paragraph, surface, at);
  if (idx < 0) return paragraph.slice(0, 240);
  const bounds = [".", "?", "!"];
  let start = 0;
  for (const mark of bounds) {
    const found = paragraph.lastIndexOf(mark, idx - 1);
    if (found >= 0) start = Math.max(start, found + 1);
  }
  let end = paragraph.length;
  for (const mark of bounds) {
    const found = paragraph.indexOf(mark, idx + surface.length);
    if (found >= 0) end = Math.min(end, found + 1);
  }
  const raw = paragraph.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const slice = raw.trim();
  let wordAt = idx - start - lead;
  if (slice.slice(wordAt, wordAt + surface.length).toLowerCase() !== surface.toLowerCase()) {
    wordAt = surfaceOffset(slice, surface);
  }
  return clipAroundWord(slice, wordAt, surface.length, SENTENCE_LIMIT);
}

export type WordUse = "noun" | "verb" | "adjective";

export type WordStat = {
  count: number;
  chapters: number;
  forms: { form: string; count: number }[];
  sentences: string[];
  uses: WordUse[];
};

const ARTICLE = new Set(["a", "an", "the"]);
const SUBJECT = new Set(["i", "he", "she", "we", "they", "you"]);
const DEGREE = new Set(["very", "so", "too", "really", "quite"]);

export function indexBook(chapters: { paragraphs: string[] }[]): Record<string, WordStat> {
  type Acc = {
    count: number;
    chapters: Set<number>;
    forms: Map<string, number>;
    sentences: string[];
    sentenceChapters: Set<number>;
    tags: Map<WordUse, number>;
  };
  const map = new Map<string, Acc>();
  const token = new RegExp(WORD_PATTERN, "gu");
  chapters.forEach((chapter, chapterIndex) => {
    for (const paragraph of chapter.paragraphs) {
      const tokens = [...paragraph.matchAll(token)];
      tokens.forEach((match, index) => {
        const surface = match[0] ?? "";
        const key = lookupKey(surface);
        if (key.length < 3 || !/^[a-z][a-z'-]*$/.test(key)) return;
        let acc = map.get(key);
        if (!acc) {
          acc = {
            count: 0,
            chapters: new Set(),
            forms: new Map(),
            sentences: [],
            sentenceChapters: new Set(),
            tags: new Map(),
          };
          map.set(key, acc);
        }
        acc.count += 1;
        acc.chapters.add(chapterIndex);
        const form = surface.toLowerCase();
        acc.forms.set(form, (acc.forms.get(form) ?? 0) + 1);
        if (
          !isEasyKey(key) &&
          acc.sentences.length < 3 &&
          !acc.sentenceChapters.has(chapterIndex)
        ) {
          const sentence = sentenceAround(paragraph, surface);
          if (sentence.split(/\s+/).length >= 5) {
            acc.sentences.push(sentence);
            acc.sentenceChapters.add(chapterIndex);
          }
        }
        if (isEasyKey(key)) return;
        const prev = (tokens[index - 1]?.[0] ?? "").toLowerCase();
        const next = (tokens[index + 1]?.[0] ?? "").toLowerCase();
        let use: WordUse | "" = "";
        if (ARTICLE.has(prev)) use = next ? "adjective" : "noun";
        else if (SUBJECT.has(prev)) use = "verb";
        else if (DEGREE.has(prev)) use = "adjective";
        if (use) acc.tags.set(use, (acc.tags.get(use) ?? 0) + 1);
      });
    }
  });
  const stats: Record<string, WordStat> = {};
  for (const [key, acc] of map) {
    const uses = [...acc.tags.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([use]) => use);
    stats[key] = {
      count: acc.count,
      chapters: acc.chapters.size,
      forms: [...acc.forms.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([form, count]) => ({ form, count })),
      sentences: acc.sentences,
      uses: uses.length > 1 ? uses : [],
    };
  }
  return stats;
}
