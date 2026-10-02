# Word list (glossary) format, version 2

> The short, complete spec for AI agents is [book-pack-spec.md](book-pack-spec.md) (also in the downloadable book-pack-kit.zip). Sample: `examples/sample-book/`.

This file describes the word list files that Margin Words reads. Version 1 files keep working
unchanged. Version 2 adds **senses**: more than one meaning for one word, each tied to the
place in the book where it is used.

- Machine-readable schema: [`glossary.schema.json`](glossary.schema.json)
- A small complete example: [`glossary.example.json`](glossary.example.json) (for the bundled *The Twits*)
- A real, bigger v2 list: `packs/twits/glossary.json`
- Check a list from the command line: `node scripts/validate-glossary.mjs [book.epub] glossary.json`
- Dump chapters and find word positions: `node scripts/extract-epub-text.mjs book.epub ...`
- Skill for an AI assistant: [`skills/annotate-book-glossary/SKILL.md`](../skills/annotate-book-glossary/SKILL.md)

All text the reader sees (meanings, notes) should be plain, simple English. The app does not
block other writing in a list that a user uploads (it shows a small notice), but the files
shipped with the app or in the book packs (`src/`, `public/`, `packs/`) must pass `npm run check:cjk`.

## 1. File layout

```json
{
  "version": 2,
  "title": "The Twits",
  "author": "Roald Dahl",
  "sha256": "<sha256 of the EPUB, optional>",
  "level": "free text, optional",
  "lexile": "750L",
  "language": "free text, optional",
  "chapters": 29,
  "glossary": { "<lemma>": { ... entry ... } }
}
```

| Field | Needed | Meaning |
| --- | --- | --- |
| `version` | yes | `1` or `2`. `senses` is only allowed in `2`. |
| `glossary` | yes | Object. One entry per word (the key is the **lemma**, lower case). |
| `title`, `author` | no | The app warns if `title` does not match the book you add the list to. |
| `sha256` | no | SHA-256 of the EPUB file. The bundled lists use it to find their book. |
| `chapters` | no | How many chapters the author saw (see 3.1). If the user's copy has a different number, the app **ignores `chapter` and `occurrence`** and uses `context` only. |
| `level`, `language` | no | Free text for people. `level` is not shown as the difficulty rating. |
| `lexile` | no | A Lexile measure for this edition, such as `880L`. The app shows it. Leave it out when you do not have a published measure (the card says unrated). A value that is not a measure is ignored. |
| `isbn` | no | ISBN-10 or ISBN-13 of this edition. A bad value is ignored. Omit it when you cannot confirm the edition. |
| `series` | no | Series title. A name alone is kept. |
| `seriesNumber` | no | 1-based place in `series`. Stored only when `series` is present. A number without a name is ignored. |

Optional top-level parts (section 7): `paragraphs[]`, `sentences[]`, `phrases{}`. Unknown extra fields are allowed and ignored (v1 bundled files carry `example`, `examples`, `count`).

### Entry (one word)

| Field | Needed | Meaning |
| --- | --- | --- |
| `meaning` | yes, unless `senses` is given | The default meaning. |
| `pos` | no | Part of speech, free text (`noun`, `past-tense verb`). |
| `whyHard` | no | One short reason. Default: "This word is harder than everyday English." |
| `forms` | no | Other word shapes in the book that belong to this entry (`["saw","sawn"]`). The app adds a tap target for them. |
| `senses` | no (v2) | List of 1 to 12 senses. |
| `coined` | no | `true` when the **author invented** the word (for example `snozzcumber`). The reader can then say "made-up word". |
| `senseOnly` | no | `true`: the entry exists only to hold position-based senses (7.5). The reader underlines and opens the word only at the places named by the `anchors` of its senses, not at every use in the book. Default: `false`. |

The lemma is a lower-case run of letters; one apostrophe or hyphen inside is allowed. The
app finds the lemma of a tapped word with its own rules (plural `-s`, `-ies`, some irregular
nouns). If your word is shown as another shape (for example `cried` is its own entry, not `cry`),
use the shape the book uses, or list it in `forms`.

### Sense (one meaning)

| Field | Needed | Meaning |
| --- | --- | --- |
| `meaning` | **yes** | Simple English. Up to 600 letters. |
| `pos` | no | Falls back to the entry's `pos`. |
| `whyHard` | no | Falls back to the entry's `whyHard`. |
| `default` | no | `true` on at most one sense: shown when nothing matches (step 3 below). |
| `forms` | no | Word shapes this sense is for. Used in step 3 when there is no `default`. |
| `anchors` | no | Places in the book where this meaning is used (up to 60). |

### Anchor (one place)

| Field | Meaning |
| --- | --- |
| `chapter` | 0-based chapter index, **as the app splits the book** (3.1). |
| `occurrence` | 1-based: this is the n-th time the word form appears in that chapter (3.2). Needs `chapter`. |
| `form` | The exact lower-case word that `occurrence` counts. Default: the entry's lemma. Use it when the book has `shrinks` but the entry is `shrink`. |
| `context` | About 6 to 12 words copied exactly from one paragraph of the book, including the word. Up to 300 letters. |

An anchor needs `context`, or both `chapter` and `occurrence`. **Best practice: write all three.**

## 2. Which meaning is shown (matching order)

When the learner taps a word and the book's list has an entry for it:

1. **Chapter + occurrence.** A sense with an anchor whose `chapter` is the chapter on screen and
   whose `occurrence` is the tapped word's number (counted for that spelling, 3.2). If the anchor
   also has a `context` and that text is **not** in the tapped paragraph, the anchor is treated as
   stale and skipped.
2. **Context snippet.** A sense with an anchor whose `context` is found in the tapped paragraph,
   around the tapped word. (Quotes, dashes, spaces and capital letters are ignored when
   comparing.) If the anchor has a `chapter`, it must be the chapter on screen. The first sense
   in list order wins a tie.
3. **Default sense.** The sense with `"default": true`; if there is none and exactly one sense
   lists the tapped spelling in `forms`, that one.
4. **Entry meaning.** The entry's own `pos` / `meaning` / `whyHard`. (If an entry has `senses`
   but no `meaning`, the first sense is used and also becomes the entry meaning.)
5. **No entry.** The word has no entry at all: the card says "No meaning for this word in this book yet." The app never asks any online service.

The word card shows the chosen meaning. If the entry has other meanings, a small closed
"Other meanings in this book" list shows them (with the chapters where they are used). Version 1
entries have no such list.

**`senseOnly` entries.** Step 1 and 2 above also decide *whether the word is underlined at all*. For an entry
with `"senseOnly": true`, a place with no matching anchor is treated as if the word had no entry: it is not
underlined, and a tap opens the normal card for a word that is not in the list (steps 3 and 4 are never used).
See 7.5.

A list can say that one place has only one meaning: two senses may not claim the same
`chapter` + `occurrence`; the validator rejects this.

## 3. How chapters and words are counted (so a script can reproduce it)

### 3.1 Chapters

The reader does **not** use the raw EPUB spine files. `src/lib/epub.ts` builds the chapter
list like this:

1. Read the table of contents (EPUB 3 `nav`, else NCX). Each entry is cut out of its HTML file
   from its fragment to the next entry's fragment. Contents pages are skipped.
2. If that gives fewer than 2 chapters, use the spine files, split at `<h1>` (or `<h2>`) headings.
3. Chapters with fewer than 20 letters are dropped; very short chapters (< 40 letters) are merged into
   the previous one.
4. Navigation and scripts are removed, links are unwrapped, other-language blocks are removed.

`chapter` is the position in the resulting list, starting from **0**. This list depends on the
EPUB *file* (a different edition may split differently). **It is hard to reproduce without the
app's code.** For this reason:

- Use `scripts/extract-epub-text.mjs book.epub`. It runs the app's own `parseEpub` (via jsdom),
  so its chapter numbers are the same as the app's.
- Always add `context`. It does not depend on how the book is split.
- Put `"chapters": N` in the file. If the user's copy has a different count, `chapter` and
  `occurrence` are dropped and only `context` is used.

**Honest limit:** the chapter numbers are exact for the same EPUB file the author used. For any
other file, only `context` is reliable. `context` is therefore the real fallback and the thing
to get right.

### 3.2 Words and occurrences

- Take the chapter's HTML as the app stores it. Look at every text node in reading order
  (script/style-like elements are skipped; the visible reading text is what matters).
- In each text node, find words with `/[A-Za-z]+(?:'[A-Za-z]+)?/g`: ASCII letters, with at most one
  **straight** apostrophe `'` and more letters. A curly apostrophe (`’`), a hyphen, a digit or any
  other mark ends a word. So `don’t` is the two words `don` and `t`; `Muggle-Wump` is `Muggle`
  and `Wump`; `Twit's` is one word. Words never run across a tag boundary
  (`<em>no</em>w` is `no` and `w`).
- A word is compared in lower case. `occurrence` counts how many times that exact lower-case
  spelling has appeared **so far in the chapter**, starting at 1, including headings.
  The count starts again at 1 in each chapter. Different spellings do not share a count
  (`stuck` and `sticks` are counted apart).
- The tap handler uses the same numbers (`data-n` on each word button in the reader).

Note that book text uses curly quotes: the word `Twit’s` is `Twit` + `s`. Only the word
rule above matters for counting; use `extract-epub-text.mjs --find word` and copy the numbers.

### 3.3 Context

`context` is compared with the text of the **paragraph block** (`p`, `li`, `blockquote`, `h1`-`h4`)
that holds the tapped word, after the following clean-up on both sides: curly quotes become
straight, dashes become `-`, `…` becomes `...`, runs of spaces become one space, and letters are
lower-cased. So you may copy the text with either kind of quote. A snippet must lie **inside one paragraph**
(it cannot cross a paragraph break) and must contain the tapped word. If the same paragraph uses
the word twice with different meanings, choose snippets that surround the right use; the app
checks that the snippet covers the tapped word.

### 3.4 Paragraphs

`paragraph` in a paragraph note is the **0-based position of the paragraph in the chapter**, counted the way the
reader counts. This is exactly `chapter.paragraphs` as built in `src/lib/epub.ts` (`paragraphsOf`), and the reader numbers
the blocks it shows with `paragraphBlocks()` in `src/lib/help-match.ts`, which applies the same rule:

1. Take every `p`, `h1`, `h2`, `h3`, `h4`, `li` and `blockquote` of the chapter html, in document order.
2. Skip one whose **direct parent** is a `p`, `li` or `blockquote` (the outer block counts, not the inner one).
3. Skip one with fewer than 2 English letters (empty lines, "* * *", page numbers like "7").
4. If nothing is left, the whole chapter text is one paragraph (index 0).

A chapter heading that is part of the chapter html is a paragraph too (index 0 when it comes first). A paragraph is
the text of the block with every run of spaces made into one space.
Use `node scripts/extract-epub-text.mjs book.epub --paragraphs 3` to print chapter 3 with `[0] [1] [2] ...` in front of each
paragraph, and `--paragraph-search "some words"` to find the chapter and paragraph that hold some words.
As with words, the number is exact only for the same EPUB file; `context` is the check and the fallback.

## 4. Version 1 files

Unchanged. `{ "version": 1, "glossary": { "word": { "pos", "meaning", "whyHard" } } }`.
They are read as a v2 file with no senses. A v1 list can be added to a book too.

## 5. Importing a list (in the app)

A new book is added only as a **book pack** (one `.zip` with `book.epub` + `glossary.json`; see
[book-pack-spec.md](book-pack-spec.md), section 3). A standalone EPUB is not accepted. For a book that is already on the shelf,
use the book's menu "Add word list" (or drop the `.json` on the shelf). The app first
validates the list and stops with plain-English messages that name the word that is wrong.
If the book already has some of the words you choose **Add only new words** (default) or
**Replace**. Words that are not in the list are never changed. A list that comes in a pack is the whole word list of that book. Words that are not in it show the "No meaning for this word in this book yet." line.
If the book came from a book pack, your own words are kept when the pack is updated.

Notes:

- Chinese (or other non-English) letters in a **user's** list are accepted and shown; the app
  only shows a small notice. Files inside the app are kept English-only.
- Nothing is ever sent online when a word is tapped. All meanings, simple versions and explanations come from the list.
- Problems that stop an import: broken JSON; no `version` / `glossary`; a word that is not letters; the same word twice;
  `senses` in a version 1 list; a missing `meaning`; wrong anchor numbers; two meanings for one place;
  more than one `default`; too long (8 MB, 30000 words, 12 senses, 60 anchors).
- Warnings (import goes on): the title does not match, a different chapter count, anchors that
  cannot be found in this copy, very short or very long `context`, a snippet without the word.

## 6. Validator

```
node scripts/validate-glossary.mjs glossary.json               # format only
node scripts/validate-glossary.mjs book.epub glossary.json     # also checks every anchor in the book
```

With the EPUB the script checks: the chapter exists, the word occurs that many times in the
chapter, and `context` is really in the book (and for an `occurrence` anchor, in the same
paragraph as that occurrence). With the EPUB, a missing place is an **error** (the app only
warns). Exit code 0 = OK, 1 = problems, 2 = wrong usage. `--json` prints a machine-readable report.
The first run needs `npm install` in the project (it uses `typescript` and `jsdom`, and runs the same
source files as the app).

## 7. Files in this repository

| Path | Purpose |
| --- | --- |
| `src/lib/glossary-format.ts` | The rules: word pattern, validation, anchor checks, `pickSense` |
| `src/lib/glossary-import.ts` | Importing into a book, template |
| `src/components/word-list.tsx` | Import dialog and the in-app guide |
| `scripts/lib/app-modules.mjs` | Lets the command-line tools run the app's own code |
| `scripts/validate-glossary.mjs`, `scripts/extract-epub-text.mjs` | The tools |
| `scripts/build-packs.mjs` | Builds `packs/catalog.json` and the pack zips from the epubs and lists (see [PACKS_FORMAT.md](PACKS_FORMAT.md)) |
| `packs/<id>/glossary.json` | The list of one book pack (copied unchanged into the pack zip) |

With a pack list (a file under `packs/`, or `--bundled`), Chinese or other non-English letters are an error.
For a list of your own they are accepted (see section 5). The validator also checks that `simple`, `mainIdea`, `grammar`
and phrase `meaning` use only common words (`src/lib/basic-words-data.ts`, about 2000 words, plus simple forms such as
`-s`, `-ed`, `-ing`); words outside the list are **warnings** that name the words. Names, numbers and the phrase's own
words are allowed. For the meanings of single words use `node scripts/check-definition-words.mjs` (counts per book).

## 7. Paragraph help, sentence help and phrases (optional)

All three are optional top-level parts of a version 2 file. Files without them stay valid. The shared types are in
`src/lib/glossary-extras.ts`. The reader reads them from the book's own data (`src/lib/help-lookup.ts`), and they are
saved for a bundled list and for a list the user adds.

### 7.1 `paragraphs`: help for a whole paragraph

```json
"paragraphs": [
  { "chapter": 1, "paragraph": 2,
    "context": "Mr Twit felt that this hairiness made him look terrifically wise and grand",
    "mainIdea": "Mr Twit thinks his hair makes him look clever. He is wrong.",
    "simple": "Mr Twit thought that all his hair made him look very clever. But that was not true.",
    "hardWords": ["terrifically", "wise", "grand"] }
]
```

| Field | Needed | Meaning |
| --- | --- | --- |
| `chapter`, `paragraph` | yes | 0-based, see 3.1 and 3.4. |
| `context` | yes | 6 to 14 words copied exactly from the paragraph. Checked in the app and by the validator. |
| `mainIdea` | yes | 1 or 2 short sentences (up to 400 letters). |
| `simple` | yes | The whole paragraph in very common words (up to 3000 letters). |
| `hardWords` | no | Up to 20 hard words or phrases **from the original paragraph**. |

How the reader finds the note: first the note with the same `chapter` and `paragraph` whose `context` is really in the paragraph on screen;
if the numbers no longer fit (another edition), any note whose `context` is in the paragraph (same chapter first). A note whose `context` is not in the text
is never shown. If the list says `chapters: N` and the user's book has another number of chapters, `chapter` is only a tie-break.

### 7.2 `sentences`: help for one sentence

```json
"sentences": [
  { "chapter": 11, "context": "If I can get rid of some of these balloons",
    "simple": "If I can let some of these balloons go, I will stop going up.",
    "grammar": "'If + present, will + verb' is a real plan: if the first thing happens, the second will happen." }
]
```

Found by `context` inside the sentence (same chapter first, longest snippet first). `simple` up to 800 letters; `grammar` is ONE line (up to 400 letters).

### 7.3 `phrases`: phrasal verbs and idioms

```json
"phrases": {
  "give up": { "meaning": "To stop trying.", "pos": "phrasal verb", "forms": ["gave up", "giving up"], "example": "He did not give up." },
  "break the ice": { "meaning": "To start a talk with people who do not know each other.", "pos": "idiom" }
}
```

The key is the base form in lower case, two or more words (`one's` stands for my/your/his/her/its/our/their). `pos` is `phrasal verb`, `idiom` or `phrase`.
When a learner taps a word of the phrase, the reader shows the phrase card if the whole phrase is in that sentence.
Rules: simple verb forms are known without `forms` (give, gives, gave, giving; regular -s, -ed, -ing; about 100 common irregular verbs).
A two-word phrasal verb may be split by up to 3 words (`picked the big box up`) when nothing that ends a clause (comma, full stop, `and`, `to`...) sits in between.
Idioms and `phrase` entries must be next to each other. List a form in `forms` when it is not a simple form (`looked after`: simple, but `forms` is also fine).

### 7.4 `coined` words

Put `"coined": true` on a word entry when the **author invented** the word (`snozzcumber`, `frobscottle`). Do not use it for real rare words,
dialect or words the author only spelled in a funny way (`marvellous`). The `meaning` should say what the word is in the story.

### 7.5 `senseOnly` entries (uncommon senses of common words)

Some words are everyday words that are only hard in one or two places: `up` in "the lantern was *up* to him",
`run` in "the lane *ran* beside the river". A normal entry would underline every `up` and `run` in the book,
hundreds of times. Put `"senseOnly": true` on the entry instead, and give it `senses` with `anchors`:

```json
"run": {
  "senseOnly": true,
  "pos": "verb",
  "meaning": "Go along or lie along, like a lane by a river.",
  "forms": ["ran"],
  "senses": [
    {
      "meaning": "Go along or lie along, like a lane by a river.",
      "forms": ["ran"],
      "anchors": [{ "chapter": 1, "form": "ran", "context": "lane that led to her house. It ran beside the river" }]
    }
  ]
}
```

Rules:

- The field is optional and must be `true` or `false`. An entry without it (or with `false`) behaves exactly as before.
- Only the places named by an anchor are underlined: an anchor with `chapter` + `occurrence` (counted for that
  spelling, 3.2), or an anchor with a `context` snippet around the word. All other uses are plain text and their card is the
  normal "not in the list" card. The `default` sense, `forms` fallback and the entry's own `meaning` are not used to
  decide where the word is underlined.
- Write the entry's own `meaning` too (the same text as the sense is fine); it is shown in the notebook and lists.
- A `senseOnly` entry whose senses have no anchors would never be underlined: the validator gives a warning.
- `senseOnly` needs `"version": 2` in practice, because anchors live in `senses`.

### 7.6 Writing rules for all help text

- English only. Very common words (the 2000 most common words). Short sentences.
- Only restate the original. Add no new facts, no opinions, no guesses about what happens next.
- Keep names and key plot words unchanged (`Willy Wonka`, `Oompa-Loompa`, `Narnia`), even if they are not common words.
- Do not copy more than a short snippet of the book into any field except `context`.
