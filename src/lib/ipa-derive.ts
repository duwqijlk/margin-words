/**
 * Pronunciations of regular inflections, worked out from the base word's own reading.
 *
 * Only the regular English endings, each by its sound rule:
 *   -ed   /ɪd/ after t or d, /t/ after a voiceless sound, /d/ otherwise (peered, glanced, waited)
 *   -s    /ɪz/ after s z ʃ ʒ (tʃ dʒ), /s/ after p t k f θ, /z/ otherwise
 *   -ing  /ɪŋ/ (a British base ending in an r-coloured vowel gets its linking r back)
 *   -er   /ə/ UK, /ər/ US;  -est /ɪst/
 * The stress stays where the base has it. Nothing is guessed for a base the data does not have,
 * and the result is marked as worked out (the card shows ≈), because an irregular sound change
 * (baths /bɑːðz/, learned /ˈlɜːnɪd/) is not seen by these rules.
 */
import type { IpaEntry, IpaReading } from "./local-ipa.ts";

export type Suffix = "ed" | "s" | "ing" | "er" | "est";
export type BaseGuess = { base: string; suffix: Suffix };

const VOWEL = /[aeiouyæɑɒɔəɛɜɪʊʌ]/;
const VOICELESS = new Set(["p", "t", "k", "f", "θ", "s", "ʃ"]);
const SIBILANT = new Set(["s", "z", "ʃ", "ʒ"]);

/** Spelling candidates for the base of `word`, most likely first. Lower-case words only. */
export function baseCandidates(word: string): BaseGuess[] {
  const w = word;
  if (!/^[a-z]+$/.test(w) || w.length < 4) return [];
  const out: BaseGuess[] = [];
  const add = (base: string, suffix: Suffix) => {
    if (base.length >= 2 && !out.some((item) => item.base === base && item.suffix === suffix)) out.push({ base, suffix });
  };
  const doubled = (stem: string) => stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && !/[aeiou]/.test(stem[stem.length - 1]);
  if (w.endsWith("ied")) add(`${w.slice(0, -3)}y`, "ed");
  if (w.endsWith("ies")) add(`${w.slice(0, -3)}y`, "s");
  if (w.endsWith("iest")) add(`${w.slice(0, -4)}y`, "est");
  if (w.endsWith("ier")) add(`${w.slice(0, -3)}y`, "er");
  if (w.endsWith("ed")) {
    const stem = w.slice(0, -2);
    add(stem, "ed");
    add(`${stem}e`, "ed");
    if (doubled(stem)) add(stem.slice(0, -1), "ed");
  }
  if (w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    add(stem, "ing");
    add(`${stem}e`, "ing");
    if (doubled(stem)) add(stem.slice(0, -1), "ing");
  }
  if (w.endsWith("est")) {
    const stem = w.slice(0, -3);
    add(stem, "est");
    add(`${stem}e`, "est");
    if (doubled(stem)) add(stem.slice(0, -1), "est");
  }
  if (w.endsWith("er")) {
    const stem = w.slice(0, -2);
    add(stem, "er");
    add(`${stem}e`, "er");
    if (doubled(stem)) add(stem.slice(0, -1), "er");
  }
  if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) add(w.slice(0, -2), "s");
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) add(w.slice(0, -1), "s");
  return out;
}

/** The last sound of a reading, ignoring length marks; `rColoured` for a final (r). */
function ending(ipa: string): { body: string; last: string; optionalR: boolean } {
  let body = ipa.trim();
  let optionalR = false;
  if (body.endsWith("(r)")) {
    body = body.slice(0, -3);
    optionalR = true;
  }
  const plain = body.replace(/[ːˑ]+$/u, "");
  return { body, last: plain.slice(-1), optionalR };
}

const syllables = (ipa: string) => (ipa.match(/[aeiouæɑɒɔəɛɜɪʊʌ]+/g) ?? []).length;

/** One accent's reading of `base + suffix`, or null when the base reading is not usable. */
export function inflect(reading: string, suffix: Suffix, accent: "UK" | "US"): string | null {
  if (!reading || /\s/.test(reading) || !VOWEL.test(reading)) return null;
  const { body, last, optionalR } = ending(reading);
  if (!last) return null;
  let tail: string;
  let joined = body;
  switch (suffix) {
    case "ed":
      tail = last === "t" || last === "d" ? "ɪd" : VOICELESS.has(last) ? "t" : "d";
      break;
    case "s":
      tail = SIBILANT.has(last) ? "ɪz" : VOICELESS.has(last) || last === "θ" ? "s" : "z";
      break;
    case "ing":
      tail = "ɪŋ";
      if (optionalR) joined = `${body}r`;
      break;
    case "er":
      tail = accent === "UK" ? "ə(r)" : "ər";
      if (optionalR) joined = `${body}r`;
      break;
    case "est":
      tail = "ɪst";
      if (optionalR) joined = `${body}r`;
      break;
  }
  let out = joined + tail;
  // A one-syllable base that gains a syllable takes the stress mark, as two-syllable words have.
  if (!/[ˈˌ]/.test(out) && syllables(out) > 1 && syllables(out) > syllables(body)) out = `ˈ${out}`;
  return out;
}

/**
 * The entry for `word` worked out from the first base `find` knows, or null. `find` looks a
 * spelling up exactly (no further guessing).
 */
export function deriveEntry(word: string, find: (base: string) => IpaEntry | undefined): { base: string; entry: IpaEntry } | null {
  for (const { base, suffix } of baseCandidates(word)) {
    const entry = find(base);
    if (!entry) continue;
    const make = (accent: "UK" | "US"): readonly IpaReading[] => {
      const first = entry[accent][0];
      const ipa = first ? inflect(first.ipa, suffix, accent) : null;
      return ipa ? [Object.freeze({ ipa, derived: true as const })] : [];
    };
    const UK = make("UK");
    const US = make("US");
    if (UK.length || US.length) return { base, entry: Object.freeze({ UK, US }) };
  }
  return null;
}
