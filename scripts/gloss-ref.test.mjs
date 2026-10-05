// A saved word points at the word list. The snippet on screen is the list's own context.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";
import { asWordbookRecord, sourceKey } from "../src/lib/sync-merge.ts";
import { buildSyncItems, captureSnapshot, emptyMeta } from "../src/lib/sync-diff.ts";

const { glossRef } = await loadAppModules();
const { contextMark, phrasePoint, pointFromEntry, presentWord, readPoint } = glossRef;

const CONTEXT = "curiouser and curiouser cried Alice";
const EPUB = "The full sentence copied from the uploaded book, which must never be shown.";

const file = {
  title: "Alice's Adventures in Wonderland",
  author: "Lewis Carroll",
  glossary: {
    curious: {
      pos: "adjective",
      meaning: "Wanting to know more.",
      whyHard: "The book uses it in a playful way.",
      senses: [
        {
          meaning: "Strange and interesting.",
          pos: "adjective",
          whyHard: "Here it means odd, not only inquisitive.",
          anchors: [
            {
              chapter: 0,
              occurrence: 2,
              form: "curious",
              context: CONTEXT,
            },
          ],
        },
      ],
    },
    see: {
      pos: "base verb",
      meaning: "To notice with your eyes.",
      whyHard: "",
      senses: [
        {
          meaning: "Noticed with the eyes.",
          anchors: [{ chapter: 1, occurrence: 4, form: "saw", context: "she saw a white rabbit" }],
        },
      ],
    },
  },
  phrases: {
    "give up": { meaning: "Stop trying.", pos: "phrasal verb" },
  },
};

const tap = {
  chapter: 0,
  surface: "curious",
  occurrence: 2,
  paragraph: `How ${CONTEXT} today`,
  before: "How ",
};

test("a new pointer stores the list place, not the e-book sentence", () => {
  const point = pointFromEntry("alice", "curious", file.glossary.curious, tap);
  assert.equal(point.list, "alice");
  assert.equal(point.chapter, 0);
  assert.equal(point.occurrence, 2);
  assert.equal(point.form, undefined);
  assert.equal(point.mark, contextMark(CONTEXT));
  assert.equal(JSON.stringify(point).includes("uploaded"), false);
  assert.equal(JSON.stringify(point).includes(CONTEXT), false);
});

test("a different word form is kept on the pointer", () => {
  const point = pointFromEntry("alice", "see", file.glossary.see, {
    chapter: 1,
    surface: "saw",
    occurrence: 4,
    paragraph: "and she saw a white rabbit run",
    before: "and she ",
  });
  assert.equal(point.form, "saw");
  assert.equal(point.chapter, 1);
  assert.equal(point.occurrence, 4);
});

test("reading a pointer uses the list snippet, including when chapter numbers were removed", () => {
  const point = pointFromEntry("alice", "curious", file.glossary.curious, tap);
  const hit = readPoint(point, "curious", file);
  assert.equal(hit.sentence, CONTEXT);
  assert.equal(hit.meaning, "Strange and interesting.");
  assert.equal(hit.sentence.includes("uploaded"), false);

  const stripped = {
    ...file,
    glossary: {
      curious: {
        ...file.glossary.curious,
        senses: [
          {
            meaning: "Strange and interesting.",
            pos: "adjective",
            anchors: [{ context: CONTEXT }],
          },
        ],
      },
    },
  };
  const byMark = readPoint(point, "curious", stripped);
  assert.equal(byMark.sentence, CONTEXT);
  assert.equal(byMark.meaning, "Strange and interesting.");
});

test("a phrase pointer has no snippet and uses the phrase meaning", () => {
  const hit = readPoint(phrasePoint("alice"), "give up", file);
  assert.equal(hit.sentence, "");
  assert.equal(hit.meaning, "Stop trying.");
  assert.equal(hit.pos, "phrasal verb");
});

test("the notebook copy ignores a sentence stored next to the pointer", () => {
  const point = pointFromEntry("alice", "curious", file.glossary.curious, tap);
  const word = {
    id: "1",
    surface: "curious",
    lemma: "curious",
    pos: "adjective",
    meaning: EPUB,
    whyHard: "from the book file",
    recommend: true,
    sentence: EPUB,
    sources: [
      {
        book: "book:alice|carrolllewis",
        title: "Uploaded title",
        author: "Uploaded author",
        sentence: EPUB,
        meaning: "meaning copied from the book file",
        surface: "curious",
        savedAt: 1,
        at: { chapter: 0, paragraph: 3, quote: "uploaded quote", offset: 4 },
        ref: point,
      },
    ],
    stage: 0,
    dueAt: 1,
    createdAt: 1,
    reps: 0,
    lapses: 0,
  };
  const shown = presentWord(word, new Map([[point.list, file]]));
  assert.equal(shown.sentence, CONTEXT);
  assert.equal(shown.meaning, "Strange and interesting.");
  assert.equal(shown.sources[0].at, undefined);
  assert.equal(JSON.stringify(shown.sources[0]).includes("uploaded"), false);
  assert.equal(JSON.stringify(shown.sources[0]).includes("Uploaded"), false);

  const waiting = presentWord(word, new Map());
  assert.equal(waiting.sentence, "");
  assert.equal(waiting.meaning, "");
  assert.equal(JSON.stringify(waiting).includes("uploaded"), false);
});

test("an older saved sentence still shows when the word has no pointer", () => {
  const word = {
    id: "1",
    surface: "faint",
    lemma: "faint",
    pos: "adjective",
    meaning: "Not strong.",
    whyHard: "",
    recommend: true,
    sentence: "A faint light on the water.",
    sources: [
      {
        book: "book:alice|carrolllewis",
        title: "Alice",
        author: "Lewis Carroll",
        sentence: "A faint light on the water.",
        surface: "faint",
        savedAt: 1,
      },
    ],
    stage: 0,
    dueAt: 1,
    createdAt: 1,
    reps: 0,
    lapses: 0,
  };
  const shown = presentWord(word, new Map());
  assert.equal(shown.sentence, "A faint light on the water.");
  assert.equal(shown.sources[0].sentence, "A faint light on the water.");
});

test("sync keeps the pointer and drops the e-book sentence", () => {
  const point = { list: "alice", chapter: 0, occurrence: 2, mark: contextMark(CONTEXT) };
  const parsed = asWordbookRecord({
    id: "1",
    lemma: "curious",
    surface: "curious",
    pos: "adjective",
    meaning: EPUB,
    whyHard: "because the book said so",
    recommend: true,
    sentence: EPUB,
    stage: 2,
    dueAt: 10,
    createdAt: 10,
    reps: 1,
    lapses: 0,
    updatedAt: 20,
    uses: "curious and curiouser",
    sources: [
      {
        book: "book:alice|carrolllewis",
        title: "Alice",
        author: "Carroll",
        sentence: EPUB,
        meaning: "copied meaning",
        surface: "curious",
        savedAt: 5,
        pos: "adjective",
        chapter: 0,
        at: { chapter: 0, paragraph: 1, quote: "uploaded quote", offset: 0 },
        ref: point,
      },
    ],
  });
  assert.equal(parsed.sentence, "");
  assert.equal(parsed.meaning, "");
  assert.equal(parsed.whyHard, "");
  assert.equal(parsed.uses, undefined);
  assert.equal(parsed.stage, 2);
  assert.equal(parsed.sources[0].ref.list, "alice");
  assert.equal(parsed.sources[0].ref.mark, point.mark);
  assert.equal(parsed.sources[0].sentence, undefined);
  assert.equal(parsed.sources[0].at, undefined);
  assert.equal(parsed.sources[0].title, undefined);
  assert.equal(parsed.sources[0].chapter, 0);
  const key = sourceKey(parsed.sources[0]);
  assert.equal(parsed.sources[0].k, key);
  assert.equal(key.includes("alice"), true);
  assert.ok(JSON.stringify(parsed).length < 500);

  const snapshot = captureSnapshot({
    books: [],
    words: [parsed],
    progress: {},
    settings: {},
  });
  const items = buildSyncItems(snapshot, emptyMeta());
  const blob = JSON.stringify(items);
  assert.equal(blob.includes("uploaded"), false);
  assert.equal(blob.includes(CONTEXT), false);
  assert.equal(blob.includes('"ref"'), true);
});
