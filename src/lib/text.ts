import { EASY } from "@/lib/easy-words";

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
  const w = token.toLowerCase().replace(/'s$/, "").replace(/'$/, "");
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
  const raw = surface.toLowerCase().replace(/'s$/, "");
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

// Stems left behind when a contraction is split at a curly apostrophe (don’t -> don + t),
// and keys whose plural/verb "s" was stripped from a word that is on the easy list (always -> alway).
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

export function collectHardWords(paragraphs: string[], limit: number = PREPARE_LIMIT): string[] {
  const counts = new Map<string, { count: number; lower: number }>();
  const token = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
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

export function sentenceAround(paragraph: string, surface: string, at?: number): string {
  // `at` is where the tapped word really is in the paragraph (so a word that appears
  // twice shows the sentence that was tapped, not the first one).
  const exact =
    at !== undefined &&
    at >= 0 &&
    paragraph.slice(at, at + surface.length).toLowerCase() === surface.toLowerCase();
  const idx = exact ? (at as number) : paragraph.toLowerCase().indexOf(surface.toLowerCase());
  if (idx < 0) return paragraph.slice(0, 240);
  const bounds = [".", "?", "!"];
  let start = 0;
  for (const mark of bounds) {
    const at = paragraph.lastIndexOf(mark, idx - 1);
    if (at >= 0) start = Math.max(start, at + 1);
  }
  let end = paragraph.length;
  for (const mark of bounds) {
    const at = paragraph.indexOf(mark, idx + surface.length);
    if (at >= 0) end = Math.min(end, at + 1);
  }
  const slice = paragraph.slice(start, end).trim();
  if (slice.length <= 280) return slice;
  return `${slice.slice(0, 280).trim()}…`;
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
  const token = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
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
