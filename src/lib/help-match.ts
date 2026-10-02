/**
 * Pure matching rules for paragraph help, sentence help and phrases.
 * No browser code and no app imports (only relative ones), so the unit tests and the
 * command-line tools can load this file directly. The storage part is help-lookup.ts.
 */
import { flowText, includesLoose } from "./flow-text.ts";
import type { ParagraphHelp, PhraseEntry, SentenceHelp } from "./glossary-extras.ts";

/* ------------------------------------------------------------------ text normalising */

/**
 * Make two pieces of text comparable: curly quotes, dashes, spaces and case are ignored,
 * and every other mark (comma, full stop, quote) is dropped, so "Hello," and "hello"
 * give the same words. Soft hyphens, zero-width spaces and word joiners are dropped
 * first, so a word split by them still matches. The result is lower-case words joined by one space.
 */
export function looseText(text: string): string {
  return String(text ?? "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, " ")
    .replace(/\u2026/g, " ")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .toLowerCase()
    .replace(/(\w)'(?=\w)/g, "$1\ue000") // keep apostrophes inside words (don't)
    .replace(/[^a-z0-9\ue000]+/g, " ")
    .replace(/\ue000/g, "'")
    .trim();
}

/** Is `context` (a snippet of the book) inside `text`, ignoring quotes, spaces, case and punctuation? */
export function containsContext(text: string, context: string): boolean {
  return includesLoose(looseText(text), looseText(context));
}

/* ------------------------------------------------------------------ paragraph and sentence help */

/**
 * Pick the paragraph help for the paragraph that the reader shows.
 * 1. entry with the same chapter + paragraph index whose `context` is really in the text
 * 2. any entry whose `context` is in the text (same chapter first, then the nearest index)
 * Returns null when nothing fits: a stale index never shows help for the wrong paragraph.
 */
export function pickParagraphHelp(
  list: readonly ParagraphHelp[],
  chapter: number,
  paragraph: number,
  paragraphText: string,
): ParagraphHelp | null {
  const text = looseText(paragraphText);
  if (text === "") return null;
  const fits = (entry: ParagraphHelp) => includesLoose(text, looseText(entry.context));
  const exact = list.find((e) => e.chapter === chapter && e.paragraph === paragraph && fits(e));
  if (exact) return exact;
  let best: ParagraphHelp | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of list) {
    if (!fits(entry)) continue;
    const score =
      (entry.chapter === chapter ? 0 : 1_000_000) + Math.abs(entry.paragraph - paragraph);
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Pick the sentence help whose `context` is inside the sentence (same chapter first, longest snippet first). */
export function pickSentenceHelp(
  list: readonly SentenceHelp[],
  chapter: number,
  sentenceText: string,
): SentenceHelp | null {
  const text = looseText(sentenceText);
  if (text === "") return null;
  let best: SentenceHelp | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const entry of list) {
    const c = looseText(entry.context);
    if (!includesLoose(text, c)) continue;
    const score = (entry.chapter === chapter ? 100_000 : 0) + c.length;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ verb forms */

const IRREGULAR: Record<string, string[]> = {
  // base: [3rd person, past, past participle, -ing]
  be: ["is", "was", "been", "being"],
  begin: ["begins", "began", "begun", "beginning"],
  bite: ["bites", "bit", "bitten", "biting"],
  blow: ["blows", "blew", "blown", "blowing"],
  break: ["breaks", "broke", "broken", "breaking"],
  bring: ["brings", "brought", "brought", "bringing"],
  build: ["builds", "built", "built", "building"],
  buy: ["buys", "bought", "bought", "buying"],
  catch: ["catches", "caught", "caught", "catching"],
  choose: ["chooses", "chose", "chosen", "choosing"],
  come: ["comes", "came", "come", "coming"],
  cut: ["cuts", "cut", "cut", "cutting"],
  do: ["does", "did", "done", "doing"],
  draw: ["draws", "drew", "drawn", "drawing"],
  drink: ["drinks", "drank", "drunk", "drinking"],
  drive: ["drives", "drove", "driven", "driving"],
  eat: ["eats", "ate", "eaten", "eating"],
  fall: ["falls", "fell", "fallen", "falling"],
  feed: ["feeds", "fed", "fed", "feeding"],
  feel: ["feels", "felt", "felt", "feeling"],
  fight: ["fights", "fought", "fought", "fighting"],
  find: ["finds", "found", "found", "finding"],
  fly: ["flies", "flew", "flown", "flying"],
  forget: ["forgets", "forgot", "forgotten", "forgetting"],
  get: ["gets", "got", "got", "getting"],
  give: ["gives", "gave", "given", "giving"],
  go: ["goes", "went", "gone", "going"],
  grow: ["grows", "grew", "grown", "growing"],
  hang: ["hangs", "hung", "hung", "hanging"],
  have: ["has", "had", "had", "having"],
  hear: ["hears", "heard", "heard", "hearing"],
  hide: ["hides", "hid", "hidden", "hiding"],
  hit: ["hits", "hit", "hit", "hitting"],
  hold: ["holds", "held", "held", "holding"],
  keep: ["keeps", "kept", "kept", "keeping"],
  know: ["knows", "knew", "known", "knowing"],
  lay: ["lays", "laid", "laid", "laying"],
  lead: ["leads", "led", "led", "leading"],
  leave: ["leaves", "left", "left", "leaving"],
  let: ["lets", "let", "let", "letting"],
  lie: ["lies", "lay", "lain", "lying"],
  lose: ["loses", "lost", "lost", "losing"],
  make: ["makes", "made", "made", "making"],
  mean: ["means", "meant", "meant", "meaning"],
  meet: ["meets", "met", "met", "meeting"],
  pay: ["pays", "paid", "paid", "paying"],
  put: ["puts", "put", "put", "putting"],
  read: ["reads", "read", "read", "reading"],
  ride: ["rides", "rode", "ridden", "riding"],
  ring: ["rings", "rang", "rung", "ringing"],
  rise: ["rises", "rose", "risen", "rising"],
  run: ["runs", "ran", "run", "running"],
  say: ["says", "said", "said", "saying"],
  see: ["sees", "saw", "seen", "seeing"],
  sell: ["sells", "sold", "sold", "selling"],
  send: ["sends", "sent", "sent", "sending"],
  set: ["sets", "set", "set", "setting"],
  shake: ["shakes", "shook", "shaken", "shaking"],
  shoot: ["shoots", "shot", "shot", "shooting"],
  show: ["shows", "showed", "shown", "showing"],
  shut: ["shuts", "shut", "shut", "shutting"],
  sing: ["sings", "sang", "sung", "singing"],
  sink: ["sinks", "sank", "sunk", "sinking"],
  sit: ["sits", "sat", "sat", "sitting"],
  sleep: ["sleeps", "slept", "slept", "sleeping"],
  speak: ["speaks", "spoke", "spoken", "speaking"],
  spend: ["spends", "spent", "spent", "spending"],
  spring: ["springs", "sprang", "sprung", "springing"],
  stand: ["stands", "stood", "stood", "standing"],
  steal: ["steals", "stole", "stolen", "stealing"],
  stick: ["sticks", "stuck", "stuck", "sticking"],
  strike: ["strikes", "struck", "struck", "striking"],
  swear: ["swears", "swore", "sworn", "swearing"],
  sweep: ["sweeps", "swept", "swept", "sweeping"],
  swim: ["swims", "swam", "swum", "swimming"],
  swing: ["swings", "swung", "swung", "swinging"],
  take: ["takes", "took", "taken", "taking"],
  teach: ["teaches", "taught", "taught", "teaching"],
  tear: ["tears", "tore", "torn", "tearing"],
  tell: ["tells", "told", "told", "telling"],
  think: ["thinks", "thought", "thought", "thinking"],
  throw: ["throws", "threw", "thrown", "throwing"],
  understand: ["understands", "understood", "understood", "understanding"],
  wake: ["wakes", "woke", "woken", "waking"],
  wear: ["wears", "wore", "worn", "wearing"],
  win: ["wins", "won", "won", "winning"],
  write: ["writes", "wrote", "written", "writing"],
};

const VOWELS = "aeiou";

/** The forms of a verb: base, -s, past, past participle, -ing (regular rules, plus a table of common irregular verbs). */
export function verbForms(base: string): string[] {
  const b = base.toLowerCase();
  const irregular = IRREGULAR[b];
  if (irregular) return [...new Set([b, ...irregular, ...(b === "lie" ? ["lied"] : [])])];
  if (!/^[a-z]{2,}$/.test(b)) return [b];
  const last = b.slice(-1);
  const before = b.slice(-2, -1);
  let s: string;
  if (/(s|x|z|ch|sh)$/.test(b) || (last === "o" && !VOWELS.includes(before))) s = `${b}es`;
  else if (last === "y" && !VOWELS.includes(before)) s = `${b.slice(0, -1)}ies`;
  else s = `${b}s`;
  let ed: string;
  let ing: string;
  if (last === "e") {
    ed = `${b}d`;
    ing = b.endsWith("ee") || b.endsWith("ye") ? `${b}ing` : `${b.slice(0, -1)}ing`;
  } else if (last === "y" && !VOWELS.includes(before)) {
    ed = `${b.slice(0, -1)}ied`;
    ing = `${b}ing`;
  } else if (
    // short word ending consonant-vowel-consonant doubles the last letter: stop -> stopped
    /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(b) &&
    b.length <= 4
  ) {
    ed = `${b}${last}ed`;
    ing = `${b}${last}ing`;
  } else {
    ed = `${b}ed`;
    ing = `${b}ing`;
  }
  return [...new Set([b, s, ed, ing])];
}

/* ------------------------------------------------------------------ phrases */

const PARTICLES = new Set([
  "up",
  "down",
  "out",
  "off",
  "on",
  "in",
  "over",
  "away",
  "back",
  "around",
  "round",
  "along",
  "through",
  "apart",
  "aside",
  "together",
  "forward",
  "ahead",
  "behind",
  "by",
  "across",
  "about",
  "after",
  "at",
  "for",
  "into",
  "to",
  "with",
  "from",
  "of",
]);
const POSSESSIVE = new Set(["my", "your", "his", "her", "its", "our", "their"]);
const OBJECT_PRONOUN = new Set([
  "it",
  "him",
  "her",
  "me",
  "us",
  "you",
  "them",
  "themselves",
  "himself",
  "herself",
  "myself",
  "yourself",
  "itself",
  "ourselves",
  "everyone",
  "everything",
  "something",
  "someone",
  "nothing",
  "nobody",
]);
const DETERMINER = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  "every",
  "each",
  "no",
  "his",
  "her",
  "my",
  "your",
  "its",
  "our",
  "their",
  "both",
  "all",
  "half",
]);
const GAP_BREAKERS = new Set([
  "and",
  "but",
  "or",
  "nor",
  "so",
  "yet",
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "while",
  "because",
  "if",
  "than",
  "then",
  "although",
  "though",
  "where",
  "until",
  "unless",
  "before",
  "since",
  "to",
  "at",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "into",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "not",
  "do",
  "did",
  "does",
  "will",
  "would",
  "can",
  "could",
  "should",
  "might",
  "must",
]);
const NO_INFLECT = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "to",
  "of",
  "by",
  "for",
  "with",
  "as",
  "it",
  "one",
  "no",
  "so",
  "by",
  "from",
  "all",
  "up",
  "out",
  "off",
  "over",
  "under",
  "about",
  "after",
  "before",
  "once",
  "every",
  "each",
  "not",
  "and",
  "or",
  "but",
  "too",
  "just",
  "even",
  "ever",
  "never",
  "at",
]);

type Token = { w: string; start: number; end: number };

/** Words of a sentence with their positions. A word is letters with at most one inside apostrophe (straight or curly). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /(?:\p{L}\p{M}*)+(?:['\u2019](?:\p{L}\p{M}*)+)?/gu;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    out.push({
      w: m[0].toLowerCase().replace(/\u2019/g, "'"),
      start: m.index,
      end: m.index + m[0].length,
    });
    m = re.exec(text);
  }
  return out;
}

const cleanWord = (w: string) =>
  w
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim();

type Variant = { words: string[]; separable: boolean };

/** Is a break mark (full stop, comma, quote, dash...) between two tokens of the sentence? */
function hasBreak(text: string, from: number, to: number): boolean {
  return /[.,;:!?\u2014\u2013"\u201c\u201d()]|--/.test(text.slice(from, to));
}

function variantsOf(key: string, entry: PhraseEntry): Variant[] {
  const baseWords = cleanWord(key).split(/\s+/).filter(Boolean);
  if (baseWords.length === 0) return [];
  const second = baseWords[1];
  const separable =
    baseWords.length === 2 &&
    PARTICLES.has(second as string) &&
    entry.pos !== "idiom" &&
    entry.pos !== "phrase";
  const out: Variant[] = [];
  const seen = new Set<string>();
  const add = (words: string[], sep: boolean) => {
    const id = `${sep ? "~" : "="}${words.join(" ")}`;
    if (words.length === 0 || seen.has(id)) return;
    seen.add(id);
    out.push({ words, separable: sep });
  };
  // listed forms are written out in full: they match as written, and may be separated when the phrase is a phrasal verb
  for (const form of entry.forms ?? []) {
    const words = cleanWord(form).split(/\s+/).filter(Boolean);
    add(words, separable && words.length >= 2);
  }
  // the base form, and the same phrase with the first word inflected
  const first = baseWords[0] as string;
  const firstForms = NO_INFLECT.has(first) || first.includes("'") ? [first] : verbForms(first);
  for (const f of firstForms) add([f, ...baseWords.slice(1)], separable);
  return out;
}

function wordFits(expected: string, got: string): boolean {
  if (expected === "one's") return POSSESSIVE.has(got);
  if (expected === "someone" || expected === "somebody")
    return OBJECT_PRONOUN.has(got) || got === expected;
  return expected === got;
}

/** All the ways a variant can sit in the sentence tokens, starting at `from`. */
function matchAt(
  text: string,
  tokens: Token[],
  from: number,
  variant: Variant,
): { indexes: number[] } | null {
  const words = variant.words;
  const first = tokens[from];
  if (!first || !wordFits(words[0] as string, first.w)) return null;
  const indexes = [from];
  let at = from;
  for (let k = 1; k < words.length; k += 1) {
    const want = words[k] as string;
    const next = tokens[at + 1];
    if (next && wordFits(want, next.w) && !hasBreak(text, (tokens[at] as Token).end, next.start)) {
      indexes.push(at + 1);
      at += 1;
      continue;
    }
    if (k === 1 && variant.separable) {
      // verb + (up to 3 words) + particle, with nothing that ends a clause in between
      let found = -1;
      for (let gap = 1; gap <= 3 && at + 1 + gap < tokens.length; gap += 1) {
        const cand = tokens[at + 1 + gap] as Token;
        const gapWords = tokens.slice(at + 1, at + 1 + gap);
        if (gapWords.some((g) => GAP_BREAKERS.has(g.w))) break;
        if (hasBreak(text, (tokens[at] as Token).end, cand.start)) break;
        // "gave her a gift up": a second noun phrase inside the gap means the particle is not part of the verb
        const second = gapWords[1];
        if (
          second &&
          DETERMINER.has(second.w) &&
          !["all", "both", "half"].includes((gapWords[0] as Token).w)
        )
          break;
        if (wordFits(want, cand.w)) {
          found = at + 1 + gap;
          break;
        }
      }
      if (found < 0) return null;
      indexes.push(found);
      at = found;
      continue;
    }
    return null;
  }
  return { indexes };
}

export type PhraseHit = { key: string; entry: PhraseEntry; matched: string };

/**
 * Find the listed phrase that the tapped word belongs to in this sentence.
 * The tapped word must be one of the words of the phrase itself (not a word in the gap).
 * Gives the longest phrase when several fit. Returns null when there is no safe match.
 */
export function pickPhrase(
  phrases: Record<string, PhraseEntry> | undefined,
  sentenceText: string,
  tappedWord: string,
): PhraseHit | null {
  if (!phrases) return null;
  const tapped = cleanWord(tappedWord).replace(/^'+|'+$/g, "");
  if (!tapped) return null;
  const tokens = tokenize(sentenceText);
  if (tokens.length === 0) return null;
  let best: (PhraseHit & { score: number }) | null = null;
  for (const [key, entry] of Object.entries(phrases)) {
    if (!entry || typeof entry.meaning !== "string") continue;
    for (const variant of variantsOf(key, entry)) {
      for (let from = 0; from < tokens.length; from += 1) {
        const hit = matchAt(sentenceText, tokens, from, variant);
        if (!hit) continue;
        if (!hit.indexes.some((i) => (tokens[i] as Token).w === tapped)) continue;
        const a = tokens[hit.indexes[0] as number] as Token;
        const z = tokens[hit.indexes[hit.indexes.length - 1] as number] as Token;
        // prefer the phrase with more words; on a tie, the one with the smaller gap
        const gap =
          (hit.indexes[hit.indexes.length - 1] as number) -
          (hit.indexes[0] as number) -
          (hit.indexes.length - 1);
        const span = hit.indexes.length * 10 - gap;
        if (!best || span > best.score) {
          best = { key, entry, matched: sentenceText.slice(a.start, z.end), score: span };
        }
      }
    }
  }
  return best ? { key: best.key, entry: best.entry, matched: best.matched } : null;
}

/* ------------------------------------------------------------------ merging stored extras */

export type ExtrasData = {
  paragraphs: ParagraphHelp[];
  sentences: SentenceHelp[];
  phrases: Record<string, PhraseEntry>;
};

/**
 * Combine the extras already in a book with the extras of a list that is being added.
 * "replace": the new list wins for every item it has. "add": items already there are kept.
 */
export function mergeExtras(
  old: ExtrasData | null,
  add: ExtrasData,
  mode: "replace" | "add",
): ExtrasData {
  if (!old) return add;
  const pKey = (p: ParagraphHelp) => `${p.chapter}/${p.paragraph}`;
  const sKey = (s: SentenceHelp) => `${s.chapter}/${looseText(s.context)}`;
  const paragraphs = new Map<string, ParagraphHelp>();
  const sentences = new Map<string, SentenceHelp>();
  const [first, second] = mode === "replace" ? [old, add] : [add, old];
  for (const src of [first, second]) {
    for (const p of src.paragraphs) paragraphs.set(pKey(p), p);
    for (const s of src.sentences) sentences.set(sKey(s), s);
  }
  return {
    paragraphs: [...paragraphs.values()],
    sentences: [...sentences.values()],
    phrases: { ...first.phrases, ...second.phrases },
  };
}

/* ------------------------------------------------------------------ paragraph numbering */

const PARAGRAPH_BLOCKS = "p, h1, h2, h3, h4, li, blockquote";

/**
 * THE paragraph rule. The paragraph index of a chapter is the position in `chapter.paragraphs`
 * (what src/lib/epub.ts `paragraphsOf` builds when the book is added): every p, h1-h4, li and
 * blockquote of the chapter html, in document order, EXCEPT one whose direct parent is a p, li
 * or blockquote, and EXCEPT one with fewer than 2 English letters. This helper applies the same
 * rule to a rendered chapter, so the reader can number the blocks it shows.
 * (If the chapter has no such block at all, the whole chapter text is the one paragraph, index 0.)
 */
export function paragraphBlocks(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const block of Array.from(root.querySelectorAll(PARAGRAPH_BLOCKS))) {
    const parent = block.parentElement?.localName;
    if (parent === "p" || parent === "li" || parent === "blockquote") continue;
    const text = flowText(block);
    if ((text.match(/[A-Za-z]/g)?.length ?? 0) > 1) out.push(block);
  }
  return out;
}
