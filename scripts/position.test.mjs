// File-independent places: a saved place still resolves in a differently packaged copy of the same book.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorFits, asAnchor, findSentence, makeAnchor, resolveAnchor, restoreReadingPlace, sentenceAnchor } from "../src/lib/position.ts";

const chapters = [
  ["CHAPTER ONE", "It was a dark morning and the rain fell on the old harbour town.", "Nobody saw the small boat leave the quay before sunrise.", "A faint light moved across the water like a lost star."],
  ["CHAPTER TWO", "The captain counted the coins twice and then a third time slowly."],
];

test("makeAnchor keeps the paragraph id and a short quote around the word", () => {
  const text = chapters[0][3];
  const at = makeAnchor({ chapter: 0, paragraph: 3, text, at: text.indexOf("faint"), length: 5 });
  assert.equal(at.chapter, 0);
  assert.equal(at.paragraph, 3);
  assert.ok(at.quote.includes("faint"));
  assert.ok(at.quote.length <= 85);
  assert.equal(text.indexOf(at.quote), at.offset);
});

test("same file: the stored paragraph id is found directly", () => {
  const at = makeAnchor({ chapter: 0, paragraph: 2, text: chapters[0][2], at: 0 });
  assert.deepEqual(
    { ...resolveAnchor(at, chapters) },
    { chapter: 0, paragraph: 2, offset: 0, via: "paragraph" },
  );
});

test("another copy with an extra title page: the quote still finds the paragraph", () => {
  const at = makeAnchor({ chapter: 0, paragraph: 2, text: chapters[0][2], at: 0 });
  const shifted = [["TITLE", "Copyright page", ...chapters[0]], chapters[1]];
  const hit = resolveAnchor(at, shifted);
  assert.equal(hit.via, "chapter");
  assert.equal(hit.chapter, 0);
  assert.equal(hit.paragraph, 4);
});

test("another copy that splits chapters differently: found in a nearby chapter", () => {
  const at = makeAnchor({ chapter: 1, paragraph: 1, text: chapters[1][1], at: 0 });
  const merged = [[...chapters[0], ...chapters[1]]];
  const hit = resolveAnchor(at, merged);
  assert.equal(hit.via, "chapter");
  assert.equal(hit.paragraph, 5);
});

test("a small edit in the text still resolves through half of the quote", () => {
  const at = makeAnchor({ chapter: 0, paragraph: 1, text: chapters[0][1], at: 0 });
  const edited = [[...chapters[0].slice(0, 1), "It was a dark morning and the rain fell on the OLD HARBOUR TOWN, said the book.", ...chapters[0].slice(2)], chapters[1]];
  const hit = resolveAnchor(at, edited);
  assert.equal(hit.chapter, 0);
  assert.equal(hit.paragraph, 1);
});

test("a quote that is nowhere falls back to the nearest ids, and never throws", () => {
  const at = { chapter: 1, paragraph: 40, quote: "nothing like this anywhere in the file", offset: 0 };
  const hit = resolveAnchor(at, chapters);
  assert.equal(hit.via, "nearest");
  assert.equal(hit.chapter, 1);
  assert.equal(hit.paragraph, 1);
  assert.deepEqual(resolveAnchor(at, []), { chapter: 0, paragraph: 0, offset: 0, via: "nearest" });
});

test("asAnchor accepts a real anchor and refuses junk", () => {
  assert.ok(asAnchor({ chapter: 1, paragraph: 2, quote: "A few words of text", offset: 3 }));
  assert.equal(asAnchor(null), null);
  assert.equal(asAnchor({ chapter: 1, paragraph: 2 }), null);
  assert.equal(asAnchor({ chapter: 1, paragraph: 2, quote: "!", offset: 0 }), null);
});

test("findSentence places a saved sentence that had no place yet", () => {
  const at = findSentence("A faint light moved across the water like a lost star.", "faint", chapters, 1);
  assert.ok(at);
  assert.equal(at.chapter, 0);
  assert.equal(at.paragraph, 3);
  assert.equal(findSentence("This sentence is not in the book at all.", "sentence", chapters), null);
});

test("a place made from a sentence alone is found in the whole book", () => {
  const at = sentenceAnchor("Nobody saw the small boat leave the quay before sunrise.", 1);
  const hit = resolveAnchor(at, chapters);
  assert.equal(hit.chapter, 0);
  assert.equal(hit.paragraph, 2);
  assert.equal(hit.via, "book");
  assert.equal(anchorFits(at, chapters[0][2]), true);
  assert.equal(anchorFits(at, chapters[0][1]), false);
});

const extraLine = "The brass lantern hung above the narrow stair and lit the last step.";

test("restore uses the anchor inside the extra, even when a numbered chapter has the same words", () => {
  const anchor = makeAnchor({ chapter: 9, paragraph: 3, text: extraLine, at: 4, length: 6 });
  const place = restoreReadingPlace(
    { chapter: 1, extraId: "x2", anchor },
    {
      chapters: [["Other."], [extraLine]],
      extras: [{ id: "x2", paragraphs: ["Before.", extraLine, "After."] }],
    },
  );
  assert.equal(place.extraId, "x2");
  assert.equal(place.chapter, 1);
  assert.equal(place.paragraph, 1);
});

test("restore with only extraId, only an anchor, or neither", () => {
  const onlyExtra = restoreReadingPlace(
    { chapter: 2, extraId: "x3" },
    { chapters: [["A chapter."]], extras: [{ id: "x3", paragraphs: ["An extra page."] }] },
  );
  assert.deepEqual(onlyExtra, { extraId: "x3", chapter: 2, paragraph: null });

  const anchor = makeAnchor({ chapter: 0, paragraph: 1, text: chapters[0][1], at: 0 });
  const onlyAnchor = restoreReadingPlace({ chapter: 4, anchor }, { chapters, extras: [{ id: "x2", paragraphs: ["Elsewhere."] }] });
  assert.equal(onlyAnchor.extraId, "");
  assert.equal(onlyAnchor.chapter, 0);
  assert.equal(onlyAnchor.paragraph, 1);

  const neither = restoreReadingPlace({ chapter: 2 }, { chapters });
  assert.deepEqual(neither, { extraId: "", chapter: 2, paragraph: null });

  const unknownExtra = restoreReadingPlace(
    { chapter: 1, extraId: "x9", anchor },
    { chapters, extras: [{ id: "x2", paragraphs: [extraLine] }] },
  );
  assert.equal(unknownExtra.extraId, "");
  assert.equal(unknownExtra.chapter, 0);
  assert.equal(unknownExtra.paragraph, 1);
});
