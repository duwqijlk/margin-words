// A saved word points at the word list. The notebook keeps the saved paragraph and reads the meaning from the list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";
import { asWordbookRecord, sourceKey } from "../src/lib/sync-merge.ts";
import { buildSyncItems, captureSnapshot, emptyMeta, noteChanges } from "../src/lib/sync-diff.ts";

const { glossRef, text } = await loadAppModules();
const { adoptWord, bookGlossKey, contextMark, phrasePoint, pointFromEntry, pointFromStored, presentWord, readPoint } = glossRef;
const { restoreParagraph } = text;

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

test("the notebook keeps the saved paragraph and reads the list meaning", () => {
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
  assert.equal(shown.sentence, EPUB);
  assert.equal(shown.meaning, "Strange and interesting.");
  assert.equal(shown.sources[0].sentence, EPUB);
  assert.equal(shown.sources[0].title, "Uploaded title");
  assert.equal(shown.sources[0].at.quote, "uploaded quote");
  assert.equal(JSON.stringify(shown.sources[0].ref).includes("uploaded"), false);
  assert.equal(JSON.stringify(shown).includes("meaning copied from the book file"), false);

  const waiting = presentWord(word, new Map());
  assert.equal(waiting.sentence, EPUB);
  assert.equal(waiting.meaning, EPUB);

  const blank = {
    ...word,
    sentence: "",
    meaning: "",
    sources: [{ ...word.sources[0], sentence: undefined, meaning: undefined }],
  };
  const fallback = presentWord(blank, new Map([[point.list, file]]));
  assert.equal(fallback.sentence, CONTEXT);
  assert.equal(fallback.meaning, "Strange and interesting.");
});

test("an older saved sentence still shows when no word list is loaded", () => {
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

const BOOK = "book:alice|carrolllewis";

function oldCurious(meaning = "Copied from the day it was saved.") {
  return {
    id: "1",
    surface: "curious",
    lemma: "curious",
    pos: "adjective",
    meaning,
    whyHard: "old note",
    recommend: true,
    sentence: `How ${CONTEXT} today, copied from the uploaded book.`,
    uses: "curious and curiouser",
    sources: [
      {
        book: BOOK,
        title: "Uploaded title",
        author: "Uploaded author",
        sentence: `How ${CONTEXT} today, copied from the uploaded book.`,
        meaning,
        surface: "curious",
        savedAt: 1,
        at: { chapter: 0, paragraph: 3, quote: "uploaded quote", offset: 4 },
      },
    ],
    stage: 2,
    dueAt: 1,
    createdAt: 1,
    reps: 3,
    lapses: 0,
  };
}

test("a stored sentence picks the list anchor and does not keep the sentence", () => {
  const point = pointFromStored("alice", "curious", "curious", oldCurious().sentence, file);
  assert.equal(point.list, "alice");
  assert.equal(point.chapter, 0);
  assert.equal(point.occurrence, 2);
  assert.equal(point.mark, contextMark(CONTEXT));
  assert.equal(JSON.stringify(point).includes("uploaded"), false);
  assert.equal(JSON.stringify(point).includes(CONTEXT), false);
});

test("a stored sentence with no matching snippet still points at the list", () => {
  const point = pointFromStored("alice", "curious", "curious", "A curious child walked in.", file);
  assert.deepEqual(point, { list: "alice" });
  const hit = readPoint(point, "curious", file);
  assert.equal(hit.meaning, "Wanting to know more.");
  assert.equal(hit.sentence, "");
});

test("a word that is not in the list keeps no pointer", () => {
  assert.equal(pointFromStored("alice", "faint", "faint", "A faint light on the water.", file), null);
});

test("an older save shows the current list meaning, and a later edit replaces it", () => {
  const word = oldCurious();
  const stored = word.sentence;
  const shown = presentWord(word, new Map([[bookGlossKey(BOOK), file]]));
  assert.equal(shown.sentence, stored);
  assert.equal(shown.meaning, "Strange and interesting.");
  assert.equal(shown.sources[0].sentence, stored);
  assert.equal(shown.sources[0].at.quote, "uploaded quote");
  assert.equal(JSON.stringify(shown).includes("Copied from the day"), false);
  assert.equal(word.meaning, "Copied from the day it was saved.");

  const edited = {
    ...file,
    glossary: {
      ...file.glossary,
      curious: {
        ...file.glossary.curious,
        senses: [
          {
            meaning: "Odd in a playful way.",
            pos: "adjective",
            anchors: [{ chapter: 0, occurrence: 2, form: "curious", context: CONTEXT }],
          },
        ],
      },
    },
  };
  const next = presentWord(word, new Map([[bookGlossKey(BOOK), edited]]));
  assert.equal(next.meaning, "Odd in a playful way.");
  assert.equal(next.sentence, stored);
  assert.equal(word.meaning, "Copied from the day it was saved.");
});

test("an easy word stays on its old sentence when the list has no entry", () => {
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
        book: BOOK,
        title: "Alice",
        author: "Lewis Carroll",
        sentence: "A faint light on the water.",
        meaning: "Not strong.",
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
  const shown = presentWord(word, new Map([[bookGlossKey(BOOK), file]]));
  assert.equal(shown.sentence, "A faint light on the water.");
  assert.equal(shown.meaning, "Not strong.");
});

test("adopting an older save stores a pointer and keeps the paragraph", () => {
  const word = oldCurious();
  const adopted = adoptWord(word, new Map([[BOOK, { list: "alice", file }]]));
  assert.equal(adopted.sentence, word.sentence);
  assert.equal(adopted.meaning, word.meaning);
  assert.equal(adopted.whyHard, "old note");
  assert.equal(adopted.reps, 3);
  assert.equal(adopted.sources[0].ref.list, "alice");
  assert.equal(adopted.sources[0].ref.chapter, 0);
  assert.equal(adopted.sources[0].sentence, word.sentence);
  assert.equal(adopted.sources[0].at.quote, "uploaded quote");
  assert.equal(JSON.stringify(adopted.sources[0].ref).includes("uploaded"), false);
  assert.equal(JSON.stringify(adopted.sources[0].ref).includes(CONTEXT), false);
  assert.equal(adoptWord(adopted, new Map([[BOOK, { list: "alice", file }]])), null);

  const parsed = asWordbookRecord(adopted);
  assert.equal(parsed.meaning, "");
  assert.equal(parsed.sources[0].ref.mark, contextMark(CONTEXT));
  const before = captureSnapshot({ books: [], words: [word], progress: {}, settings: {} });
  const after = captureSnapshot({ books: [], words: [adopted], progress: {}, settings: {} });
  const meta = noteChanges(emptyMeta(), before, after, 50);
  const oldKey = sourceKey(word.sources[0]);
  const newKey = sourceKey(adopted.sources[0]);
  assert.equal(meta.sourceRemoved.curious[oldKey], 50);
  assert.equal(meta.sourceRemoved.curious[newKey], undefined);
  const edited = {
    ...file,
    glossary: {
      curious: {
        ...file.glossary.curious,
        senses: [{ meaning: "Odd in a playful way.", anchors: [{ chapter: 0, occurrence: 2, context: CONTEXT }] }],
      },
    },
  };
  const shown = presentWord(adopted, new Map([["alice", edited]]));
  assert.equal(shown.meaning, "Odd in a playful way.");
  assert.equal(shown.sentence, word.sentence);
  const blob = JSON.stringify(buildSyncItems(after, meta));
  assert.equal(blob.includes("uploaded"), true);
  assert.equal(blob.includes("Copied from the day"), false);
  assert.equal(blob.includes('"ref"'), true);
});

test("a saved phrase becomes a phrase pointer", () => {
  const point = pointFromStored("alice", "give up", "give up", "I will give up now.", file);
  assert.equal(point.phrase, true);
  assert.equal(point.list, "alice");
  const hit = readPoint(point, "give up", file);
  assert.equal(hit.meaning, "Stop trying.");
  assert.equal(hit.sentence, "");
});

test("sync keeps the pointer and the paragraph, and drops the stored meaning", () => {
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
  assert.equal(parsed.sentence, EPUB);
  assert.equal(parsed.meaning, "");
  assert.equal(parsed.whyHard, "");
  assert.equal(parsed.uses, undefined);
  assert.equal(parsed.stage, 2);
  assert.equal(parsed.sources[0].ref.list, "alice");
  assert.equal(parsed.sources[0].ref.mark, point.mark);
  assert.equal(parsed.sources[0].sentence, EPUB);
  assert.equal(parsed.sources[0].meaning, undefined);
  assert.equal(parsed.sources[0].at.quote, "uploaded quote");
  assert.equal(parsed.sources[0].title, "Alice");
  assert.equal(parsed.sources[0].chapter, 0);
  const key = sourceKey(parsed.sources[0]);
  assert.equal(parsed.sources[0].k, key);
  assert.equal(key.includes("alice"), true);

  const snapshot = captureSnapshot({
    books: [],
    words: [parsed],
    progress: {},
    settings: {},
  });
  const items = buildSyncItems(snapshot, emptyMeta());
  const blob = JSON.stringify(items);
  assert.equal(blob.includes(EPUB), true);
  assert.equal(blob.includes("copied meaning"), false);
  assert.equal(blob.includes(CONTEXT), false);
  assert.equal(blob.includes('"ref"'), true);
});

test("a missing paragraph is filled from the chapter that holds that occurrence", () => {
  const chapters = [
    { paragraphs: ["Nothing here.", "Alice was curious. Then she was curious again about the rabbit."] },
    { paragraphs: ["Later she saw a door. She did not give up."] },
  ];
  assert.equal(
    restoreParagraph({ surface: "curious", chapter: 0, occurrence: 2, chapters }),
    "Then she was curious again about the rabbit.",
  );
  assert.equal(
    restoreParagraph({ surface: "give up", phrase: true, chapter: 1, chapters }),
    "She did not give up.",
  );
  assert.equal(
    restoreParagraph({
      surface: "curious",
      chapter: 1,
      occurrence: 9,
      hint: "curious again about the rabbit",
      chapters,
    }),
    "Then she was curious again about the rabbit.",
  );
  assert.equal(
    restoreParagraph({ surface: "curious", chapter: 1, occurrence: 9, guess: false, chapters }),
    "",
  );
});
