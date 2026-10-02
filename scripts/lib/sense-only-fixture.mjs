/**
 * A real word list (the sample book's glossary.json) with three `senseOnly` entries added:
 *   - "light": 4 uses in the book, one sense, one position (chapter 2, 2nd "light") -> underlined once
 *   - "stood": 2 uses, one sense placed by a context snippet in chapter 1               -> underlined once
 *   - "run":   no use of "run" itself; "ran" is a form used once (context anchor)        -> underlined once
 * Used by scripts/sense-only.test.mjs and scripts/sense-only-e2e.mjs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SAMPLE_EPUB_PATH = join(ROOT, "examples/sample-book/the-lantern-seller.epub");
export const SAMPLE_LIST_PATH = join(ROOT, "examples/sample-book/glossary.json");

export const SENSE_ONLY_MEANINGS = {
  light: "The thing that lets you see (a lamp or flame).",
  stood: "Stayed upright in one place.",
  run: "Go along or lie along, like a lane by a river.",
};

export function senseOnlyGlossary() {
  const base = JSON.parse(readFileSync(SAMPLE_LIST_PATH, "utf8"));
  base.glossary.light = {
    senseOnly: true,
    pos: "noun",
    meaning: SENSE_ONLY_MEANINGS.light,
    whyHard: "Common word, but here it is the lantern's glow.",
    senses: [
      {
        meaning: SENSE_ONLY_MEANINGS.light,
        anchors: [{ chapter: 2, occurrence: 2, context: "Halfway home, the light fell on a loose stone" }],
      },
    ],
  };
  base.glossary.stood = {
    senseOnly: true,
    pos: "past-tense verb",
    meaning: SENSE_ONLY_MEANINGS.stood,
    whyHard: "Used in an old-fashioned word order here.",
    senses: [
      {
        meaning: SENSE_ONLY_MEANINGS.stood,
        anchors: [{ chapter: 1, context: "a deep, calm blue and stood perfectly still" }],
      },
    ],
  };
  base.glossary.run = {
    senseOnly: true,
    pos: "verb",
    meaning: SENSE_ONLY_MEANINGS.run,
    whyHard: "A very common word with an unusual meaning here.",
    forms: ["ran"],
    senses: [
      {
        meaning: SENSE_ONLY_MEANINGS.run,
        forms: ["ran"],
        anchors: [{ chapter: 1, context: "lane that led to her house. It ran beside the river", form: "ran" }],
      },
    ],
  };
  return base;
}
