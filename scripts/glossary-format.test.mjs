import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModules } from "./lib/app-modules.mjs";

const { format, text } = await loadAppModules();
const ok = (value) => format.validateGlossary(value);

test("segmentation 2 is kept, and any other value is only a warning", () => {
  const good = ok({
    version: 2,
    segmentation: 2,
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(good.ok, true);
  assert.equal(good.file.segmentation, 2);
  const ignored = ok({
    version: 2,
    segmentation: 1,
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(ignored.ok, true);
  assert.equal(ignored.file.segmentation, undefined);
  assert.match(ignored.warnings.join("\n"), /segmentation/);
  const absent = ok({
    version: 2,
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(absent.file.segmentation, undefined);
});

test("spine.merge is kept, and a bad entry is only a warning", () => {
  const good = ok({
    version: 2,
    spine: { merge: { "ch01_split_009.xhtml": "ch01_split_008.xhtml", "part0006_split_001": "part0006.xhtml" } },
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.file.spine.merge, {
    "ch01_split_009.xhtml": "ch01_split_008.xhtml",
    part0006_split_001: "part0006.xhtml",
  });
  const bad = ok({
    version: 2,
    spine: { merge: { "": 4, "ok.xhtml": "chapter.xhtml" } },
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(bad.ok, true);
  assert.deepEqual(bad.file.spine.merge, { "ok.xhtml": "chapter.xhtml" });
  assert.match(bad.warnings.join("\n"), /spine.merge/);
  const broken = ok({
    version: 2,
    spine: "merge",
    glossary: { lantern: { meaning: "A light." } },
  });
  assert.equal(broken.ok, true);
  assert.equal(broken.file.spine, undefined);
  assert.match(broken.warnings.join("\n"), /"spine"/);
});

test("an extra page is not an anchor target", () => {
  const sense = {
    pos: "noun",
    meaning: "main",
    whyHard: "w",
    senses: [
      { meaning: "river side", anchors: [{ chapter: 1, occurrence: 1, context: "sat on the bank" }] },
    ],
  };
  assert.equal(
    format.matchAnchor("bank", sense.senses, {
      chapter: -1,
      surface: "bank",
      occurrence: 1,
      paragraph: "They sat on the bank of the river.",
      before: "They sat on the ",
    }),
    null,
  );
});

test("version 1 lists stay valid", () => {
  const r = ok({ version: 1, glossary: { twit: { pos: "noun", meaning: "A silly person.", whyHard: "x", example: "a", count: 3 } } });
  assert.equal(r.ok, true);
  assert.equal(r.file.glossary.twit.senses, undefined);
});

test("errors name the word", () => {
  const r = ok({ version: 2, glossary: { bank: { pos: "noun" }, "tree house": { meaning: "x" } } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /"bank" has no "meaning"/);
  assert.match(r.errors.join("\n"), /"tree house" is not a plain English word/);
});

test("senses are not allowed in version 1; broken JSON is explained", () => {
  assert.match(ok({ version: 1, glossary: { a: { meaning: "x", senses: [{ meaning: "y" }] } } }).errors[0], /version/);
  assert.match(ok("{ nope").errors[0], /not valid JSON/);
});

const entry = {
  pos: "noun",
  meaning: "main",
  whyHard: "w",
  senses: [
    { meaning: "river side", anchors: [{ chapter: 1, occurrence: 2, context: "sat on the bank of the river" }] },
    { meaning: "money place", default: true, anchors: [{ context: "went to the bank to pay money" }] },
  ],
};
const tap = (over) => ({ chapter: 0, surface: "bank", occurrence: 1, paragraph: "x", ...over });

test("here is the same sense said for this sentence", () => {
  const file = {
    version: 2,
    glossary: {
      unless: {
        pos: "joining word",
        meaning: "If that does not happen.",
        here: "None of it will matter if you do not do your part.",
        whyHard: "w",
      },
      bank: {
        pos: "noun",
        meaning: "main",
        here: "Used when no sense names this place.",
        whyHard: "w",
        senses: [
          {
            meaning: "river side",
            here: "They are sitting on the land beside the river.",
            anchors: [{ chapter: 1, occurrence: 2, context: "sat on the bank of the river" }],
          },
          { meaning: "money place", default: true, anchors: [{ context: "went to the bank to pay money" }] },
        ],
      },
    },
  };
  const checked = ok(file);
  assert.equal(checked.ok, true);
  assert.equal(checked.file.glossary.unless.here, "None of it will matter if you do not do your part.");
  const plain = format.pickSense("unless", checked.file.glossary.unless, tap({}));
  assert.equal(plain.meaning, "If that does not happen.");
  assert.equal(plain.here, "None of it will matter if you do not do your part.");
  const river = format.pickSense("bank", checked.file.glossary.bank, tap({ chapter: 1, occurrence: 2, paragraph: "They sat on the bank of the river." }));
  assert.equal(river.here, "They are sitting on the land beside the river.");
  const money = format.pickSense("bank", checked.file.glossary.bank, tap({ paragraph: "Nothing about a bank." }));
  assert.equal(money.meaning, "money place");
  assert.equal(money.here, "Used when no sense names this place.");
});

test("matching order: anchor, context, default, entry", () => {
  assert.equal(format.pickSense("bank", entry, tap({ chapter: 1, occurrence: 2, paragraph: "They sat on the bank of the river." })).via, "anchor");
  const byContext = format.pickSense("bank", entry, tap({ chapter: 5, paragraph: "He went to the Bank to pay money today.", before: "He went to the " }));
  assert.equal(byContext.via, "context");
  assert.equal(byContext.meaning, "money place");
  const def = format.pickSense("bank", entry, tap({ paragraph: "Nothing here." }));
  assert.equal(def.via, "default");
  const noDefault = { ...entry, senses: entry.senses.map((s) => ({ ...s, default: undefined })) };
  assert.equal(format.pickSense("bank", noDefault, tap({ paragraph: "Nothing here." })).via, "entry");
  assert.equal(format.pickSense("bank", { pos: "n", meaning: "m", whyHard: "w" }, tap({})).via, "entry");
});

test("a stale anchor (context missing) is skipped", () => {
  const r = format.pickSense("bank", entry, tap({ chapter: 1, occurrence: 2, paragraph: "A different sentence." }));
  assert.notEqual(r.via, "anchor");
});

test("a snippet around another use in the same paragraph does not win", () => {
  const paragraph = "At the bank to pay money he saw a bank by the river.";
  const second = format.pickSense("bank", entry, tap({ paragraph, before: "At the bank to pay money he saw a ", chapter: 9 }));
  assert.notEqual(second.via, "context");
});

test("extras: paragraphs, sentences, phrases and coined are read", () => {
  const r = ok({
    version: 2,
    glossary: { snozzcumber: { meaning: "A made-up vegetable.", coined: true } },
    paragraphs: [{ chapter: 0, paragraph: 1, context: "one two three four five six", mainIdea: "a", simple: "b", hardWords: ["x"] }],
    sentences: [{ chapter: 0, context: "one two three four five six", simple: "a", grammar: "b" }],
    phrases: { "give up": { meaning: "Stop trying.", pos: "phrasal verb", forms: ["gave up"] } },
  });
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.equal(r.file.glossary.snozzcumber.coined, true);
  assert.equal(r.file.paragraphs.length, 1);
  assert.equal(r.file.phrases["give up"].pos, "phrasal verb");
  assert.deepEqual([r.stats.paragraphs, r.stats.sentences, r.stats.phrases, r.stats.coined], [1, 1, 1, 1]);
});

test("extras: a comma may sit between words of a phrase", () => {
  const r = ok({
    version: 2,
    glossary: { brother: { meaning: "A boy." } },
    phrases: {
      "oh, brother": { meaning: "Wow.", pos: "phrase" },
      "oh boy": { meaning: "Wow.", pos: "phrase", forms: ["oh, boy"] },
    },
  });
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.ok(r.file.phrases["oh, brother"]);
  assert.deepEqual(r.file.phrases["oh boy"].forms, ["oh, boy"]);
  const stuck = ok({
    version: 2,
    glossary: { brother: { meaning: "A boy." } },
    phrases: { "oh,brother": { meaning: "Wow.", pos: "phrase" } },
  });
  assert.equal(stuck.ok, false);
  assert.match(stuck.errors.join("\n"), /two or more plain English words/);
});

test("extras: errors are plain English and name the item", () => {
  const r = ok({
    version: 2,
    glossary: { a: { meaning: "x" } },
    paragraphs: [{ chapter: -1, paragraph: 0, context: "a b c d e f", mainIdea: "a" }],
    phrases: { "give": { meaning: "x" }, "look up": { meaning: "y", pos: "verb" } },
  });
  assert.equal(r.ok, false);
  const text = r.errors.join("\n");
  assert.match(text, /Paragraph note 1: "chapter" must be a whole number/);
  assert.match(text, /Paragraph note 1 has no "simple"/);
  assert.match(text, /The phrase "give" must be two or more plain English words/);
  assert.match(text, /The phrase "look up": "pos" must be/);
});

test("a paragraph note may name a recovered extra", () => {
  const r = ok({
    version: 2,
    glossary: { lamp: { meaning: "A light." } },
    paragraphs: [
      {
        chapter: "x1",
        paragraph: 0,
        context: "Lucy looked into the wardrobe and found",
        mainIdea: "Lucy finds a lamp.",
        simple: "Lucy looked in the wardrobe.",
      },
    ],
    sentences: [
      {
        chapter: "x1",
        context: "Lucy looked into the wardrobe and found",
        simple: "Lucy looked in.",
        grammar: "This is the past tense.",
      },
    ],
  });
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.equal(r.file.paragraphs[0].chapter, "x1");
  const chapters = [{ paragraphs: ["Chapter One stays chapter zero in this book."] }];
  const extras = [{ id: "x1", paragraphs: ["Lucy looked into the wardrobe and found a lamp post."] }];
  const found = format.checkExtrasAgainstBook(r.file, chapters, true, extras);
  assert.equal(found.missing, 0, found.errors.join("\n"));
  assert.equal(found.checked, 2);
  const missing = format.checkExtrasAgainstBook(r.file, chapters, true, []);
  assert.match(missing.errors.join("\n"), /no extra x1/);
});

test("extras: check against the real paragraphs of a book", () => {
  const file = {
    version: 2,
    glossary: {},
    paragraphs: [
      { chapter: 0, paragraph: 1, context: "It was a dark night", mainIdea: "a", simple: "b" },
      { chapter: 0, paragraph: 0, context: "It was a dark night", mainIdea: "a", simple: "b" },
      { chapter: 0, paragraph: 5, context: "It was a dark night", mainIdea: "a", simple: "b" },
    ],
    sentences: [{ chapter: 1, context: "It was a dark night", simple: "a", grammar: "b" }],
  };
  const chapters = [{ paragraphs: ["Title", "\u2018It was a dark night,\u2019 said Tom."] }];
  const r = format.checkExtrasAgainstBook(file, chapters, true);
  assert.equal(r.checked, 4);
  assert.equal(r.missing, 3);
  assert.match(r.errors.join("\n"), /is in paragraph 1 of that chapter, not in paragraph 0/);
  assert.match(r.errors.join("\n"), /only 2 paragraphs/);
  assert.match(r.errors.join("\n"), /chapter 1 does not exist/);
});

const tapWords = (value) => format.splitTapWords(value).filter((_, index) => index % 2 === 1);

// The counting rule on main. Kept here on purpose, not imported, so a future edit cannot
// move both sides together.
const MAIN_WORD = /(?:\p{L}\p{M}*)+(?:'(?:\p{L}\p{M}*)+)?/gu;
const mainOccurrences = (value) => {
  const seen = new Map();
  const rows = [];
  for (const match of value.matchAll(MAIN_WORD)) {
    const word = match[0].toLowerCase();
    const n = (seen.get(word) ?? 0) + 1;
    seen.set(word, n);
    rows.push([word, n]);
  }
  return rows;
};

test("a curly apostrophe is one tap button and looks up as the straight spelling", () => {
  const curly = "couldn\u2019t we\u2019re Charlie\u2019s";
  const straight = "couldn't we're Charlie's";
  assert.deepEqual(tapWords(curly), ["couldn\u2019t", "we\u2019re", "Charlie\u2019s"]);
  assert.deepEqual(tapWords(straight), ["couldn't", "we're", "Charlie's"]);
  assert.deepEqual(tapWords(curly).map((word) => text.lookupKey(word)), ["couldn't", "we're", "charlie"]);
  assert.deepEqual(tapWords(straight).map((word) => text.lookupKey(word)), ["couldn't", "we're", "charlie"]);
  assert.deepEqual(tapWords("\u2018Hello\u2019"), ["Hello"]);
  assert.deepEqual(tapWords("couldn\u2018t"), ["couldn\u2018t"]);
  assert.deepEqual(tapWords("couldn\u02bct"), ["couldn\u02bct"]);
  assert.equal(text.lookupKey("couldn\u2018t"), "couldn't");
  assert.equal(text.lookupKey("couldn\u02bct"), "couldn't");
  assert.equal(text.lookupKey("goin\u2019"), text.lookupKey("goin'"));
  assert.equal(text.contextPos("Charlie\u2019s", "noun"), text.contextPos("Charlie's", "noun"));
  // Counting still splits the curly word into the pieces main counted.
  assert.equal(format.countSurface("Coral\u2019s"), "coral");
  assert.equal(format.countSurface("couldn\u2019t"), "couldn");
  assert.equal(format.countSurface("couldn't"), "couldn't");
  assert.equal(format.countSurface("Charlie's"), "charlie's");
});

test("curly possessives keep main's occurrence map", () => {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const paragraph =
    "Coral\u2019s reef hid coral. She couldn\u2019t wait, and she couldn't see the carvings or the s.";
  const html = `<p>${paragraph}</p>`;
  const indexed = format.indexChapterHtml(html, parse);
  const fromIndex = [];
  const seen = new Map();
  for (const token of indexed.tokens) {
    const n = (seen.get(token.w) ?? 0) + 1;
    seen.set(token.w, n);
    fromIndex.push([token.w, n]);
  }
  assert.deepEqual(fromIndex, mainOccurrences(paragraph));
  assert.deepEqual(indexed.blocks, [paragraph]);
  // The possessive is an occurrence of coral, so the later coral is 2. The curly
  // contraction counts as couldn + t, and the straight one stays couldn't.
  assert.deepEqual(
    fromIndex.filter(([word]) => word === "coral" || word === "s" || word === "couldn" || word === "t" || word === "couldn't" || word === "carvings"),
    [
      ["coral", 1],
      ["s", 1],
      ["coral", 2],
      ["couldn", 1],
      ["t", 1],
      ["couldn't", 1],
      ["carvings", 1],
      ["s", 2],
    ],
  );

  // coral is in the list, so Coral’s stays the two buttons main drew. couldn’t is one
  // button: couldn and t are not entries, and the tap looks up couldn't.
  const shown = format.readingHtml(html, new Set(["coral", "couldn't", "carving"]), (surface) => text.lookupKey(surface), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const buttons = [...doc.querySelectorAll("button")];
  const byText = (value) => buttons.find((button) => button.textContent === value);
  const head = byText("Coral");
  const bare = byText("coral");
  const curlyVerb = byText("couldn\u2019t");
  const plainVerb = byText("couldn't");
  const plural = byText("carvings");
  assert.ok(head && bare && curlyVerb && plainVerb && plural);
  assert.equal(head.getAttribute("data-n"), "1");
  assert.equal(bare.getAttribute("data-n"), "2");
  assert.equal(curlyVerb.getAttribute("data-n"), "1");
  assert.equal(plainVerb.getAttribute("data-n"), "1");
  assert.equal(plural.getAttribute("data-n"), "1");
  assert.equal(head.className, "book-hard");
  assert.equal(bare.className, "book-hard");
  assert.equal(curlyVerb.className, "book-hard");
  assert.equal(plainVerb.className, "book-hard");
  assert.equal(plural.className, "book-hard");
  assert.equal(byText("Coral\u2019s"), undefined);
  assert.equal(byText("couldn"), undefined);
  assert.equal(byText("t"), undefined);
  const esses = buttons.filter((button) => button.textContent === "s").map((button) => button.getAttribute("data-n"));
  assert.deepEqual(esses, ["1", "2"]);
});

test("a curly possessive still opens the anchor written for that counted word", () => {
  const paragraph = "Coral\u2019s reef hid coral and the carvings today.";
  const gloss = {
    pos: "noun",
    meaning: "A sea creature.",
    whyHard: "A name and a thing.",
    senses: [
      {
        meaning: "The dragon queen.",
        anchors: [{ chapter: 0, occurrence: 1, context: "Coral's reef hid coral and the" }],
      },
      {
        meaning: "The rock.",
        anchors: [{ chapter: 0, occurrence: 2, context: "reef hid coral and the carvings" }],
      },
    ],
  };
  const first = format.pickSense("coral", gloss, {
    chapter: 0,
    surface: "Coral\u2019s",
    occurrence: 1,
    paragraph,
    before: "",
  });
  assert.equal(first.via, "anchor");
  assert.equal(first.meaning, "The dragon queen.");
  const second = format.pickSense("coral", gloss, {
    chapter: 0,
    surface: "coral",
    occurrence: 2,
    paragraph,
    before: "Coral\u2019s reef hid ",
  });
  assert.equal(second.via, "anchor");
  assert.equal(second.meaning, "The rock.");
  // A straight possessive is still its own spelling, not another coral.
  const straight = format.pickSense("coral", gloss, {
    chapter: 0,
    surface: "Coral's",
    occurrence: 1,
    paragraph: "Coral's reef hid coral.",
    before: "",
  });
  assert.notEqual(straight.via, "anchor");
});

test("a word main could tap inside a curly apostrophe stays its own button", () => {
  const html =
    "<p>No one escapes Cap\u2019n Bones at ten o\u2019clock. That ticket\u2019ll go. " +
    "\u201cThat she \u2019as, guv\u2019nor.\u201d Oughtn\u2019t we? I daren\u2019t. Don\u2019t worry, Don. " +
    "That hen\u2019ll be roasted. The vet\u2019ll make her better. She couldn\u2019t wait.</p>";
  const lemmas = ["cap", "clock", "ticket", "guv", "oughtn", "daren", "don", "hen", "vet", "couldn't"];
  const ready = new Set(lemmas);
  const resolve = (surface) => text.resolveGlossKey(surface, new Map(lemmas.map((key) => [key, key])), new Map());
  const shown = format.readingHtml(html, ready, resolve, 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const buttons = [...doc.querySelectorAll("button")];
  const hard = buttons.filter((button) => button.className === "book-hard").map((button) => button.textContent);
  assert.deepEqual(hard, ["Cap", "clock", "ticket", "guv", "Oughtn", "daren", "Don", "Don", "hen", "vet", "couldn\u2019t"]);
  const nOf = (label) => buttons.filter((button) => button.textContent === label).map((button) => button.getAttribute("data-n"));
  assert.deepEqual(nOf("Cap"), ["1"]);
  assert.deepEqual(nOf("clock"), ["1"]);
  assert.deepEqual(nOf("ticket"), ["1"]);
  assert.deepEqual(nOf("guv"), ["1"]);
  assert.deepEqual(nOf("Don"), ["1", "2"]);
  assert.equal(buttons.some((button) => button.textContent === "Cap\u2019n"), false);
  assert.equal(buttons.some((button) => button.textContent === "o\u2019clock"), false);
  assert.equal(buttons.some((button) => button.textContent === "ticket\u2019ll"), false);
  assert.equal(buttons.some((button) => button.textContent === "couldn\u2019t"), true);
  // The pieces still move the same counters main used, including a later bare word.
  const indexed = format.indexChapterHtml(html, (value) => new DOMParser().parseFromString(value, "text/html"));
  const seen = new Map();
  const rows = [];
  for (const token of indexed.tokens) {
    const n = (seen.get(token.w) ?? 0) + 1;
    seen.set(token.w, n);
    rows.push([token.w, n]);
  }
  assert.deepEqual(rows, mainOccurrences(indexed.blocks.join("")));
});

test("a plural stem does not match another entry's form", () => {
  const html = "<p>The carvings, hatchings and gatherings stayed.</p>";
  const keys = new Map([
    ["carve", "carve"],
    ["hatch", "hatch"],
  ]);
  const forms = new Map([
    ["carving", "carve"],
    ["hatching", "hatch"],
  ]);
  const ready = new Set(["carve", "hatch"]);
  const shown = format.readingHtml(html, ready, (surface) => text.resolveGlossKey(surface, keys, forms), 0, new Map());
  const doc = new DOMParser().parseFromString(`<div>${shown}</div>`, "text/html");
  const hard = [...doc.querySelectorAll("button.book-hard")].map((button) => button.textContent);
  assert.deepEqual(hard, []);
  const withLemma = format.readingHtml(
    html,
    new Set(["carving", "hatching", "gathering"]),
    (surface) => text.lookupKey(surface),
    0,
    new Map(),
  );
  const again = new DOMParser().parseFromString(`<div>${withLemma}</div>`, "text/html");
  const underlined = [...again.querySelectorAll("button.book-hard")].map((button) => button.textContent).sort();
  assert.deepEqual(underlined, ["carvings", "gatherings", "hatchings"]);

  // roses -> rose, and rose is only a form of rise. numbers -> number, a form of numb.
  // Main does not underline either. Stemming must not invent the match.
  const otherKeys = new Map([
    ["rise", "rise"],
    ["numb", "numb"],
    ["hatch", "hatch"],
  ]);
  const otherForms = new Map([
    ["rose", "rise"],
    ["number", "numb"],
    ["hatching", "hatch"],
  ]);
  const otherReady = new Set(["rise", "numb", "hatch"]);
  const resolve = (surface) => text.resolveGlossKey(surface, otherKeys, otherForms);
  assert.notEqual(resolve("roses"), "rise");
  assert.notEqual(resolve("numbers"), "numb");
  assert.notEqual(resolve("hatchings"), "hatch");
  const page = format.readingHtml(
    "<p>Pale-pink roses and phone numbers and many hatchings.</p>",
    otherReady,
    resolve,
    0,
    new Map(),
  );
  const view = new DOMParser().parseFromString(`<div>${page}</div>`, "text/html");
  assert.deepEqual([...view.querySelectorAll("button.book-hard")].map((button) => button.textContent), []);
});
