# Margin Words book pack spec (for AI agents)

Audience: an AI agent that is given an EPUB and must produce a word list (`glossary.json`) and, if asked, a book pack
(`.zip`) for the reader app **Margin Words**. This file is the whole specification. It is not a tutorial for humans.

## 1. Goal

Margin Words is a static web reader for English books. It has no server and no AI. When a learner taps a word, the
card shows text that was written in advance. All of that text comes from one JSON file per book: `glossary.json`.

- Learners: Chinese junior-high students, about CEFR A2 to B1.
- Your job: read the book, pick the hard words, write short simple English help, and output valid JSON.
- A word that is not in the file shows "No meaning for this word in this book yet." So you decide which words get help.
- The file can hold: word meanings (one or many per word, tied to places in the book), paragraph help, sentence help,
  phrasal verbs and idioms, and a flag for words the author invented.

Deliverables, in this order of importance:

1. `glossary.json` that passes the checks in section 9.
2. If asked for a pack: ONE `.zip` that holds exactly `book.epub` and `glossary.json` (section 3). The app does NOT accept a
   bare EPUB. Only a processed book (a pack) can be added.

## 2. Contents of this kit

| File | Use |
| --- | --- |
| `book-pack-spec.md` | This file. |
| `the-lantern-seller.epub` | Sample book: 3 chapters, about 600 words, original text, CC0. |
| `the-lantern-seller.glossary.json` | Finished word list for that book. It uses every feature. Copy its style. |
| `the-lantern-seller.pack.zip` | The same two files as a ready-to-import book pack (`book.epub` + `glossary.json`). Add it in the app: Add book -> Choose .zip file. |

The kit zip itself is NOT a pack (it holds a spec and loose files). Import `the-lantern-seller.pack.zip` from the kit.

## 3. Book pack: required files

**The app does not accept a standalone EPUB.** The only way to add your own book is a book pack. A book pack is a
*processed book*: the book plus the word list that was written for it.

### 3.1 Required files

A book pack is **one `.zip` file** with **exactly** these two files at the top level (one wrapping folder is tolerated):

| File | Required | What it is |
| --- | --- | --- |
| `book.epub` | **yes, exactly one** | The book, unchanged, DRM-free, English text. Maximum 40 MB. Any other single `*.epub` name also works (`my-book.epub`), but `book.epub` is the standard name. |
| `glossary.json` | **yes, exactly one** | The word list for that book, format in section 4 (`version` 1 or 2, `glossary` with at least 1 word, maximum 8 MB). The kit naming `<name>.glossary.json` (for example `the-lantern-seller.glossary.json`) also works inside a zip. |
| `cover.jpg` | no | Cover picture (`cover.png` or `cover.webp` also work). Used only when the EPUB has no cover of its own. |
| `pack.json` | no | `{ "id": "my-book", "title": "...", "author": "...", "rev": "1", "lexile": "880L", "isbn": "9780141960616", "series": "Wings of Fire", "seriesNumber": 1 }`. `id` matches `^[a-z0-9][a-z0-9_-]{0,63}$`. `lexile`, `isbn`, `series` and `seriesNumber` are optional. `isbn` is the ISBN-13 of the edition this list was written for. `series` may stand alone. `seriesNumber` is kept only with a series name. |

Rules that the app checks at import (in this order). If one fails, **nothing is added** and the person sees a plain message:

1. The file is a `.zip`. A bare `.epub` is refused with a message and a link to the guide page (`./guide/`).
2. The zip has one `.epub` and one word list. Zero or more than one of either is an error.
3. `glossary.json` is valid (every rule of section 4 and 9). The first problems are shown by word name.
4. The EPUB opens (valid EPUB, no DRM, has a table of contents, has English text).
5. **The word list belongs to the book.** It passes if **either** `sha256` in `glossary.json` equals the sha256 of
   `book.epub`, **or** `title` in `glossary.json` equals the title of the EPUB (case, quotes and punctuation are
   ignored) and, when both have an author, the authors are equal too. A list with neither a matching `sha256` nor a
   `title` is refused. Always write `title`, `author` and `sha256` in `glossary.json`.

**Title, author and cover come from the EPUB** (`pack.json` may override title and author). Do not repeat them anywhere else.

Also accepted: a zip with several sub-folders, each holding one `book.epub` and one `glossary.json` (several books in one
file). Files such as `__MACOSX/`, dotfiles, `info.json`, `catalog.json` and `manifest.json` are ignored.

Example of a correct pack:

```
my-book.pack.zip
  book.epub
  glossary.json
```

Make it: `zip my-book.pack.zip book.epub glossary.json` (put the two files at the top level, do not zip the folder).

### 3.2 Not supported

- A bare `.epub` (or an `.epub` and a `.json` chosen together). Make a pack first.
- A `.json` alone: it can only be added to a book that is already on the shelf (book menu -> "Add word list").
- A pack without a word list, or with a word list made for another book.

### 3.3 Hosting and copyright

- Hosting a catalog (optional, for people who run a website): `catalog.json` = `{ "format": 1, "name": "...", "packs": [ { "id", "title", "author", "rev", "lexile": "880L", "isbn": "9780141960616", "series": "Alice", "seriesNumber": 1, "epub": { "url", "bytes", "sha256" }, "glossary": { "url", "bytes", "sha256", "rev" } } ] }`. `lexile`, `isbn`, `series` and `seriesNumber` are optional. `series` may stand alone. `url` is relative to the catalog or a full https address. The reader app downloads these packs for the learner (Add book -> Free books) and shows the measure and ISBN on the card.
- A word-list catalog (no book file) is `{ "format": 1, "name": "...", "lists": [ { "id", "title", "author", "lexile", "isbn", "series", "seriesNumber", "glossary": { "url", "bytes", "sha256" } } ] }`. It must not include an EPUB. The reader downloads `glossary.json` only. The person prepares their own e-book of that ISBN and pairs it in the app. The app then shows what share of the list's `context` snippets were found in that e-book.
- Copyright: put the EPUB in a pack only if the book is public domain or the user owns the right to share it.
  For a copyrighted book, deliver `glossary.json` alone and tell the user to build the pack on their own computer.

## 4. `glossary.json` schema

UTF-8 JSON, one object. Maximum file size 8 MB. Straight double quotes, no comments, no trailing commas.
Unknown extra fields are ignored. Types below use TypeScript notation; `?` = optional.

```ts
type GlossaryFile = {
  version: 2;                  // 1 or 2. Use 2. "senses" is not allowed in 1.
  title?: string;              // book title as in the EPUB; the app warns if it differs
  author?: string;
  sha256?: string;             // sha256 (hex) of the EPUB file
  chapters?: number;           // chapter count as the reader counts them (section 5.3)
  level?: string;              // free text, e.g. "Chinese junior-high (CEFR A2-B1). Simple English meanings."
  lexile?: string;             // optional Lexile measure for this edition, e.g. "880L". Omit when you have no published measure.
  isbn?: string;               // optional ISBN-10 or ISBN-13 of this edition. Omit when you cannot confirm it.
  series?: string;             // optional series title. A name alone is enough.
  seriesNumber?: number;       // optional 1-based place in the series. Kept only with series.
  language?: string;           // free text
  glossary: { [lemma: string]: Entry };   // at least 1, at most 30000
  paragraphs?: ParagraphNote[];           // at most 20000
  sentences?: SentenceNote[];             // at most 20000
  phrases?: { [phrase: string]: Phrase }; // at most 5000
};
```

### 4.1 Entry (one word), key = lemma

Key rules: lower case, letters only, one apostrophe or hyphen allowed inside (`^[a-z]+(['-][a-z]+)*$`), at most 48 characters.
Duplicate keys (also after lower-casing) are an error. A hyphenated key gives a warning, because the reader splits words
at hyphens (`muggle-wump` is the two words `muggle` and `wump`), so list the parts instead.

```ts
type Entry = {
  meaning?: string;     // REQUIRED unless "senses" is given. Max 600 chars.
  pos?: string;         // part of speech, free text, max 48 chars. Use the app's labels (below).
  whyHard?: string;     // one short reason, max 400. Default when missing: "This word is harder than everyday English."
  forms?: string[];     // other spellings in the book that belong to this entry (lower case, one plain word each)
  senses?: Sense[];     // 1 to 12 meanings (version 2 only)
  coined?: boolean;     // true only if the AUTHOR INVENTED the word
  senseOnly?: boolean;  // true: underline/open the word ONLY at the places named by the anchors of its senses (4.7)
};
type Sense = {
  meaning: string;      // REQUIRED. Max 600.
  pos?: string;         // falls back to the entry's pos
  whyHard?: string;     // falls back to the entry's whyHard
  default?: boolean;    // true on at most ONE sense of the entry
  forms?: string[];     // spellings this sense is for (used only to pick a sense when nothing else matches)
  anchors?: Anchor[];   // 0 to 60 places where this meaning is used
};
type Anchor = {
  chapter?: number;     // integer >= 0 (first chapter = 0)
  occurrence?: number;  // integer >= 1; needs "chapter"
  form?: string;        // the exact lower-case spelling that "occurrence" counts; default = the entry key
  context?: string;     // 6-12 words copied exactly from ONE paragraph, containing the word. Max 300 chars.
};
// An anchor needs "context", or both "chapter" and "occurrence". Always write all three.
```

`pos` labels the app knows (others are shown as written): `noun`, `singular noun`, `plural noun`, `uncountable noun`,
`adjective`, `comparative adjective`, `superlative adjective`, `adverb`, `verb`, `base verb`, `third-person verb`,
`past-tense verb`, `present participle`, `past participle`, `modal verb`, `pronoun`, `preposition`, `conjunction`,
`determiner`, `gerund`, `interjection`. Describe the form as it appears in the book (`drifted` -> `past-tense verb`).

Lookup keys: when a learner taps a word, the app finds the entry by (1) the word with regular plural/possessive
endings removed (`lanterns`, `lantern's` -> `lantern`; `ies` -> `y`; `ches/shes/sses/xes/zes/oes` -> drop `es`; a final `s` is
dropped except after `ss`, `us`, `is`; a few irregular plurals such as `children` -> `child`), (2) the word as spelled,
(3) any entry that lists the spelling in `forms`. Therefore: use the base form as the key for nouns; for verbs and other
shapes the app does NOT reduce (`faded`, `drifted`, `glowed`, `cried`) either use the shape as the key, or put it in
`forms` of the base entry. The sample list uses keys like `faded` with `"forms": ["faded", "fade"]`.

### 4.2 Several meanings (senses)

Use `senses` only when the word means different things in this book. Do not invent meanings the book does not use.

- Give exactly one sense `"default": true` (the most common one in this book).
- Put `anchors` on the other senses (and on the default sense where useful) for the places where each meaning is used.
- One place (`chapter` + `form` + `occurrence`) may belong to only one sense. Two senses claiming it is an error.
- If the entry has `senses` and no `meaning`, the first sense is also used as the entry meaning. Safer: write the default meaning in both places.

### 4.3 Paragraph note

```ts
type ParagraphNote = {
  chapter: number;      // >= 0
  paragraph: number;    // >= 0, paragraph index inside the chapter (section 5.4)
  context: string;      // 6-14 words copied exactly from that paragraph (max 300 chars)
  mainIdea: string;     // 1-2 short sentences, max 400
  simple: string;       // the WHOLE paragraph again in very common words, max 3000
  hardWords?: string[]; // up to 20 hard words/phrases taken from the ORIGINAL paragraph
};
```

Write notes for 1 or 2 hard or important paragraphs per chapter. Two notes for the same chapter+paragraph: only the first is used (warning).

### 4.4 Sentence note

```ts
type SentenceNote = {
  chapter: number;      // >= 0
  context: string;      // 6-14 words copied exactly from the sentence (max 300 chars); it locates the note
  simple: string;       // the sentence in easier English, max 800
  grammar: string;      // ONE line: what is special in how the sentence is built, max 400
};
```

Write notes for 1 or 2 sentences with tricky grammar per chapter (inversion such as "Had she not been...", "The more..., the less...", long clauses).

### 4.5 Phrase (phrasal verbs, idioms)

```ts
type Phrase = {
  meaning: string;                              // max 600
  pos?: "phrasal verb" | "idiom" | "phrase";    // any other value is an error
  forms?: string[];                             // extra full forms, e.g. ["packed up"]
  example?: string;                             // a short sentence from the book, max 400
};
```

The key is the base form: lower case, two or more words, plain letters (`pack up`, `break the ice`); `one's` stands for
my/your/his/her/its/our/their. Max 60 chars. The app already knows regular verb forms (`packs up`, `packing up`, and about
100 common irregular verbs), and it accepts a phrasal verb split by up to 3 words (`pack the apples up`). List only forms it
cannot derive. A phrase card shows only when the whole phrase is in the tapped sentence.

### 4.6 `coined`

`"coined": true` marks a word the author made up (`moonwick`, `snozzcumber`). Not for rare real words, dialect or funny
spellings. Start the meaning with "In this story, ...".

### 4.7 `senseOnly`

Use `"senseOnly": true` for an everyday word (`up`, `run`, `light`) that is only hard in one or two places. Without it the reader
underlines every use of the word in the book. With it, the reader underlines and opens the word ONLY where an anchor of one of its
`senses` names the place (`chapter` + `occurrence`, or a `context` snippet). Every other use is plain text with the normal "not in the
list" card. Write at least one anchor (the validator warns if no sense has one), and also write the entry's own `meaning`.
An entry without the field (or with `false`) behaves as before. Needs `"version": 2`.

## 5. How the reader numbers the book (needed for anchors and notes)

If you have the project tools, use them (section 8). If not, follow these rules exactly.

### 5.1 Words

A word is a match of `/[A-Za-z]+(?:'[A-Za-z]+)?/`: ASCII letters, with at most one straight apostrophe followed by letters.
A curly apostrophe (`’`), a hyphen, a digit or any other character ends a word: `don’t` = `don` + `t`; `Twit's` is one word;
`Muggle-Wump` = `Muggle` + `Wump`. Words never run across an HTML tag boundary (`<em>no</em>w` = `no`, `w`).
Words are compared in lower case.

### 5.2 Occurrence

`occurrence` = how many times that exact lower-case spelling has appeared so far in the chapter, counting from 1, in reading
order, headings included. The count restarts at 1 in each chapter. `stuck` and `sticks` are counted separately. Use `form`
when the spelling in the book differs from the entry key (`shrinks` vs `shrink`).

### 5.3 Chapters

`chapter` is the 0-based position in the reader's chapter list, not in the EPUB spine:

1. Use the table of contents (EPUB 3 `nav`, else NCX); cut each entry's HTML from its fragment to the next entry's fragment; skip contents pages.
2. If that gives fewer than 2 chapters, use the spine files, split at `<h1>` (else `<h2>`) headings.
3. Drop chapters with fewer than 20 letters; merge chapters with fewer than 40 letters into the previous one.
4. Scripts and navigation are removed, links are unwrapped.

Write `"chapters": N` in the file. If the user's EPUB gives another count, the reader ignores `chapter` and `occurrence`
and uses `context` only. So `context` is the part that must always be right.

### 5.4 Paragraphs

`paragraph` = 0-based index in the chapter's paragraph list: every `p`, `h1`-`h4`, `li`, `blockquote` in document order,
except a block whose direct parent is a `p`, `li` or `blockquote`, and except a block with fewer than 2 English letters (empty
lines, `* * *`, page numbers). If nothing is left, the whole chapter text is paragraph 0. A chapter heading inside the chapter
HTML is a paragraph (index 0 when it comes first). Example: in `the-lantern-seller.epub` chapter 1 the heading is `[0]`, "As the sun sank..." is `[1]`, the lantern-lighting paragraph is `[3]`.

### 5.5 Context matching

`context` is compared with the text of one paragraph block after both sides are normalised: curly quotes -> straight, dashes -> `-`,
`…` -> `...`, runs of white space -> one space, lower case. For paragraph and sentence notes punctuation is ignored as well
(only letters, digits and inner apostrophes count). A snippet must lie inside one paragraph, never across two, and must contain the word it is for.
Never fix spelling, never shorten with "...", never paraphrase.

## 6. How the reader picks a meaning (so you know what to write)

1. A sense whose anchor has `chapter` = chapter on screen and `occurrence` = the number of the tapped word. If the anchor also has a `context` that is not in the tapped paragraph, the anchor is stale and skipped.
2. A sense whose anchor `context` is found in the tapped paragraph around the tapped word (if the anchor has a `chapter`, it must match). First sense in list order wins.
3. The sense with `default: true`; else the one sense that lists the tapped spelling in its `forms`.
4. The entry's own `meaning`.
5. No entry: "No meaning for this word in this book yet."

The card also lists the other senses under "Other meanings in this book".

For a `senseOnly` entry, only steps 1 and 2 count: if no anchor names the tapped place, the word is not underlined and has no entry there.

## 7. Content rules

Language and level
1. English only, in every field. No Chinese or other languages inside the file.
2. Write help with the 2000 most common English words and short sentences. A meaning has one idea, at most about 25 words.
   Allowed besides: simple forms of those words (`-s`, `-ed`, `-ing`, `-er`, `-ly`), names, numbers, the headword, key story words.
3. Do not explain a word with the word itself or its forms.
4. Basic-word definitions: when a word is basic in meaning but used in a special way here, define that use in basic words.

Truthfulness
5. Only restate the original. No new facts, opinions, guesses, background, or what happens later. A paragraph or sentence note must not explain more than the text says.
6. Explain the word as used IN THIS BOOK. Add no meanings the book does not use.
7. Keep names and key story words unchanged (`Mira`, `Willy Wonka`, `moonwick`) even if they are not common words.
8. If you are not sure, leave it out. A short correct list beats a long list with errors.

Copyright
9. Do not quote the book beyond short snippets. `context` is 6-14 words from one paragraph; `example` is one short sentence. `simple` restates a
   paragraph in new words and must not copy it. No other field may contain book text longer than a few words.

Choosing words
10. Hard word = a word a junior-high learner (A2-B1) probably does not know and that matters for understanding. Skip the 2000 most common words, names of people and places, and words the book explains itself.
11. Key = lower-case base form (`lantern`, not `lanterns`); see section 4.1 for shapes the app cannot reduce.
12. Size: short story 10-40 words; novel about 15-30 new words per chapter (do not repeat a word unless it has a new meaning).

## 8. Workflow

Without the project tools (only the EPUB and this file):

1. Unzip the EPUB (it is a zip). Read `META-INF/container.xml` -> OPF -> spine; read the TOC (`nav.xhtml` or `toc.ncx`) to get the chapter list as in section 5.3. Note `title`, `author`, chapter count, and the sha256 of the EPUB file.
2. Read each chapter's text. Number paragraphs as in section 5.4 and count words as in section 5.1-5.2.
3. Per chapter pick hard words (section 7.10-7.12). For each, write the entry. If the word has a second meaning in this book, write `senses`.
4. Write 1-2 paragraph notes, 1-2 sentence notes, the phrases and the `coined` words that really occur.
5. For every anchor/note: copy `context` verbatim from the book text; compute `chapter`, `occurrence`, `paragraph` by the rules. Do not guess numbers. If unsure of a number, omit `occurrence`/`paragraph` where allowed (anchors work with `context` alone; paragraph notes need `paragraph`, so make it right).
6. Assemble one `glossary.json`. Validate (section 9). Fix every error. Read the warnings.
7. If a pack is wanted, zip `book.epub` + `glossary.json` (section 3). Zip entries at the top level or in one folder, no `__MACOSX`.

With the Margin Words project folder (Node 20+, run `npm install` once). These tools run the reader's own code, so the numbers are exact:

```
node scripts/extract-epub-text.mjs book.epub                      # title, author, sha256, chapters (0-based) with word counts
node scripts/extract-epub-text.mjs book.epub --out work --numbered # work/ch000.txt ... with [0] [1] [2] paragraph numbers
node scripts/extract-epub-text.mjs book.epub --candidates 300      # likely hard words with counts and forms
node scripts/extract-epub-text.mjs book.epub --find WORD           # every use: chapter, paragraph, occurrence, surrounding text
node scripts/extract-epub-text.mjs book.epub --paragraph-search "some words"   # chapter and paragraph holding the text
node scripts/validate-glossary.mjs book.epub glossary.json         # full check; exit 0 = OK
node scripts/check-definition-words.mjs --fail glossary.json       # meanings use only common words
```

Work chapter by chapter: take the chapter text, answer with the JSON pieces for that chapter, merge all pieces into one file
(merge `glossary` objects, concatenate `paragraphs` and `sentences`, merge `phrases`), then validate the merged file.

## 9. Validation

A file is accepted by the app when all of these hold (these are the exact error conditions of the app's validator):

1. Valid JSON; top level is an object with `version` (1 or 2) and `glossary` (an object, not a list, not empty).
2. Every key matches `^[a-z]+(['-][a-z]+)*$`, length <= 48, no duplicates after lower-casing.
3. Every entry is an object; `meaning` is a non-empty string unless `senses` is present; strings are within their length limits; `forms` is a list of strings; `coined` is a boolean.
4. `senses` only with `version: 2`; 1 to 12 items; each has a non-empty `meaning`; at most one `default: true` per entry; no two senses share one (`chapter`, `form`, `occurrence`).
5. Every anchor: `chapter` integer >= 0, `occurrence` integer >= 1, `occurrence` only together with `chapter`, and (`context` or `chapter`+`occurrence`) present; at most 60 anchors per sense.
6. Paragraph notes have integer `chapter`/`paragraph` >= 0 and non-empty `context`, `mainIdea`, `simple`; `hardWords` is a list of at most 20 non-empty strings. Sentence notes have integer `chapter` >= 0 and non-empty `context`, `simple`, `grammar`. Phrases: key of two or more plain lower-case words, `meaning` present, `pos` one of the three values.

Extra checks when the EPUB is available (`validate-glossary.mjs book.epub glossary.json`; the app only warns for these, the script makes them errors):
7. The chapter exists; the form occurs at least `occurrence` times in that chapter; `context` is inside the paragraph that holds that occurrence.
8. Anchor `context` without `chapter`/`occurrence` is found in the book; paragraph note `context` is in paragraph `paragraph` of chapter `chapter`; sentence note `context` is in some paragraph of chapter `chapter`.

Warnings (read them): title differs, chapter count differs, hyphenated key, context shorter than 4 words or longer than 30, context without the word, `simple`/`mainIdea`/`grammar`/phrase meaning using words outside the 2000 basic words (names and numbers are fine).

If you cannot run the script: re-check items 1-6 by reading the JSON, then re-check 7-8 by searching each `context` in the book text and re-counting each `occurrence`/`paragraph`. The app shows plain-English messages that name the exact word when it rejects a file, so a final import test is also a check.

Typical failures: trailing comma or missing quote; `chapter` counted from 1 instead of 0; `occurrence` counted for the wrong spelling; `context` crossing a paragraph break or with fixed spelling; two `default` senses; sense `meaning` missing; Chinese text in a field.

## 10. Complete example

Book: `the-lantern-seller.epub` (3 chapters). This block is checked against the EPUB by the project's `npm run check:example`.

<!-- example:start -->
```json
{
  "version": 2,
  "title": "The Lantern Seller",
  "author": "A. Sample Writer",
  "sha256": "dc473516c50e135aa1411efc96263ee073e8bb08010a55f1e02edd1a096665e4",
  "chapters": 3,
  "level": "Chinese junior-high (CEFR A2-B1). Simple English meanings.",
  "language": "English",
  "glossary": {
    "drizzle": {
      "pos": "noun",
      "meaning": "Rain that is very light and fine.",
      "whyHard": "This is a word from a higher level."
    },
    "faded": {
      "pos": "past-tense verb",
      "meaning": "Lost its strong colour and became less bright.",
      "forms": ["faded", "fade"]
    },
    "moonwick": {
      "pos": "noun",
      "meaning": "In this story, a magic string that makes light. Its fire is blue and the wind cannot stop it.",
      "whyHard": "This word is made up by the author.",
      "coined": true
    },
    "fair": {
      "pos": "noun",
      "meaning": "A happy event in a town, with many games, music and things to buy.",
      "whyHard": "This word has more than one meaning.",
      "senses": [
        {
          "pos": "noun",
          "meaning": "A happy event in a town, with many games, music and things to buy.",
          "default": true,
          "anchors": [
            { "chapter": 0, "occurrence": 2, "context": "held a fair in the old market square" }
          ]
        },
        {
          "pos": "adjective",
          "meaning": "Right and honest. Not too high and not too low.",
          "anchors": [
            { "chapter": 1, "occurrence": 1, "context": "A fair price for this lantern is one honest answer" }
          ]
        }
      ]
    }
  },
  "paragraphs": [
    {
      "chapter": 1,
      "paragraph": 3,
      "context": "He struck a match and touched it to the wick",
      "mainIdea": "Tobias lights a lantern. The fire turns blue and the wind cannot move it.",
      "simple": "Tobias took down a lantern with a simple handle. He made a fire with a match and put it to the wick. At first the fire was yellow and it moved in the wind. Then it turned deep blue and did not move at all. He said that no wind can stop a moonwick.",
      "hardWords": ["wick", "flicker", "moonwick"]
    }
  ],
  "sentences": [
    {
      "chapter": 2,
      "context": "Had she not been carrying the lantern, she would have stepped on it",
      "simple": "If she had not been carrying the lantern, she would have stepped on it.",
      "grammar": "'Had she not been...' means 'If she had not been...'. It talks about something that did not happen."
    }
  ],
  "phrases": {
    "pack up": {
      "meaning": "To put your things away when you finish.",
      "pos": "phrasal verb",
      "forms": ["packed up"],
      "example": "The jugglers packed up their apples."
    }
  }
}
```
<!-- example:end -->

The full list for this book is `the-lantern-seller.glossary.json` in this kit (13 words, 3 sentence notes, 4 phrases).

## 11. Final checklist

- [ ] Output is one valid JSON file, `version: 2`, with `title`, `author`, `chapters`, and `sha256` when known.
- [ ] Keys are lower-case base forms; shapes the app cannot reduce are keys or in `forms`.
- [ ] Every text is English, very common words, one idea, no new facts, no word explained by itself.
- [ ] Every `context` is copied verbatim from one paragraph, 6-14 words, and contains its word.
- [ ] `chapter` and `paragraph` start at 0; `occurrence` starts at 1 and counts the exact spelling.
- [ ] One `default` per multi-sense word; no two senses share a place.
- [ ] `coined` only for invented words.
- [ ] No long quotations of the book anywhere.
- [ ] The validator (section 9) reports 0 errors; warnings were read.
- [ ] For a pack: ONE zip with exactly `book.epub` + `glossary.json` at the top level; `title`/`author`/`sha256` in the list match the EPUB; the EPUB is included only if it may be shared.
