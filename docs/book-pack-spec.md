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
| `the-lantern-seller.pack.zip` | The same two files as a ready-made book pack (`book.epub` + `glossary.json`). Packs are published on a books host (a catalog); readers add books from the app's Discover page. |

The kit zip itself is NOT a pack (it holds a spec and loose files). Import `the-lantern-seller.pack.zip` from the kit.

### 2.1 Where the command-line checker lives

The checker is not in this zip, and it is not in the website build (`dist/` or `dist/kit/`). QA will not find it in the build output. It is a file in a git checkout of the Margin Words repository:

`scripts/validate-glossary.mjs`

From the repository root, after `npm install` once:

```
node scripts/validate-glossary.mjs book.epub glossary.json
```

Exit code 0 means the list is OK. Warnings are allowed and are printed on stderr. Add `--json` to print one JSON report on stdout (`ok`, `errors`, `warnings`) for a script:

```
node scripts/validate-glossary.mjs --json book.epub glossary.json
```

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

1. The file is a `.zip`. A bare `.epub` is refused with a message and a link to the guide page (`/kit/`).
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

- Hosting a catalog (optional, for people who run a website): `catalog.json` = `{ "format": 1, "name": "...", "packs": [ { "id", "title", "author", "rev", "lexile": "880L", "isbn": "9780141960616", "series": "Alice", "seriesNumber": 1, "category": "novel", "epub": { "url", "bytes", "sha256" }, "glossary": { "url", "bytes", "sha256", "rev" } } ] }`. `lexile`, `isbn`, `series`, `seriesNumber` and `category` are optional. `series` may stand alone. `category` is `novel` (the default when it is missing) or `speech`. Discover uses it for its tabs. `url` is relative to the catalog or a full https address. The reader app downloads these packs for the learner (from their cards on Discover) and shows the measure and ISBN on the card.
- A word-list catalog (no book file) is `{ "format": 1, "name": "...", "lists": [ { "id", "title", "author", "lexile", "isbn", "series", "seriesNumber", "category", "glossary": { "url", "bytes", "sha256" } } ] }`. It must not include an EPUB. `category` is the same optional Discover tab (`novel` or `speech`; missing means novel). The reader downloads `glossary.json` only. The person prepares their own e-book of that ISBN and pairs it in the app. The app then shows what share of the list's `context` snippets were found in that e-book.
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
  spine?: { merge: { [droppedHref: string]: string } }; // append a dropped spine file onto a chapter (section 5.3)
  segmentation?: 2;        // optional. 2 splits a chapter-wrapper blockquote (section 5.4). Omit it and a blockquote stays one paragraph.
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
  trickyMeaning?: boolean; // true: familiar word, unfamiliar meaning here (4.8)
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
  chapter: number | string; // >= 0, or an extra id "x0", "x1", … (section 5.3)
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
  chapter: number | string; // >= 0, or an extra id "x0", "x1", … (section 5.3)
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
my/your/his/her/its/our/their. A comma may sit between words (`oh, brother`, and the same in `forms`). That entry matches
the words with the comma or without it, and only when they are next to each other: the comma does not open a gap. A key
with no comma still stops at a comma. Max 60 chars. The app already knows regular verb forms (`packs up`, `packing up`, and about
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

### 4.8 `trickyMeaning`

Put `"trickyMeaning": true` on a sense when a word learners already know is used in a meaning they do not (`well` = a water well,
`bear` = carry). Give that sense `anchors`. At every place where one of those anchors lands, the reader draws a calm wavy line under
the word (different from the straight line of a hard word and from the phrase line) and the card opens with that sense first. Other
uses of the word are not marked. Only the boolean matters; the reader never looks at the text of `whyHard`. Absent or `false` = no mark.
Start `whyHard` with "Not the usual meaning!" and say what the usual meaning is. Use it together with `senseOnly` for very common words.

## 5. How the reader numbers the book (needed for anchors and notes)

If you have the project tools, use them (section 8). If not, follow these rules exactly.

### 5.1 Words

A word is a run of Unicode letters, including accented letters and combining marks, with at most one straight
apostrophe followed by letters: `café` and `Yucatán` are each one word, and so is `e` plus U+0301.
A curly apostrophe (`’` U+2019, `‘` U+2018), U+02BC, a hyphen, a digit or any other character ends a word
for counting: `don’t` = `don` + `t`; `Coral’s` = `Coral` + `s`; `Twit's` (straight apostrophe) is one word;
`Muggle-Wump` = `Muggle` + `Wump`. The reader joins a curly apostrophe into one button only when none of
those counted pieces is in the word list: `couldn’t` is one button (the curly glyph stays) and the tap
looks up `couldn't`. `Cap’n`, `o’clock` and `ticket’ll` stay separate buttons when `cap`, `clock` or
`ticket` is an entry, so the tap main had still works. The button's occurrence number is the first
counted piece it shows, and every piece is still counted, so anchors written against this rule do not
move. A quote that only sits before or after a word does not join it.
Inline tags do not split a word when there is no space between them
(`<span class="big">J</span>ack` = `Jack`). A space, a line break, a `<br>`, or a block boundary still separates words.
Words are compared in lower case. Soft hyphens are removed first, and a zero-width space or word joiner
inside a word is removed too. When that mark is in its own inline tag between the two halves, the halves
are put into one text node before counting. A line break that only sits between those tags is joined
across too. A space in the text, or a block boundary, is not joined. Positions and
context are matched against text with soft hyphens removed. A normal hyphen is kept. Chapter and paragraph
numbers do not change.

### 5.2 Occurrence

`occurrence` = how many times that exact lower-case spelling has appeared so far in the chapter, counting from 1, in reading
order, headings included. The count restarts at 1 in each chapter. `stuck` and `sticks` are counted separately. Use `form`
when the spelling in the book differs from the entry key (`shrinks` vs `shrink`). A curly possessive still counts as the
bare word: `Coral’s` is one occurrence of `coral` (and one of `s`). A straight `Coral's` counts as `coral's`, not `coral`.

### 5.3 Chapters

`chapter` is the 0-based position in the reader's chapter list, not in the EPUB spine:

1. Use the table of contents (EPUB 3 `nav`, else NCX); cut each entry's HTML from its fragment to the next entry's fragment; skip contents pages. A fragment that matches nothing inside the file is skipped. An id on the `<body>` or `<html>` element is the start of that file, but only when other contents entries already make the chapter list. One such entry among entries that name a whole file is kept. If every fragment sits on `<body>` or `<html>`, the contents list is not used and each spine file stays its own chapter.
2. Append a later spine file at the end of that chapter only when its prefix equals the prefix of the spine file just before it, and that prefix is used by exactly one contents entry. The prefix is the path with one trailing `_split_` and digits removed (`story_c01_r1_split_000.xhtml` then `story_c01_r1_split_001.xhtml`, or `c01.xhtml` then `c01_split_001.xhtml`). A chain (`split_001`, then `split_002`) is allowed. A book-wide series such as `index_split_*` or `Title_split_*` is used by many contents entries and is not appended. Listed paragraphs keep their indexes. Any other spine file the chapter list does not already show is an extra, not a chapter: its own id (`x0`, `x1`, …), shown in spine order, labelled Extra. Those ids are outside the chapter numbering, so adding one (including front matter that sits before chapter 1) does not change any chapter index or segment id `c<chapter>.p<paragraph>`. Word anchors and phrase notes do not resolve on an extra. A contents entry whose whole file has zero paragraphs is not inserted as a numbered chapter, so later chapter numbers stay put. The linear spine files that follow it, until the next contents file, are one extra in that reading-order place, titled with the contents title. Its id is the next `x0`, `x1`, … in spine order. A paragraph note or a sentence note may set `chapter` to that id (`"x3"`). Any other extra is unchanged for sentence notes: a sentence note does not resolve there. A paragraph note may still name that extra's id (for example `"x2"`) and is placed by the same rule as a numbered chapter, counting every extra. A sample of the next book that is not in the contents list stays an extra. A contents entry that has text but is too short to keep stays dropped, and its split files are not added as chapters. The chapter list does not gain a chapter.
3. If the contents list is missing, empty, or has fewer than 2 entries, or it produces fewer than 2 chapters, each spine file is its own chapter, split at `<h1>` (else `<h2>`) headings. Do not collapse that book into one chapter. That fallback has no extras, and its chapter text stays byte for byte the same.
4. Drop chapters with fewer than 20 letters; merge chapters with fewer than 40 letters into the previous one.
5. Scripts and navigation are removed, links are unwrapped.

`"spine": { "merge": { "<dropped href or manifest id>": "<href of the contents chapter it continues>" } }` appends that dropped file after the chapter's existing paragraphs. Earlier paragraph indexes do not move. If several chapters were cut from the target file, the text is added to the last one. A key may name an empty contents file or a content file absorbed into that recovered extra. Either name, or both, appends that extra once. A name that matches no spine item is ignored when the book is opened. The glossary check warns, naming the key: the command-line check, and the app when the book and the list are imported together. A key that matches a spine item but merges nothing into or from that file warns too, with the text `spine.merge key "<key>" matches a spine item but nothing is merged into or from it.` An empty contents file, or a file absorbed into that extra, does not warn when that extra is appended. A bad entry is a warning, and the word list still loads. Omit `spine` when no file needs this. The appended file's title is shown as a heading in front of those paragraphs when the file does not already have that heading (its first paragraph, or an `h1`–`h4`). The heading is not a paragraph and its words are not counted. Examples that need it: Magic Tree House 33 `Magic_Tree_H-at_Candlelight_split_009` continuing `split_008`; Wings of Fire 3 `part0006_split_001` and `part0005_split_001`; Wings of Fire 4 `split_013`; Wings of Fire 5 `split_014`.

Write `"chapters": N` in the file. If the user's EPUB gives another count, the reader ignores `chapter` and `occurrence`
and uses `context` only. So `context` is the part that must always be right.

`node scripts/seg-report.mjs book.epub glossary.json` prints each chapter index, its segment ids (`c0.p0` through `c0.pN`), and a hash of that chapter's paragraph text. Extra files are separate `extra` lines. Diff two runs to see whether any existing chapter or segment moved.

Checked against the reader from before extras were added, these are the only chapter-text changes, and only where a whole chapter had been one blockquote:

- Magic Tree House 30 and 37: every contents chapter keeps its index and every paragraph, byte for byte. Files the old reader dropped are extras and are not inserted into the chapter list. For book 30 the contents entry Cover points at an empty title page. Cover is front matter, so the files after it stay separate extras, as they did before empty contents files were recovered: `x0` jacket (1 paragraph), `x1` fm1 (8), `x2` fm2 (11), `x3` toc, `x4` epi, `x5` ada, `x6` c15 (a later story, 56 paragraphs), `x7`–`x10` bm2–bm5. Numbered chapters are unchanged. For book 37 that is `x0`–`x1` praise, `x2` contents, `x3` epigraph, `x4` the preview story (66 paragraphs), `x5`–`x8` promos.
- Magic Tree House 33, and only when its word list sets `"segmentation": 2`: the 11 contents chapters keep their indexes and titles (0 A Book of Magic, 1 Carnival, 2 The Grand Lady, of the Lagoon, 3 Rats!, 4 Lorenzo, 5 Disaster, 6 The King and the Ruler, 7 Home by Day, 8 The Painting, 9 More Facts About Venice, 10 Author's Research, Note). Paragraph counts change from 1, 5, 9, 7, 1, 8, 1, 1, 1, 1, 1 to 50, 55, 86, 75, 77, 76, 75, 62, 51, 8, 8 because each chapter body was a calibre blockquote. The old paragraph 0 was that whole wrapper; the new paragraphs are the headings and paragraphs inside it, in order. Joining the new paragraphs gives the same words as old paragraph 0 for chapters 0, 4, 6, 7, 8, 9, and 10. Chapters 1, 2, 3, and 5 also used to list a sidebar a second time; that second copy is not a separate segment now. `Magic_Tree_H-at_Candlelight_split_009` (A Visit to Venice, 20 paragraphs) stays extra `x6` until `spine.merge` appends it after chapter 0. That append does not move `c0.p0`–`c0.p49`. Without `"segmentation": 2` those chapters stay one blockquote paragraph each, the same ids as before. A prologue that is one blockquote around an `h1` (Magic Tree House 17 and 24, chapter 2) stays `c2.p0` until that list opts in.

### 5.4 Paragraphs

`paragraph` = 0-based index in the chapter's paragraph list: every `p`, `h1`-`h4`, `li`, `blockquote` in document order,
except a block whose direct parent is a `p`, `li`, or `blockquote`, and except a block with fewer than 2 English letters (empty
lines, `* * *`, page numbers). A blockquote is one paragraph. If nothing is left, the whole chapter text is paragraph 0. A chapter heading inside the chapter
HTML is a paragraph (index 0 when it comes first). Example: in `the-lantern-seller.epub` chapter 1 the heading is `[0]`, "As the sun sank..." is `[1]`, the lantern-lighting paragraph is `[3]`.

`"segmentation": 2` at the top of the word list is optional. It splits a chapter-wrapper blockquote: one with a `calibre` class, or one that contains an `h1`–`h4`. That wrapper is not a paragraph; the headings and paragraphs inside it are, in order. A quotation or a poem stays one paragraph. Without the field, output is the paragraph list above for every chapter, including a prologue that is one blockquote around a heading. Magic Tree House 33 sets the field. Magic Tree House 17 and 24 leave it off until their notes are re-anchored.

Only when every spine content document has no `p` element at all, each innermost `div` that contains text directly or through inline elements (`span`, `i`, `b`, `em`, `strong`, `a`, and so on) is a paragraph too, in that same document order. An empty `div`, or a `div` that holds only an image, does not count. A wrapping `div` does not count when a `div` inside it holds the text. A book with at least one `p` does not use this rule, and its paragraph list stays the same.

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
8. If you are not sure a line is in the EPUB, or you cannot copy its `context`, leave that item out. A short correct list beats a long list with errors. This is not the rule for "maybe they know this word." When you are not sure they know it, mark it.

Copyright
9. Do not quote the book beyond short snippets. `context` is 6-14 words from one paragraph; `example` is one short sentence. `simple` restates a
   paragraph in new words and must not copy it. No other field may contain book text longer than a few words.

Choosing words
10. The reader is in the first year of Chinese junior high, about 12. They can read a school sentence. They do not know old house words, old titles, or a verb that looks like another verb. The 2000 most common words is the wrong line for this choice: `struck` is on that list, and these readers still mix it up with `stuck`. Mark a word when any test is yes. There is no maximum and no per-chapter quota.
    - Wrong twin. The word looks like one they know. `her head struck against the roof` means hit, not stuck. The meaning says both.
    - Old thing, even once: a thing, tool, clothes, room, food, or job a school book does not teach. `hearthrug`, `fender`, `carrier`. A measure they cannot picture is this test: say the size in centimetres or litres. One inch is about 2.5 centimetres. That size is the one fact that is not in the story. Do not add history.
    - Old label: `Esq.`
    - Not the school meaning. Before you leave a familiar word out, put the meaning a first-year textbook gives that spelling into this sentence. Try each textbook meaning when there are two. The sentence still reports the same event: leave the word out. The sentence stops reporting that event: mark only that place (`senseOnly`, and `trickyMeaning` on that sense). Start `whyHard` with `Not the usual meaning!` and say the textbook meaning. `that's the great puzzle` is a hard question; a textbook puzzle is a picture cut into pieces. `shedding gallons of tears` is the verb "to let something fall"; a textbook shed is a small building. `On every golden scale` is one hard plate on the crocodile; a textbook scale is a tool for weighing, or how big something is.
    - Unclear name. A person's name a first-year reader may try to translate as an ordinary word. `Ada` and `Mabel` are girls Alice knows. The meaning says only that it is a name, and who it is if this sentence says so. Skip a name the sentence already calls a name. Skip a place name used as a label.
    - Fixed phrase. Two or more neighbouring words that work as one unit. This is not slang. Slang is a word a small group uses instead of the ordinary word. Before you leave the group out, put the textbook meaning of each word into the sentence, in order. The sentence still reports the same event: leave the group out. `Come up again, dear!` is "move to a higher place." The people above the hole are calling her back up, so `come up` stays out. The sentence stops reporting that event: write one phrase for the whole unit. `next to no toys` is not "beside no toys." `next to no` means almost none. `made up my mind` is not "built my mind in a higher place." `make up one's mind` means to decide. Do not shorten the key to a piece that is ordinary in other sentences: `next to the door` and `made up the story` stay plain. One scene gets one entry. Leave out a group the same sentence explains.
    If you are not sure they know it, mark it. Leave a word out only after its textbook meaning still fits this sentence, and leave out a word the same sentence explains. A word already named in a paragraph note's `hardWords` still needs its own dictionary entry. A word in a letter or a label is still a dictionary word, even when those lines are not a numbered paragraph.
11. Key = lower-case base form (`lantern`, not `lanterns`); see section 4.1 for shapes the app cannot reduce. `struck` does not reduce to `strike`, so the key is `struck`.
12. Do not repeat a word unless it has a new meaning. Do not stop at 15 or 30 words. A cap drops real hard words.

## 8. Workflow

Without the project tools (only the EPUB and this file):

1. Unzip the EPUB (it is a zip). Read `META-INF/container.xml` -> OPF -> spine; read the TOC (`nav.xhtml` or `toc.ncx`) to get the chapter list as in section 5.3. Note `title`, `author`, chapter count, and the sha256 of the EPUB file.
2. Read each chapter's text. Number paragraphs as in section 5.4 and count words as in section 5.1-5.2.
3. Per chapter pick hard words (section 7.10-7.12). For each, write the entry. If the word has a second meaning in this book, write `senses`.
4. Write a paragraph note for each place section 7 names (no quota of 1 or 2), plus the sentence notes, the phrases from the fixed-phrase test in section 7, and the `coined` words that really occur. A paragraph that only sets up a letter or an address still gets one note. A note does not replace the dictionary entries for the words in it. One sentence note is enough when the only hard part is the shape of that sentence. Do not write a paragraph note whose only hard part is one word.
5. For every anchor/note: copy `context` verbatim from the book text; compute `chapter`, `occurrence`, `paragraph` by the rules. Do not guess numbers. If unsure of a number, omit `occurrence`/`paragraph` where allowed (anchors work with `context` alone; paragraph notes need `paragraph`, so make it right).
6. Assemble one `glossary.json`. Validate (section 9). Fix every error. Read the warnings.
7. If a pack is wanted, zip `book.epub` + `glossary.json` (section 3). Zip entries at the top level or in one folder, no `__MACOSX`.

With the Margin Words project folder (Node 20+, run `npm install` once). These tools run the reader's own code, so the numbers are exact:

```
node scripts/seg-report.mjs book.epub glossary.json            # chapter ids, segment ids, hash per chapter (extras on their own lines)
node scripts/extract-epub-text.mjs book.epub                      # title, author, sha256, chapters (0-based) with word counts
node scripts/extract-epub-text.mjs book.epub --out work --numbered # work/ch000.txt ... with [0] [1] [2] paragraph numbers
node scripts/extract-epub-text.mjs book.epub --candidates 300      # likely hard words with counts and forms
node scripts/extract-epub-text.mjs book.epub --find WORD           # every use: chapter, paragraph, occurrence, surrounding text
node scripts/extract-epub-text.mjs book.epub --paragraph-search "some words"   # chapter and paragraph holding the text
node scripts/validate-glossary.mjs book.epub glossary.json         # full check; exit 0 = OK
node scripts/validate-glossary.mjs --json book.epub glossary.json  # same check, one JSON report on stdout
node scripts/check-definition-words.mjs --fail glossary.json       # meanings use only common words
```

These scripts live only in a git checkout, at `scripts/`. They are not inside this kit zip and not in the website build. Run the commands above from the repository root. See section 2.1.

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

Warnings (read them): title differs, chapter count differs, hyphenated key, context shorter than 4 words or longer than 30 (`the context is very short` / `the context is long`; this count is the words in the `context` string and does not change when `spine.merge` is applied), context without the word, `simple`/`mainIdea`/`grammar`/phrase meaning using words outside the 2000 basic words (names and numbers are fine), a `spine.merge` key or target that matches no spine item, and a `spine.merge` key that matches a spine item but merges nothing into or from that file.

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
