/**
 * Pure matching rules for paragraph help, sentence help and phrases.
 * No browser code and no app imports (only relative ones), so the unit tests and the
 * command-line tools can load this file directly. The storage part is help-lookup.ts.
 */
import { flowText, includesLoose } from "./flow-text.ts";
import { plainSurface, TAP_WORD_PATTERN } from "./glossary-format.ts";
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

/**
 * Words of a sentence with their positions. Same splits as a tap button (`TAP_WORD_PATTERN`):
 * a hyphen keeps the pieces apart (`good-bye` is `good` and `bye`), so a glossary phrase
 * written with spaces still matches hyphenated text (`uh oh` in `Uh-oh`). Occurrence
 * counting still uses `WORD_PATTERN` and is not changed here. A hyphenated run counts as
 * one word only when a separable phrase measures its gap.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = new RegExp(TAP_WORD_PATTERN, "gu");
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    out.push({
      w: plainSurface(m[0]),
      start: m.index,
      end: m.index + m[0].length,
    });
    m = re.exec(text);
  }
  return out;
}

const cleanWord = (w: string) => plainSurface(w).trim();

type Variant = { words: string[]; separable: boolean; commaJoins: boolean[] };

/** Is a break mark (full stop, comma, quote, dash...) between two tokens of the sentence? */
function hasBreak(text: string, from: number, to: number): boolean {
  return /[.,;:!?\u2014\u2013"\u201c\u201d()]|--/.test(text.slice(from, to));
}

/**
 * A comma written in the entry (`oh, brother`) may sit between these two tokens,
 * with spaces around it. The comma is optional: the same entry also matches with
 * no comma. Any other break still blocks. A comma-free entry does not use this.
 */
function commaJoin(text: string, from: number, to: number): boolean {
  return /^\s*,\s*$/.test(text.slice(from, to));
}

/**
 * Phrase pieces. A hyphen is a word break here too, so `say good-bye` matches the taps `good` and `bye`.
 * A comma between words is remembered (`oh, brother` is `oh` + `brother` with a comma join)
 * and never becomes part of a word.
 */
function phrasePieces(raw: string): { words: string[]; commaJoins: boolean[] } {
  const words: string[] = [];
  const commaJoins: boolean[] = [];
  let commaBeforeNext = false;
  for (const rawChunk of cleanWord(raw).split(/\s+/).filter(Boolean)) {
    const commaAfter = rawChunk.endsWith(",");
    const chunk = commaAfter ? rawChunk.replace(/,+$/, "") : rawChunk;
    const bits = chunk.split("-").filter(Boolean);
    if (bits.length === 0) continue;
    for (let b = 0; b < bits.length; b += 1) {
      if (words.length > 0) commaJoins.push(b === 0 ? commaBeforeNext : false);
      words.push(bits[b] as string);
    }
    commaBeforeNext = commaAfter;
  }
  return { words, commaJoins };
}

function variantsOf(key: string, entry: PhraseEntry): Variant[] {
  const pieces = phrasePieces(key);
  if (pieces.words.length === 0) return [];
  const second = pieces.words[1];
  // A comma in the entry keeps the phrase contiguous. It does not open a gap.
  const keyHasComma = pieces.commaJoins.some(Boolean);
  const separable =
    !keyHasComma &&
    pieces.words.length === 2 &&
    PARTICLES.has(second as string) &&
    entry.pos !== "idiom" &&
    entry.pos !== "phrase";
  const out: Variant[] = [];
  const seen = new Set<string>();
  const add = (words: string[], commaJoins: boolean[], sep: boolean) => {
    const joins: boolean[] = [];
    for (let i = 0; i < words.length - 1; i += 1) joins.push(commaJoins[i] === true);
    const hasComma = joins.some(Boolean);
    const id = `${sep && !hasComma ? "~" : "="}${joins.map((join) => (join ? "," : " ")).join("")}${words.join(" ")}`;
    if (words.length === 0 || seen.has(id)) return;
    seen.add(id);
    out.push({ words, separable: sep && !hasComma, commaJoins: joins });
  };
  // A listed form is matched as written. "put his pack on" and "paid no attention" stay exact.
  // A two-word form of a phrasal verb ("puts on") may still take a gap, like the base.
  // A form that writes a comma ("oh, boy") stays contiguous, even when the base can take a gap.
  for (const form of entry.forms ?? []) {
    const parsed = phrasePieces(form);
    add(parsed.words, parsed.commaJoins, separable && parsed.words.length === 2);
  }
  // Inflect the first word only when the glossary did not write it with a hyphen
  // (`face-to-face` stays one phrase; `say good-bye` still has `said`).
  const firstRaw = cleanWord(key).split(/\s+/).filter(Boolean)[0] ?? "";
  const first = pieces.words[0] as string;
  const firstForms =
    firstRaw.includes("-") || NO_INFLECT.has(first) || first.includes("'") ? [first] : verbForms(first);
  for (const f of firstForms) add([f, ...pieces.words.slice(1)], pieces.commaJoins, separable);
  return out;
}

function wordFits(expected: string, got: string): boolean {
  if (expected === "one's") return POSSESSIVE.has(got);
  if (expected === "someone" || expected === "somebody")
    return OBJECT_PRONOUN.has(got) || got === expected;
  return expected === got;
}

/**
 * Particles that head a prepositional phrase and take only a pronoun in the gap
 * (`come to`, `look after`, `take me to the house`).
 * `for`, `from` and `into` are separate: a noun phrase in the gap is normal, and so is
 * a noun phrase after the particle (`keep the team from`, `made straight for`).
 */
const PREPOSITION_ENDS = new Set(["to", "at", "with", "of", "after", "about", "by", "across"]);

/**
 * A particle inside the gap means another phrase has started (`took up in`, `make up for`,
 * `turned through an arch`). `back`, `around` and `round` are not here: they are fillers
 * (`put his glasses back on`, `looked around for`). `up` and `down` are fillers only before `into`.
 */
const GAP_PARTICLES = new Set(["up", "on", "off", "out", "down", "in", "over", "away", "through"]);

const DEMONSTRATIVE = new Set(["this", "that", "these", "those"]);

const GAP_ADVERBS = new Set([
  "very",
  "really",
  "just",
  "still",
  "also",
  "even",
  "always",
  "never",
  "not",
  "so",
  "too",
  "quite",
  "rather",
  "already",
  "now",
  "then",
  "here",
  "there",
  "again",
  "well",
  "ever",
  "once",
  "only",
  "almost",
  "enough",
  "perhaps",
  "maybe",
  "soon",
  "later",
  "actually",
  "finally",
  "suddenly",
  "quickly",
  "slowly",
  "inside",
  "outside",
  "upside",
  "further",
  "farther",
  "closer",
  "nearer",
  "easier",
  "harder",
]);

/** Verbs that are not also ordinary nouns. One of these in the gap is not an object (`jumping`, `find`, `try`). */
const GAP_VERBS = new Set([
  "find",
  "found",
  "try",
  "tried",
  "jump",
  "jumped",
  "let",
  "stuck",
  "stood",
  "sat",
  "went",
  "came",
  "ran",
  "walked",
  "said",
  "told",
  "asked",
  "saw",
  "seen",
  "knew",
  "thought",
  "felt",
  "kept",
  "going",
  "coming",
  "being",
  "made",
  "gave",
  "took",
  "got",
  "held",
  "put",
  "make",
  "go",
  "see",
  "look",
  "looks",
  "give",
  "take",
  "get",
  "hold",
  "pull",
  "pulled",
  "leave",
  "say",
  "tell",
  "ask",
  "know",
  "think",
  "seem",
  "stand",
  "sit",
  "run",
  "walk",
  "turn",
  "turned",
  "begin",
  "began",
  "become",
  "became",
  "feel",
  "showed",
  "shown",
  "grow",
  "grew",
  "grown",
  "cry",
  "cried",
  "cries",
  "come",
  "comes",
  "break",
  "broke",
  "broken",
  "bring",
  "brought",
  "met",
  "check",
  "checks",
  "checked",
]);

const ING_NOUNS = new Set([
  "something",
  "nothing",
  "anything",
  "everything",
  "morning",
  "evening",
  "ceiling",
  "building",
  "clothing",
  "wedding",
  "painting",
  "drawing",
  "during",
  "opening",
  "ending",
  "beginning",
  "darling",
  "spring",
  "string",
]);

function isIngVerb(w: string): boolean {
  return w.length >= 6 && w.endsWith("ing") && !ING_NOUNS.has(w);
}

const ED_NOT_VERBS = new Set(["sacred", "wicked", "rugged", "jagged", "ragged", "wretched"]);

function isEdVerb(w: string): boolean {
  return w.length >= 6 && w.endsWith("ed") && !ED_NOT_VERBS.has(w);
}

/** Short past participles that do not end in -ed (`be torn off`). */
const SHORT_PARTICIPLES = new Set(["torn", "worn"]);

function isGapVerb(w: string): boolean {
  // An -ing word in the gap is allowed only as a manner of motion (`came running out`).
  // A finite verb, an -ed verb, or a short participle is not.
  return GAP_VERBS.has(w) || isEdVerb(w) || SHORT_PARTICIPLES.has(w);
}

/** Object pronouns that are not also possessives (`her coat` is a noun phrase; `him stretched` is not). */
const BARE_PRONOUN = new Set([
  "it",
  "him",
  "me",
  "us",
  "you",
  "them",
  "himself",
  "herself",
  "myself",
  "yourself",
  "itself",
  "ourselves",
  "themselves",
  "everyone",
  "everything",
  "something",
  "someone",
  "nothing",
  "nobody",
]);

/** `that`/`this` can be the object (`figure that out`). `up`/`down` before `into` are fillers. */
function gapWordBreaks(w: string, particle: string): boolean {
  if (DEMONSTRATIVE.has(w)) return false;
  if ((w === "up" || w === "down") && particle === "into") return false;
  if (w === "of") return true;
  return GAP_BREAKERS.has(w) || GAP_PARTICLES.has(w);
}

function isPronounGap(words: string[]): boolean {
  if (words.length === 1 && (OBJECT_PRONOUN.has(words[0] as string) || DEMONSTRATIVE.has(words[0] as string)))
    return true;
  if (words.length === 2) {
    const intens = new Set(["all", "both", "half"]);
    const [a, b] = words as [string, string];
    if (OBJECT_PRONOUN.has(a) && intens.has(b)) return true;
    if (intens.has(a) && OBJECT_PRONOUN.has(b)) return true;
  }
  return false;
}

function isHeadNoun(w: string): boolean {
  if (w === "one" || w === "ones") return true;
  if (
    DETERMINER.has(w) ||
    OBJECT_PRONOUN.has(w) ||
    DEMONSTRATIVE.has(w) ||
    GAP_ADVERBS.has(w) ||
    GAP_PARTICLES.has(w) ||
    PREPOSITION_ENDS.has(w) ||
    PARTICLES.has(w) ||
    GAP_BREAKERS.has(w) ||
    isGapVerb(w) ||
    isIngVerb(w)
  )
    return false;
  return /^[a-z][a-z'-]*$/.test(w);
}

/** A short object: `it`, `the parkas`, `their new boots`, `all these dangers`, `each one`, `Winter`. */
function isNounPhrase(words: string[]): boolean {
  if (words.length === 0 || words.length > 3) return false;
  const head = words[words.length - 1] as string;
  const gerund = isIngVerb(head) && words.length >= 2 && DETERMINER.has(words[words.length - 2] as string);
  if (!gerund && !isHeadNoun(head)) return false;
  const front = words.slice(0, -1);
  let dets = 0;
  for (let i = 0; i < front.length; i += 1) {
    const w = front[i] as string;
    if (DETERMINER.has(w)) {
      dets += 1;
      if (dets > 2) return false;
      if (dets === 2 && !["all", "both", "half"].includes(front[0] as string)) return false;
      continue;
    }
    if (isGapVerb(w) || GAP_ADVERBS.has(w) || GAP_PARTICLES.has(w) || GAP_BREAKERS.has(w)) return false;
    // An -ing word before the noun is an adjective (`the howling wind`, `long snaking trails`).
  }
  if (words.length === 3 && dets === 0) {
    const a = words[0] as string;
    const b = words[1] as string;
    if (
      isGapVerb(a) ||
      isGapVerb(b) ||
      GAP_ADVERBS.has(a) ||
      GAP_ADVERBS.has(b) ||
      GAP_PARTICLES.has(a) ||
      GAP_BREAKERS.has(a) ||
      PARTICLES.has(a)
    )
      return false;
  }
  return true;
}

/** Adverb fillers that may sit in a gap beside a real object (`glasses back`, `straight`, `patiently`). */
const GAP_FILLERS = new Set(["back", "around", "round", "all", "both", "straight", "right"]);

/** Not a real object: `figure a way out`, `took a bite out of`. */
const LIGHT_HEADS = new Set(["way", "bite"]);

/** Words after a particle that are adverbs, not the start of a noun phrase (`took the masks out first`). */
const POST_ADVERBS = new Set([
  "first",
  "next",
  "last",
  "again",
  "now",
  "then",
  "here",
  "there",
  "too",
  "also",
  "just",
  "later",
  "soon",
  "instead",
  "already",
  "quick",
  "fast",
]);

const GET_FORMS = new Set(["get", "gets", "got", "getting"]);
const GO_FORMS = new Set(["go", "goes", "went", "going", "gone"]);
const PUT_FORMS = new Set(["put", "puts", "putting"]);
const HANG_FORMS = new Set(["hang", "hangs", "hung", "hanging"]);
/** Something you put on. `put his pack on his back` stays; `on his shoulder` does not. */
const WEARABLES = new Set([
  "pack",
  "backpack",
  "knapsack",
  "rucksack",
  "coat",
  "jacket",
  "cape",
  "cloak",
  "hat",
  "cap",
  "helmet",
  "glasses",
  "goggles",
  "boots",
  "boot",
  "shoes",
  "shoe",
  "mittens",
  "mitten",
  "gloves",
  "glove",
  "pants",
  "shirt",
  "costume",
  "harness",
  "harnesses",
  "clothes",
  "clothing",
  "uniform",
  "mask",
  "masks",
  "belt",
  "scarf",
  "sweater",
  "parka",
  "parkas",
  "vest",
  "robe",
  "trousers",
  "socks",
  "sock",
  "flippers",
  "flipper",
  "suit",
  "dress",
]);
/** Body parts that are not the object of the phrasal verb (`took his eyes off`, `holding his hands up`). */
const BODY_GAP = new Set(["eye", "eyes", "hand", "hands"]);
const MAKE_FORMS = new Set(["make", "makes", "made", "making"]);
/** `pull the snorkel out of`, `let me out of`, `took her cell out of` stay. `took a bite out of` does not. */
const OUT_OF_VERBS = new Set([
  "pull",
  "pulls",
  "pulled",
  "pulling",
  "let",
  "lets",
  "letting",
  "tear",
  "tears",
  "tore",
  "torn",
  "tearing",
  "take",
  "takes",
  "took",
  "taken",
  "taking",
  "knock",
  "knocks",
  "knocked",
  "knocking",
  "come",
  "comes",
  "came",
  "coming",
]);
/** `held the painting up to Billy` stays. `took the cape up to his room` does not. */
const UP_TO_VERBS = new Set([
  "hold",
  "holds",
  "held",
  "holding",
  "give",
  "gives",
  "gave",
  "given",
  "giving",
  "wake",
  "wakes",
  "woke",
  "woken",
  "waking",
]);

function isMannerLy(w: string): boolean {
  return w.length > 3 && w.endsWith("ly") && !GAP_ADVERBS.has(w);
}

/**
 * Manner -ing that may fill a gap after any verb (`came running across`).
 * A motion verb may also take any bare -ing immediately before a directional
 * particle in `ING_PARTICLES` (`came winging back`). `off`, `up`, `through`,
 * `over`, `across`, and `on` are not in that set (`go jumping off`, `went flitting through`).
 */
const MANNER_ING = new Set([
  "running",
  "rushing",
  "slithering",
  "howling",
  "walking",
  "gurgling",
  "whispering",
  "striding",
  "racing",
  "flying",
  "crawling",
  "hurrying",
  "charging",
  "tumbling",
  "rolling",
  "creeping",
  "speeding",
  "sprinting",
  "dashing",
  "drifting",
  "floating",
  "climbing",
  "stumbling",
  "limping",
  "marching",
  "swimming",
  "leaping",
  "hopping",
  "skipping",
]);

function isMannerIng(w: string): boolean {
  return MANNER_ING.has(w);
}

/** `come` / `go` / `run` and the same kind of motion. `stood making up` is not one of these. */
const MOTION_VERBS = new Set([
  "come",
  "comes",
  "came",
  "coming",
  "go",
  "goes",
  "went",
  "going",
  "gone",
  "run",
  "runs",
  "ran",
  "running",
  "walk",
  "walks",
  "walked",
  "walking",
  "fly",
  "flies",
  "flew",
  "flying",
  "rush",
  "rushes",
  "rushed",
  "rushing",
  "hurry",
  "hurries",
  "hurried",
  "hurrying",
  "race",
  "races",
  "raced",
  "racing",
]);

/**
 * Directional particles a motion verb may split with any bare -ing
 * (`came winging back`, `came rowing back`). Not `off`, `up`, `through`,
 * `over`, `across`, or `on` (`go jumping off`, `went flitting through`).
 */
const ING_PARTICLES = new Set(["back", "out", "in", "away", "home"]);

function isMotionVerb(w: string): boolean {
  return MOTION_VERBS.has(w);
}

/** `taken a half-day off`: a time period is not the object you remove. */
const TIME_HEADS = new Set([
  "day",
  "days",
  "hour",
  "hours",
  "minute",
  "minutes",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "afternoon",
  "morning",
  "weekend",
]);

function isTimeHead(w: string): boolean {
  const head = w.split("-").pop() as string;
  return TIME_HEADS.has(head);
}

function isFillerWord(w: string, particle: string): boolean {
  // `all over` is "everywhere" or "finished", not `get over` (`got warm all over`, `get it all over`).
  if (w === "all" && particle === "over") return false;
  // `time went slowly on`. `slowly` stays a breaker before any other particle.
  if (w === "slowly" && particle === "on") return true;
  if (GAP_ADVERBS.has(w)) return false;
  if (GAP_FILLERS.has(w) || isMannerLy(w)) return true;
  return (w === "up" || w === "down") && particle === "into";
}

/** `get all of me back`, `pick some of them up`: `of` is a breaker except in this shape. */
const OF_QUANTIFIERS = new Set(["all", "both", "half", "some", "any", "none", "each", "either", "neither", "one"]);

function isAllOfPronoun(words: string[]): boolean {
  if (words.length !== 3) return false;
  const [a, b, c] = words as [string, string, string];
  return OF_QUANTIFIERS.has(a) && b === "of" && (OBJECT_PRONOUN.has(c) || BARE_PRONOUN.has(c));
}

type GapKind = "pronoun" | "possessive" | "np" | "filler" | "ing" | "bad";

function gapCoreIsBad(words: string[]): boolean {
  const head = words[words.length - 1] as string;
  if (LIGHT_HEADS.has(head) || isTimeHead(head)) return true;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] as string;
    if (isIngVerb(w) && i === words.length - 1 && i > 0) {
      const prev = words[i - 1] as string;
      // `turns jumping` is a verb. `the howling wind` keeps the -ing as an adjective.
      if (!DETERMINER.has(prev)) return true;
    }
    if (isGapVerb(w)) return true;
  }
  if (words.some((w) => GAP_ADVERBS.has(w) || BARE_PRONOUN.has(w))) return true;
  return false;
}

function classifyGap(words: string[], particle: string): GapKind {
  // `all` sitting on `over` is "everywhere" (`got warm all over`, `climbing all over`).
  // `talked it all over` keeps the pronoun. `talked all these adventures over` does not end on `all`.
  if (particle === "over" && words[words.length - 1] === "all") {
    const prev = words.length > 1 ? (words[words.length - 2] as string) : "";
    if (!(OBJECT_PRONOUN.has(prev) || DEMONSTRATIVE.has(prev))) return "bad";
  }
  if (isAllOfPronoun(words)) return "pronoun";
  if (words.length === 1 && isMannerIng(words[0] as string)) return "ing";
  if (words.every((w) => isFillerWord(w, particle))) return "filler";
  const core = [...words];
  while (core.length > 1 && isFillerWord(core[core.length - 1] as string, particle)) core.pop();
  if (core.length === 1 && isMannerIng(core[0] as string)) return "ing";
  if (isPronounGap(core)) return "pronoun";
  if (core.length === 1 && POSSESSIVE.has(core[0] as string)) return "possessive";
  if (gapCoreIsBad(core)) return "bad";
  if (isNounPhrase(core)) return "np";
  return "bad";
}

/**
 * May these words stand between a verb and its particle?
 * A pronoun, a single possessive (`put his on`), a short noun phrase, or a filler
 * (`back`, `around`, `straight`, `patiently`, a bare `-ing`) may stand there.
 * `to` / `after` allow a pronoun only. `for` allows a pronoun or a filler, not a noun
 * (`made straight for`, not `made a dash for`). `from` and `into` allow a noun phrase.
 */
function gapAllowed(words: string[], particle: string, verb: string): boolean {
  if (words.length < 1 || words.length > 3) return false;
  if (!isAllOfPronoun(words) && words.some((w) => gapWordBreaks(w, particle))) return false;
  if (words.includes("show") && particle === "up") return false;
  // `get it all over` is not `get over`. `talked it all over` is.
  if (particle === "over" && words[words.length - 1] === "all" && GET_FORMS.has(verb)) return false;
  // `came winging back`: the -ing is the whole gap and sits on the particle.
  if (
    words.length === 1 &&
    isIngVerb(words[0] as string) &&
    isMotionVerb(verb) &&
    ING_PARTICLES.has(particle)
  ) {
    return true;
  }
  const kind = classifyGap(words, particle);
  if (kind === "bad") return false;
  if (particle === "for") {
    // `making that for me` is "create that for me", not `make for`.
    if (words.length === 1 && DEMONSTRATIVE.has(words[0] as string)) return false;
    // `waited patiently for`, `made straight for`, `ask him for`.
    // Not `made it especially for` (a pronoun plus an extra adverb).
    if (kind === "filler" || kind === "ing") return true;
    if (isPronounGap(words)) return true;
    return words.length === 1 && POSSESSIVE.has(words[0] as string);
  }
  if (particle === "across") return kind === "pronoun" || kind === "filler" || kind === "ing";
  if (PREPOSITION_ENDS.has(particle)) return kind === "pronoun";
  if (particle === "into" && GET_FORMS.has(verb) && kind === "np") return false;
  return true;
}

const CLAUSE_FOLLOW = new Set([
  "and",
  "but",
  "or",
  "nor",
  "so",
  "when",
  "while",
  "because",
  "if",
  "then",
  "although",
  "though",
  "where",
  "until",
  "unless",
  "before",
  "since",
  "as",
  "than",
  "till",
  "til",
]);

type Complement = "none" | "np" | "of" | "to" | "and-particle" | "ing";

/**
 * What follows the particle. A manner adverb or `first` is not a noun (`took the masks out first`).
 * An `-ly` word followed by a noun is a name (`Darkly Wynd`), so it counts as a noun phrase.
 */
function complementAfter(text: string, tokens: Token[], particleAt: number): Complement {
  const next = tokens[particleAt + 1];
  if (!next) return "none";
  const prev = tokens[particleAt] as Token;
  if (hasBreak(text, prev.end, next.start)) return "none";
  const w = next.w;
  if (w === "and" || w === "or") {
    const third = tokens[particleAt + 2];
    const here = tokens[particleAt] as Token;
    // `up and down` is two particles. `over and over` is the same particle repeated.
    if (
      third &&
      PARTICLES.has(third.w) &&
      third.w !== here.w &&
      !hasBreak(text, next.end, third.start)
    )
      return "and-particle";
  }
  if (CLAUSE_FOLLOW.has(w) && w !== "so") return "none";
  if (w === "so") {
    const many = tokens[particleAt + 2];
    if (many && (many.w === "many" || many.w === "much") && !hasBreak(text, next.end, many.start)) return "np";
    return "none";
  }
  if (POST_ADVERBS.has(w) || GAP_ADVERBS.has(w) || w.endsWith("ward")) return "none";
  if (
    w === "beneath" ||
    w === "under" ||
    w === "underneath" ||
    w === "above" ||
    w === "below" ||
    w === "inside" ||
    w === "outside" ||
    w === "toward" ||
    w === "towards" ||
    w === "onto" ||
    w === "upon" ||
    w === "without" ||
    w === "within" ||
    w === "beside" ||
    w === "besides" ||
    w === "against" ||
    w === "among" ||
    w === "amid"
  )
    return "none";
  if (isMannerLy(w)) {
    const after = tokens[particleAt + 2];
    if (after && !hasBreak(text, next.end, after.start) && (isHeadNoun(after.w) || /^[A-Z]/.test(text.slice(after.start, after.start + 1))))
      return "np";
    return "none";
  }
  if (w === "of") return "of";
  if (w === "to") {
    const after = tokens[particleAt + 2];
    // `picking things up to look` is an infinitive. `up to his room` and `up to date` are not.
    if (after && !hasBreak(text, next.end, after.start) && GAP_VERBS.has(after.w)) return "none";
    return "to";
  }
  if (isIngVerb(w)) return "ing";
  if (isGapVerb(w) || GAP_PARTICLES.has(w) || PREPOSITION_ENDS.has(w) || PARTICLES.has(w)) return "none";
  // `shake the old woman up a bit`: `a bit` is a degree, not `up the river`.
  if (w === "a" || w === "an") {
    const bit = tokens[particleAt + 2];
    if (bit && !hasBreak(text, next.end, bit.start) && bit.w === "bit") return "none";
  }
  if (GAP_BREAKERS.has(w) && !DEMONSTRATIVE.has(w) && !DETERMINER.has(w)) return "none";
  return "np";
}

/**
 * A following noun phrase rejects some gaps and keeps others.
 * Pronoun + `on` + noun phrase is placement (`put it on the table`), not `put on`.
 * A wearable put on one's back stays (`put his pack on his back`). Any other
 * `on his/her` place is placement (`hung the bag on his shoulder`, `put the baby on his back`).
 * `in` plus a noun phrase is a preposition (`taking place in Darkly Wynd`).
 * `out of` and `up to` are rejected except for the verbs that really take them
 * (`pulled the snorkel out of`, `held the painting up to`, `getting you out of there`).
 */
function complementRejects(
  text: string,
  tokens: Token[],
  particleAt: number,
  particle: string,
  gap: string[],
  verb: string,
): boolean {
  const raw = complementAfter(text, tokens, particleAt);
  if (raw === "none") return false;
  if (raw === "and-particle") return true;
  // `went right on growing`: the -ing continues the verb, it is not a noun.
  if (raw === "ing" && particle === "on" && GO_FORMS.has(verb)) return false;
  const comp = raw === "ing" ? "np" : raw;
  const kind = classifyGap(gap, particle);
  if (comp === "of" && particle === "out") {
    if (kind === "ing") return false;
    const head = gap[gap.length - 1] as string;
    if (LIGHT_HEADS.has(head)) return true;
    if (kind === "pronoun" && GET_FORMS.has(verb)) return false;
    return !OUT_OF_VERBS.has(verb);
  }
  if (comp === "to" && particle === "up") {
    if (kind === "filler") return false;
    return !UP_TO_VERBS.has(verb);
  }
  if (comp !== "np") return false;
  // `came running across the road`: the -ing is the gap, and the road is normal.
  if (particle === "across" && (kind === "ing" || kind === "filler")) return false;
  if (PREPOSITION_ENDS.has(particle) || particle === "in") return true;
  if (particle === "on") {
    // Pronoun + on + noun is placement (`put it on the table`, `Put it on her face`).
    if (kind === "pronoun") return true;
    // A filler before `on` plus a noun is a preposition (`go back on his word`,
    // `go straight on his message`).
    if (kind !== "np") return true;
    const followTok = tokens[particleAt + 1] as Token;
    const follow = followTok.w;
    // `put a costume on him`, `putting harnesses on all the dogs`.
    // `her` is an object only when no noun follows (`on her`). `on her hips` is possessive.
    const afterHer = tokens[particleAt + 2];
    const herIsObject =
      follow === "her" &&
      (!afterHer ||
        hasBreak(text, followTok.end, afterHer.start) ||
        !(isHeadNoun(afterHer.w) || DETERMINER.has(afterHer.w)));
    if (
      herIsObject ||
      (OBJECT_PRONOUN.has(follow) && follow !== "her") ||
      follow === "all" ||
      follow === "both" ||
      follow === "half"
    )
      return false;
    // Only `put` + a wearable + `back` is clothing. `on his chest` / `on his shoulder` is placement.
    if (POSSESSIVE.has(follow)) {
      const place = tokens[particleAt + 2];
      const head = gap[gap.length - 1] as string;
      const wornOnBack =
        !!place &&
        place.w === "back" &&
        !hasBreak(text, followTok.end, place.start) &&
        WEARABLES.has(head) &&
        PUT_FORMS.has(verb);
      return !wornOnBack;
    }
    return true;
  }
  // `took them up so many staircases`. `pick you up` and `keep it up all the way` stay.
  if (particle === "up" && kind === "pronoun") {
    const follow = tokens[particleAt + 1] as Token;
    const many = tokens[particleAt + 2];
    if (follow.w === "so" && many && (many.w === "many" || many.w === "much")) return true;
  }
  // `hung all around the room`. `looked all around him` is `look`, so it stays.
  if ((particle === "around" || particle === "round") && HANG_FORMS.has(verb)) return true;
  const head = gap[gap.length - 1] as string;
  // `took his eyes off Charlie`, `took his hand off the wall`.
  if (particle === "off" && kind === "np" && BODY_GAP.has(head)) return true;
  if (particle === "up" && kind === "np") {
    // `holding his hands up all defensively`. `took a boat up the river`.
    if (BODY_GAP.has(head)) return true;
    const follow = (tokens[particleAt + 1] as Token).w;
    if (follow === "the" || follow === "a" || follow === "an") return true;
  }
  // `take a howling snowstorm over this`. `put it all over your head` is everywhere.
  if (particle === "over" && (kind === "np" || gap[gap.length - 1] === "all")) return true;
  return false;
}

function sameHyphen(text: string, a: Token, b: Token): boolean {
  return a.end + 1 === b.start && text[a.end] === "-";
}

/** A run of pieces joined by hyphens counts as one word toward the gap limit of 3. */
function collapseHyphens(text: string, gapTokens: Token[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < gapTokens.length; i += 1) {
    const token = gapTokens[i] as Token;
    if (i > 0 && sameHyphen(text, gapTokens[i - 1] as Token, token)) out[out.length - 1] = `${out[out.length - 1]}-${token.w}`;
    else out.push(token.w);
  }
  return out;
}

/** `figuring-things-out` includes the verb. `thumbs-up` does not, so it is not `give up`. */
function hyphenChainReaches(text: string, tokens: Token[], verbAt: number, particleAt: number): boolean {
  let i = particleAt;
  while (i > verbAt && sameHyphen(text, tokens[i - 1] as Token, tokens[i] as Token)) i -= 1;
  return i === verbAt;
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
    const prevEnd = (tokens[at] as Token).end;
    // `oh, brother` matches `Oh, brother` and `Oh brother`. `oh brother` matches only the second.
    const commaOk =
      !!next && variant.commaJoins[k - 1] === true && commaJoin(text, prevEnd, next.start);
    if (next && wordFits(want, next.w) && (!hasBreak(text, prevEnd, next.start) || commaOk)) {
      indexes.push(at + 1);
      at += 1;
      continue;
    }
    if (k === 1 && variant.separable) {
      // verb + a pronoun, a short noun phrase, or a filler + particle.
      // Up to 3 words, counting a hyphenated run as one word.
      // `stale-looking` is one adjective: the verb half is not free to start a phrase.
      const verb = tokens[at] as Token;
      if (at > 0 && sameHyphen(text, tokens[at - 1] as Token, verb)) return null;
      let found = -1;
      for (let gap = 1; gap <= 8 && at + 1 + gap < tokens.length; gap += 1) {
        const cand = tokens[at + 1 + gap] as Token;
        const gapTokens = tokens.slice(at + 1, at + 1 + gap);
        const between = collapseHyphens(text, gapTokens);
        if (between.length > 3) break;
        if (hasBreak(text, verb.end, cand.start)) break;
        if (!wordFits(want, cand.w)) continue;
        const before = tokens[at + gap] as Token;
        if (sameHyphen(text, before, cand) && !hyphenChainReaches(text, tokens, at, at + 1 + gap)) continue;
        if (!gapAllowed(between, want, verb.w)) continue;
        if (complementRejects(text, tokens, at + 1 + gap, want, between, verb.w)) continue;
        found = at + 1 + gap;
        break;
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

function gapSize(indexes: number[]): number {
  return (indexes[indexes.length - 1] as number) - (indexes[0] as number) - (indexes.length - 1);
}

/** A phrase with no intervening words beats a longer one that jumps a gap. Then more words, then a smaller gap. */
function phraseScore(indexes: number[]): number {
  const gap = gapSize(indexes);
  return (gap === 0 ? 1000 : 0) + indexes.length * 10 - gap;
}

/**
 * A separable phrase starts on this token, but every particle it can see is rejected
 * (`I figure we'll figure it out`: the long gap is too big). That tap must not fall
 * back to a later match of the same word. `Ask her, then finish on her own` has no
 * rejected phrase of its own, so the later phrase still opens.
 */
function separableFromRejected(
  text: string,
  tokens: Token[],
  from: number,
  phrases: Record<string, PhraseEntry>,
): boolean {
  const verb = tokens[from];
  if (!verb) return false;
  if (from > 0 && sameHyphen(text, tokens[from - 1] as Token, verb)) return false;
  let rejected = false;
  for (const [key, entry] of Object.entries(phrases)) {
    if (!entry || typeof entry.meaning !== "string") continue;
    for (const variant of variantsOf(key, entry)) {
      if (!variant.separable) continue;
      if (!wordFits(variant.words[0] as string, verb.w)) continue;
      const want = variant.words[1] as string;
      for (let gap = 1; gap <= 8 && from + 1 + gap < tokens.length; gap += 1) {
        const cand = tokens[from + 1 + gap] as Token;
        if (hasBreak(text, verb.end, cand.start)) break;
        const between = collapseHyphens(text, tokens.slice(from + 1, from + 1 + gap));
        if (!wordFits(want, cand.w)) {
          if (between.length > 3) break;
          continue;
        }
        const before = tokens[from + gap] as Token;
        const hyphenBad =
          sameHyphen(text, before, cand) && !hyphenChainReaches(text, tokens, from, from + 1 + gap);
        const ok =
          between.length >= 1 &&
          between.length <= 3 &&
          !hyphenBad &&
          gapAllowed(between, want, verb.w) &&
          !complementRejects(text, tokens, from + 1 + gap, want, between, verb.w);
        if (ok) return false;
        rejected = true;
        break;
      }
    }
  }
  return rejected;
}

/**
 * Find the listed phrase that the tapped word belongs to in this sentence.
 * The tapped word must be one of the words of the phrase itself (not a word in the gap).
 * When `tappedAt` is the character offset of the tapped word in `sentenceText`, a phrase
 * whose match covers that token wins. A match with no gap beats a match that jumps across
 * other words. If several still cover it, the longest wins, then the smaller gap.
 * If none covers that token, the same rule is applied to every other match of the word,
 * unless this token's own separable candidate was rejected.
 * Returns null when there is no safe match.
 */
export function pickPhrase(
  phrases: Record<string, PhraseEntry> | undefined,
  sentenceText: string,
  tappedWord: string,
  tappedAt?: number,
): PhraseHit | null {
  if (!phrases) return null;
  const tapped = cleanWord(tappedWord).replace(/^'+|'+$/g, "");
  if (!tapped) return null;
  const tokens = tokenize(sentenceText);
  if (tokens.length === 0) return null;
  let focus = -1;
  if (typeof tappedAt === "number" && tappedAt >= 0) {
    focus = tokens.findIndex((token) => tappedAt >= token.start && tappedAt < token.end);
    if (focus >= 0 && (tokens[focus] as Token).w !== tapped) focus = -1;
  }
  const solid: { start: number; indexes: number[] }[] = [];
  const hits: {
    key: string;
    entry: PhraseEntry;
    matched: string;
    indexes: number[];
    covers: boolean;
    score: number;
  }[] = [];
  for (const [key, entry] of Object.entries(phrases)) {
    if (!entry || typeof entry.meaning !== "string") continue;
    for (const variant of variantsOf(key, entry)) {
      for (let from = 0; from < tokens.length; from += 1) {
        const hit = matchAt(sentenceText, tokens, from, variant);
        if (!hit) continue;
        if (gapSize(hit.indexes) === 0) {
          solid.push({ start: hit.indexes[0] as number, indexes: hit.indexes });
        }
        const covers = focus >= 0 && hit.indexes.includes(focus);
        const wordHit = hit.indexes.some((i) => (tokens[i] as Token).w === tapped);
        if (!covers && !wordHit) continue;
        const a = tokens[hit.indexes[0] as number] as Token;
        const z = tokens[hit.indexes[hit.indexes.length - 1] as number] as Token;
        hits.push({
          key,
          entry,
          matched: sentenceText.slice(a.start, z.end),
          indexes: hit.indexes,
          covers,
          score: phraseScore(hit.indexes),
        });
      }
    }
  }
  let bestCover: (typeof hits)[number] | null = null;
  let bestAny: (typeof hits)[number] | null = null;
  for (const hit of hits) {
    const gap = gapSize(hit.indexes);
    if (gap > 0) {
      const verbAt = hit.indexes[0] as number;
      const particleAt = hit.indexes[hit.indexes.length - 1] as number;
      // "make her show up": `show up` already owns the particle, so `make up` does not.
      const owned = solid.some(
        (other) => other.start > verbAt && other.start < particleAt && other.indexes.includes(particleAt),
      );
      if (owned) continue;
    }
    if (hit.covers) {
      if (!bestCover || hit.score > bestCover.score) bestCover = hit;
    } else if (!bestAny || hit.score > bestAny.score) bestAny = hit;
  }
  const ownRejected =
    !bestCover && !!bestAny && focus >= 0 && separableFromRejected(sentenceText, tokens, focus, phrases);
  const best = bestCover ?? (ownRejected ? null : bestAny);
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

const PARAGRAPH_BLOCKS = "p, h1, h2, h3, h4, li, blockquote, div[data-para]";

/**
 * THE paragraph rule. The paragraph index of a chapter is the position in `chapter.paragraphs`
 * (what src/lib/epub.ts `paragraphsOf` builds when the book is added): every p, h1-h4, li and
 * blockquote of the chapter html, in document order, EXCEPT one whose direct parent is a p, li
 * or blockquote, and EXCEPT one with fewer than 2 English letters.
 * When the whole book has no p element, paragraphsOf also counts each innermost text div and
 * marks it with data-para. Those marked divs are paragraphs here too, in the same order.
 * A book that has a p never gets that mark, so its blocks stay as before.
 * This helper applies the same rule to a rendered chapter, so the reader can number the blocks it shows.
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
