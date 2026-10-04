import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { paragraphNote, epub, help, flow } = await loadAppModules();
const { cleanParagraphNote, paragraphNoteFlags, paragraphNoteOwners, paragraphNoteAt, resolveParagraphNotes, resolveParagraphNoteLists, resolveParagraphNotesInBook, resolveParagraphNoteListsInBook } = paragraphNote;

const note = (over = {}) => ({
  chapter: 0,
  paragraph: 1,
  context: "the old man walked slowly home",
  mainIdea: "An old man goes home.",
  simple: "The old man walked home slowly.",
  ...over,
});
const text = "Then the old man walked slowly home, tired.";

test("a real mainIdea and simple make a note", () => {
  assert.deepEqual(cleanParagraphNote(note()), {
    mainIdea: "An old man goes home.",
    simple: "The old man walked home slowly.",
    hardWords: [],
  });
});

test("empty, blank, missing or non-string text is no note", () => {
  for (const bad of [
    note({ mainIdea: "" }),
    note({ simple: "" }),
    note({ mainIdea: "   \n\t " }),
    note({ simple: "  " }),
    note({ mainIdea: undefined }),
    note({ simple: null }),
    note({ mainIdea: 12 }),
    note({ simple: ["x"] }),
    null,
    undefined,
    "text",
  ]) {
    assert.equal(cleanParagraphNote(bad), null);
  }
});

test("a note that holds Chinese is no note", () => {
  assert.equal(cleanParagraphNote(note({ simple: "The man went \u56de\u5bb6." })), null);
});

test("the bulb flag is true only for a paragraph with a real, fitting note", () => {
  const list = [note(), note({ paragraph: 2, context: "nothing here matches", mainIdea: "x", simple: "y" })];
  const texts = ["Short.", text, "A paragraph with only hard words in it, like waistcoat and hedge."];
  assert.deepEqual(paragraphNoteFlags(list, 0, texts), [false, true, false]);
});

test("an entry with blank text does not light the bulb even when its context fits", () => {
  assert.deepEqual(paragraphNoteFlags([note({ mainIdea: " " })], 0, [text]), [false]);
  assert.deepEqual(paragraphNoteFlags([note({ simple: "" })], 0, [text]), [false]);
});

test("no notes at all: no bulbs", () => {
  assert.deepEqual(paragraphNoteFlags([], 0, [text, text]), [false, false]);
});

test("Alice: only paragraphs with a note get a bulb, each note lights its own paragraph", () => {
  const glossary = JSON.parse(readFileSync(new URL("../public-books/alice/glossary.json", import.meta.url), "utf8"));
  const list = glossary.paragraphs.filter((entry) => entry.chapter === 0);
  const texts = [];
  for (const entry of list) texts[entry.paragraph] = `Before it. ${entry.context}. After it.`;
  for (let i = 0; i < texts.length; i += 1) texts[i] ??= "Alice was beginning to get very tired of sitting by her sister on the bank.";
  const flags = paragraphNoteFlags(list, 0, texts);
  assert.equal(flags.filter(Boolean).length, new Set(list.map((entry) => entry.paragraph)).size);
  for (const entry of list) assert.equal(flags[entry.paragraph], true);
});

test("no minimum length: a one-line dialogue and a heading with a note get the bulb", () => {
  const list = [
    note({ paragraph: 0, context: "Chapter Four", mainIdea: "A new chapter starts.", simple: "This is the title of chapter four." }),
    note({ paragraph: 1, context: "Don't forget the rhyme book!", mainIdea: "Annie reminds Jack.", simple: "Annie says to remember the book of rhymes." }),
    note({ paragraph: 2, context: "Icicle was definitely here.", mainIdea: "Icicle was here.", simple: "Someone saw that Icicle had been there." }),
  ];
  const texts = ["Chapter Four", "\u201cDon\u2019t forget the rhyme book!\u201d said Annie.", "Icicle was definitely here.", "A plain line."];
  assert.deepEqual(paragraphNoteFlags(list, 0, texts), [true, true, true, false]);
});

test("a short context found in many paragraphs lights only the paragraph the note belongs to", () => {
  const sora = note({ paragraph: 24, context: "Sora.", mainIdea: "A name is called.", simple: "Someone calls the name Sora." });
  const texts = Array.from({ length: 45 }, (_, i) => (i % 3 === 0 ? `Mina said, \u201cSora.\u201d number ${i}` : `Nothing here ${i}`));
  texts[24] = "He whispered, \u201cSora.\u201d";
  const flags = paragraphNoteFlags([sora], 0, texts);
  assert.equal(flags.filter(Boolean).length, 1);
  assert.equal(flags[24], true);
});

test("a stale id moves the note to the nearest paragraph that holds the context, and to one only", () => {
  const stale = note({ paragraph: 10, context: "Heart-of-the-Wind", mainIdea: "A name.", simple: "A place is named." });
  const texts = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? `We sailed to Heart-of-the-Wind ${i}` : `Other line ${i}`));
  texts[10] = "A line whose number moved";
  const owners = paragraphNoteOwners([stale], 0, texts);
  assert.equal(owners.filter(Boolean).length, 1);
  assert.equal(owners[10], null);
  assert.ok(owners[8] === stale || owners[12] === stale);
});

test("a stale note does not take a paragraph that another note owns by its id", () => {
  const exact = note({ paragraph: 2, context: "QUEEN OASIS", mainIdea: "A queen.", simple: "The queen is called Oasis." });
  const stale = note({ paragraph: 9, context: "QUEEN OASIS", mainIdea: "Another.", simple: "A second note." });
  const texts = ["x", "y", "QUEEN OASIS", "QUEEN OASIS", "z"];
  const owners = paragraphNoteOwners([exact, stale], 0, texts);
  assert.equal(owners[2], exact);
  assert.equal(owners[3], stale);
  assert.equal(owners.filter(Boolean).length, 2);
});

test("a note stays in its own chapter when the text is there", () => {
  const other = note({ chapter: 1, paragraph: 0, context: "Sora." });
  const owners = resolveParagraphNotes([other], [["Sora."], ["Sora."]]);
  assert.equal(owners[0][0], null);
  assert.equal(owners[1][0], other);
});

const litAt = (owners) => owners.flatMap((row, c) => row.map((o, i) => (o ? [c, i] : null))).filter(Boolean);

test("a wrong-chapter note (imported EPUB with other chapter numbers) resolves to the one paragraph that holds its context", () => {
  const lost = note({ chapter: 9, paragraph: 4, context: "the lamp-post in the snowy wood", mainIdea: "A lamp in the woods.", simple: "There is a lamp in a snowy wood." });
  const chapters = [
    ["Other text.", "More other text."],
    ["Nothing.", "Nothing."],
    ["Tumnus pointed at the lamp-post in the snowy wood, too.", "Nothing."],
  ];
  assert.deepEqual(litAt(resolveParagraphNotes([lost], chapters)), [[2, 0]]);
});

test("the whole-book step needs exactly one match: two matching paragraphs give the note no paragraph", () => {
  const lost = note({ chapter: 9, paragraph: 4, context: "the lamp-post in the snowy wood" });
  const chapters = [
    ["Other text."],
    ["Lucy saw the lamp-post in the snowy wood at last."],
    ["Tumnus pointed at the lamp-post in the snowy wood, too."],
  ];
  const reports = [];
  const owners = resolveParagraphNotes([lost], chapters, (entry, why, matches) => reports.push([entry, why, matches]));
  assert.deepEqual(litAt(owners), []);
  assert.deepEqual(reports, [[lost, "ambiguous", 2]]);
});

test("the whole-book step does not prefer an exact whole-paragraph match, the nearest chapter or the nearest id", () => {
  const lost = note({ chapter: 40, paragraph: 0, context: "Sora." });
  const chapters = [["Sora."], ["Mina said, \u201cSora.\u201d"], ["He called Sora. Nobody came."]];
  assert.deepEqual(litAt(resolveParagraphNotes([lost], chapters)), []);
  const wrongId = note({ chapter: 40, paragraph: 3, context: "Sora." });
  assert.deepEqual(litAt(resolveParagraphNotes([wrongId], chapters)), []);
});

test("an unresolved note is reported: only 'no-match' and 'ambiguous' exist", () => {
  const nowhere = note({ chapter: 0, paragraph: 0, context: "words that are not in the book" });
  const twice = note({ chapter: 9, paragraph: 0, context: "QUEEN OASIS", mainIdea: "Second.", simple: "A second note." });
  const reports = [];
  resolveParagraphNotes([nowhere, twice], [["QUEEN OASIS", "QUEEN OASIS"]], (entry, why, matches) => reports.push([entry, why, matches]));
  assert.deepEqual(reports, [[nowhere, "no-match", 0], [twice, "ambiguous", 2]]);
});

test("a single match joins the notes the paragraph already owns (a paragraph may own several notes)", () => {
  const exact = note({ chapter: 0, paragraph: 0, context: "QUEEN OASIS" });
  const joiner = note({ chapter: 5, paragraph: 0, context: "QUEEN OASIS", mainIdea: "Second.", simple: "A second note." });
  const reports = [];
  const chapters = [["QUEEN OASIS"]];
  const lists = resolveParagraphNoteLists([exact, joiner], chapters, (...args) => reports.push(args));
  assert.deepEqual(lists, [[[exact, joiner]]]);
  assert.deepEqual(reports, [], "nothing is unresolved");
  assert.equal(resolveParagraphNotes([exact, joiner], chapters)[0][0], exact, "the first note stays the main owner");
  assert.deepEqual(paragraphNoteFlags([exact, joiner], 0, ["QUEEN OASIS"]), [true]);
});

test("a note whose chapter has no match falls through to the rest of the book", () => {
  const lost = note({ chapter: 0, paragraph: 0, context: "the lamp-post" });
  const owners = resolveParagraphNotes([lost], [["Nothing here."], ["By the lamp-post, she waited."]]);
  assert.equal(owners[0][0], null);
  assert.equal(owners[1][0], lost);
});

test("a 'Sora.'-style short context with a stale chapter lights nothing when it is found in many paragraphs", () => {
  const sora = note({ chapter: 40, paragraph: 24, context: "Sora.", mainIdea: "A name is called.", simple: "Someone calls the name Sora." });
  const chapters = [0, 1, 2, 3].map((c) => Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? `Mina said, \u201cSora.\u201d ${c}-${i}` : `Nothing ${c}-${i}`)));
  chapters[2][5] = "\u201cSora.\u201d";
  assert.deepEqual(litAt(resolveParagraphNotes([sora], chapters)), []);
});

test("a 'Sora.' note with the right chapter still lights exactly its own paragraph", () => {
  const sora = note({ chapter: 2, paragraph: 5, context: "Sora.", mainIdea: "A name is called.", simple: "Someone calls the name Sora." });
  const chapters = [0, 1, 2, 3].map((c) => Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? `Mina said, \u201cSora.\u201d ${c}-${i}` : `Nothing ${c}-${i}`)));
  chapters[2][5] = "\u201cSora.\u201d";
  assert.deepEqual(litAt(resolveParagraphNotes([sora], chapters)), [[2, 5]]);
  chapters[2][5] = "Another line";
  chapters[2][4] = "He said, \u201cSora.\u201d";
  assert.deepEqual(litAt(resolveParagraphNotes([sora], chapters)), [[2, 4]], "step 2: nearest match inside the note's own chapter, as before");
});

test("steps 1 and 2 still skip a paragraph that has an owner", () => {
  const first = note({ chapter: 0, paragraph: 1, context: "QUEEN OASIS" });
  const stale = note({ chapter: 0, paragraph: 1, context: "QUEEN OASIS", mainIdea: "Second.", simple: "A second note." });
  const chapters = [["x", "QUEEN OASIS", "QUEEN OASIS"]];
  const lists = resolveParagraphNoteLists([first, stale], chapters);
  assert.deepEqual(lists, [[[], [first], [stale]]], "the second note moves to the other matching paragraph of its chapter");
});

test("the whole-book count includes paragraphs that already own a note: two matches, one of them owned, still means no bulb", () => {
  const exact = note({ chapter: 1, paragraph: 0, context: "QUEEN OASIS" });
  const lost = note({ chapter: 7, paragraph: 3, context: "QUEEN OASIS", mainIdea: "Second.", simple: "A second note." });
  const reports = [];
  const owners = resolveParagraphNotes([exact, lost], [["x", "QUEEN OASIS"], ["QUEEN OASIS", "y"]], (entry, why, matches) => reports.push([entry, why, matches]));
  assert.deepEqual(litAt(owners), [[1, 0]]);
  assert.deepEqual(reports, [[lost, "ambiguous", 2]]);
});

test("a note with blank text takes no paragraph, so it cannot hide a real note", () => {
  const blank = note({ chapter: 0, paragraph: 0, mainIdea: " " });
  const real = note({ chapter: 5, paragraph: 0 });
  const owners = resolveParagraphNotes([blank, real], [[text]]);
  assert.equal(owners[0][0], real);
});

test("the panel gets the same owner: paragraphNoteAt matches the bulb flags", () => {
  const list = [note({ paragraph: 1 })];
  const texts = ["The old man walked slowly home, again.", text];
  assert.equal(paragraphNoteAt(list, 0, texts, 0), null);
  assert.equal(paragraphNoteAt(list, 0, texts, 1)?.mainIdea, "An old man goes home.");
  assert.deepEqual(paragraphNoteFlags(list, 0, texts), [false, true]);
});

test("Alice (real book): every note finds its paragraph even when all chapter numbers and ids are wrong", { skip: existsSync(new URL("../public-books/alice/book.epub", import.meta.url)) ? false : "public-domain EPUB is not in git" }, async () => {
  const bytes = readFileSync(new URL("../public-books/alice/book.epub", import.meta.url));
  const book = await epub.parseEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { cover: false });
  const chapters = book.chapters.map((chapter) => {
    const doc = new DOMParser().parseFromString(`<div>${chapter.html}</div>`, "text/html");
    return help.paragraphBlocks(doc.body).map((block) => flow.flowText(block));
  });
  const { paragraphs } = JSON.parse(readFileSync(new URL("../public-books/alice/glossary.json", import.meta.url), "utf8"));
  const lit = (list) => resolveParagraphNotes(list, chapters).flat().filter(Boolean).length;
  assert.equal(lit(paragraphs), paragraphs.length);
  const reports = [];
  resolveParagraphNotes(paragraphs, chapters, (entry, why) => reports.push([entry.context, why]));
  assert.deepEqual(reports, [], "a real word list as written never needs the whole-book step");
  assert.equal(lit(paragraphs.map((e) => ({ ...e, chapter: e.chapter + 2 }))), paragraphs.length);
  assert.equal(lit(paragraphs.map((e) => ({ ...e, chapter: 99, paragraph: 0 }))), paragraphs.length);
});

const lantern = "She lifted the brass lantern from the hook.";

test("a paragraph note with chapter x2 lights the one matching paragraph of that extra", () => {
  const entry = note({ chapter: "x2", paragraph: 1, context: "the brass lantern from the hook", mainIdea: "A lantern is lifted.", simple: "She picked up the lantern." });
  const chapters = [["She lifted the brass lantern from the hook in a numbered chapter too."]];
  const extras = [{ id: "x2", paragraphs: ["A title line.", lantern, "The stair was dark."] }];
  const placed = resolveParagraphNotesInBook([entry], chapters, extras);
  assert.equal(placed.extras.x2[1], entry);
  assert.equal(placed.extras.x2.filter(Boolean).length, 1);
  assert.equal(placed.chapters[0][0], null, "steps 1 and 2 stay inside the named extra");
});

test("a whole-book note that matches one paragraph of an extra gets a bulb there", () => {
  const entry = note({ chapter: 40, paragraph: 0, context: "the brass lantern from the hook", mainIdea: "A lantern is lifted.", simple: "She picked up the lantern." });
  const placed = resolveParagraphNotesInBook(
    [entry],
    [["Nothing about a light here."]],
    [{ id: "x2", paragraphs: ["Before the stair.", lantern] }],
  );
  assert.equal(placed.chapters[0][0], null);
  assert.equal(placed.extras.x2[1], entry);
});

test("a whole-book note that matches a numbered chapter and an extra gets no bulb", () => {
  const entry = note({ chapter: 40, paragraph: 0, context: "the brass lantern from the hook", mainIdea: "A lantern is lifted.", simple: "She picked up the lantern." });
  const reports = [];
  const placed = resolveParagraphNotesInBook(
    [entry],
    [[lantern]],
    [{ id: "x3", paragraphs: ["Later she lifted the brass lantern from the hook again."] }],
    (row, why, matches) => reports.push([row, why, matches]),
  );
  assert.equal(placed.chapters[0][0], null);
  assert.equal(placed.extras.x3[0], null);
  assert.deepEqual(reports, [[entry, "ambiguous", 2]]);
});

test("a single whole-book match inside an extra joins the note that extra paragraph already owns", () => {
  const primary = note({ chapter: "x2", paragraph: 0, context: "the brass lantern from the hook" });
  const joiner = note({ chapter: 9, paragraph: 3, context: "the brass lantern from the hook", mainIdea: "Second.", simple: "A second note." });
  const lists = resolveParagraphNoteListsInBook([primary, joiner], [["Other text."]], [{ id: "x2", paragraphs: [lantern] }]);
  assert.deepEqual(lists.extras.x2[0], [primary, joiner], "the first note placed stays primary");
  const owners = resolveParagraphNotesInBook([primary, joiner], [["Other text."]], [{ id: "x2", paragraphs: [lantern] }]);
  assert.equal(owners.extras.x2[0], primary);
});
