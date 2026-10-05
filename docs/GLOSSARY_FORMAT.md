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
| `segmentation` | no | `2` splits a chapter-wrapper blockquote into its headings and paragraphs (3.4). Omit it and a blockquote stays one paragraph. Any other value is ignored. |

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
   from its fragment to the next entry's fragment. A fragment that matches nothing inside the
   file is skipped. An id on the `<body>` or `<html>` element is the start of that file, but
   only when other contents entries already make the chapter list. One such entry among entries
   that name a whole file is kept. If every fragment sits on
   `<body>` or `<html>`, the contents list is not used and each spine file stays its own chapter.
   Contents pages are skipped.
2. A later spine file is appended at the end of that chapter only when both are true.
   Its prefix equals the prefix of the spine file just before it, so `split_000` then
   `split_001` then `split_002` can chain. The prefix is the path with one trailing
   `_split_` and digits removed (`story_c01_r1_split_000.xhtml` and
   `story_c01_r1_split_001.xhtml` share `story_c01_r1.xhtml`; `c01.xhtml` and
   `c01_split_001.xhtml` share `c01.xhtml`). That prefix is used by exactly one contents
   entry. A book-wide series such as `index_split_*`, `FLIPPED_split_*`,
   `Title_split_*`, or `Wings_of_Fire_1__Dragonet_Proph_split_*` is used by many
   contents entries, so those files are not appended. The listed paragraphs stay at
   the same indexes; the extra text is added after them. Any other spine file the
   chapter list does not already show is an **extra**, not a chapter. It keeps its own
   id (`x0`, `x1`, …), is shown in spine order, and is labelled Extra. Those ids sit
   outside the chapter list, so front matter before chapter 1 does not renumber any
   chapter or any segment `c<chapter>.p<paragraph>`. Word anchors and phrase notes
   do not resolve on an extra. A contents entry whose whole file has zero paragraphs
   is not inserted as a numbered chapter, so later chapter numbers stay put. The
   linear spine files that follow it, until the next contents file, are one extra
   in that reading-order place. Its id is the next `x0`, `x1`, … in spine order.
   The title is the contents title, and a paragraph note or a sentence note can name
   that id (`"chapter": "x3"`). This does not run when the contents title is front
   matter (Cover, Title Page, Copyright, Contents, and the same kind of label).
   The files after those stay separate extras, with the same text and the same ids
   they had before an empty contents file could be recovered. Any other extra is
   unchanged for sentence notes: a sentence note does not resolve there. A paragraph note may still name that extra's id (for example `"x2"`) and is placed by section 7.1, which counts every extra. A contents entry that has text but is too short to keep (a one-word
   heading) stays dropped, and its later split files stay ordinary extras.
3. If the contents list is missing, empty, or has fewer than 2 entries, **or** it produces
   fewer than 2 chapters, each spine file is its own chapter, split at `<h1>` (or `<h2>`)
   headings. A 1-entry contents list does not collapse those files into one chapter, and
   that book has no extras. This is the whole chapter list for those books. It stays
   byte for byte the same, including every paragraph index.
4. Chapters with fewer than 20 letters are dropped; very short chapters (< 40 letters) are merged into
   the previous one.
5. Navigation and scripts are removed, links are unwrapped, other-language blocks are removed.

An optional top-level `"spine"` object can append a dropped file onto a chapter that is
already in the list:

```json
"spine": { "merge": { "Text/ch01_split_009.xhtml": "Text/ch01_split_008.xhtml" } }
```

Each key is the dropped spine file (its manifest id, its href, or its file name). Each
value is the contents chapter it continues (the same kinds of name). A key may name the
empty contents file, or a content file that was absorbed into that recovered extra.
Those two names are the same extra: either key, or both, appends that text once.
The file is added
after the paragraphs that chapter already has, so earlier paragraph indexes do not move.
If several chapters were cut from that file, the text is added to the last one. Files are
added in spine order. A name that matches no spine item is ignored when the book is
opened. The glossary check warns, naming that key: the command-line check, and the app
when the book and the list are imported together (a warning on the opened book, and the
same warning in the “add your e-book” dialog before the book is saved). A key that matches
a spine item but merges nothing into or from that file warns too:
`spine.merge key "<key>" matches a spine item but nothing is merged into or from it.`
An empty contents file, or a file absorbed into that extra, does not warn when that extra
is appended. The check applies
that merge before it counts words and notes, the same way the app does when it opens the book. A bad entry is a warning,
not an error. This does not change books that omit `spine`. When the appended file's
title is not already its first paragraph, and no `h1`–`h4` in that file is the same
title, the reader shows the title as a heading in front of the appended paragraphs.
That heading is not a paragraph, so no paragraph index moves, and its words are not
counted. Teachers use it when the
continuation rule above does not apply, for example Magic Tree House 33
`Magic_Tree_H-at_Candlelight_split_009` continuing `split_008`, Wings of Fire 3
`part0006_split_001` and `part0005_split_001`, Wings of Fire 4 `split_013`, and Wings of
Fire 5 `split_014`.

`"segmentation": 2` is separate from `spine`. It changes which blocks inside a chapter count as paragraphs (3.4). It does not add or remove chapters. Omit it and the paragraph list stays the one this book already uses.

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
- Before words are counted, soft hyphens (U+00AD) are removed. A zero-width space (U+200B) or
  word joiner (U+2060) inside a word is removed too. If that mark sits in its own inline tag
  between the two halves (`<span>mys</span><span>&#xad;</span><span>teriously</span>`, including
  a nested span, and a line break that only sits between those tags), the halves are put into
  one text node, so the word is `mysteriously`. A space in the text, or a block boundary, is
  not joined. A normal hyphen is kept, so `well-known` stays `well` and
  `known`. Positions and context are matched against text with soft hyphens removed. Chapter and
  paragraph numbers do not change.
- In each text node, find words with `(?:\p{L}\p{M}*)+(?:'(?:\p{L}\p{M}*)+)?`: Unicode letters,
  including accented letters and combining marks, with at most one **straight** apostrophe `'`
  and more letters. `café`, `Yucatán`, and `e` plus U+0301 are each one word. A curly apostrophe
  (`’` U+2019, `‘` U+2018) or U+02BC, a hyphen, a digit or any other mark ends a word for counting.
  So `don’t` is the two counted words `don` and `t`; `Coral’s` is `Coral` and `s`; `Muggle-Wump`
  is `Muggle` and `Wump`; `Twit's` (straight apostrophe) is one word. Inline tags do not split a
  word when there is no space between them (`<span class="big">J</span>ack` is `Jack`). A space,
  a line break, a `<br>`, or a block boundary still separates words
  (`<span>hello</span> <span>world</span>` is `hello` and `world`).
- The tap button joins a curly apostrophe only when **none** of the counted pieces is itself
  in the word list. `couldn’t` is one button (`couldn` and `t` are not entries); the curly glyph
  stays, and the tap looks up the straight spelling `couldn't`. `Cap’n`, `o’clock` and `ticket’ll`
  stay split, because `cap`, `clock` and `ticket` are entries, so those taps stay the buttons main
  drew. `data-n` is the occurrence of the button's first counted piece. Pieces that are not buttons
  are still counted, so later anchors do not move. A straight apostrophe is unchanged: `Coral's`
  is already one word and counts as `coral's`, not as `coral`. When `coral` is an entry, `Coral’s`
  stays the button `Coral` (plus `s`), which is occurrence 1 of `coral`.
- A word is compared in lower case. `occurrence` counts how many times that exact lower-case
  spelling has appeared **so far in the chapter**, starting at 1, including headings.
  The count starts again at 1 in each chapter. Different spellings do not share a count
  (`stuck` and `sticks` are counted apart). `Coral’s` still adds one to `coral` and one to `s`.
- The tap handler uses those numbers (`data-n` on each word button in the reader).

Note that book text uses curly quotes: the word `Twit’s` still counts as `Twit` + `s`. Only the word
rule above matters for counting; use `extract-epub-text.mjs --find word` and copy the numbers.
Search for `coral`, not `coral's`, when the book spells it `Coral’s`.

### 3.3 Context

`context` is compared with the text of the **paragraph block** (`p`, `li`, `blockquote`, `h1`-`h4`,
or a text `div` in a book that has no `p` at all — see 3.4)
that holds the tapped word, after the following clean-up on both sides: soft hyphens are removed
(see 3.2), curly quotes become
straight, dashes become `-`, `…` becomes `...`, runs of spaces become one space, and letters are
lower-cased. So you may copy the text with either kind of quote. Copy the word as it reads
(`mysteriously`), not the two halves around a soft hyphen. A snippet must lie **inside one paragraph**
(it cannot cross a paragraph break) and must contain the tapped word. If the same paragraph uses
the word twice with different meanings, choose snippets that surround the right use; the app
checks that the snippet covers the tapped word.

### 3.4 Paragraphs

`paragraph` in a paragraph note is the **0-based position of the paragraph in the chapter**, counted the way the
reader counts. This is exactly `chapter.paragraphs` as built in `src/lib/epub.ts` (`paragraphsOf`), and the reader numbers
the blocks it shows with `paragraphBlocks()` in `src/lib/help-match.ts`, which applies the same rule:

1. Take every `p`, `h1`, `h2`, `h3`, `h4`, `li` and `blockquote` of the chapter html, in document order.
2. Skip one whose **direct parent** is a `p`, `li`, or `blockquote`. The blockquote itself is one paragraph. This is the default, and every list uses it unless the file sets `"segmentation": 2` at the top. With that field, a chapter-wrapper blockquote is not itself a paragraph: it has a `calibre` class, or it contains an `h1`–`h4`. Its headings and paragraphs are counted instead. A quotation or a poem (no heading, and no `calibre` class) stays one paragraph even when the field is set. Omit the field to keep the paragraph ids this book already has.
3. Skip one with fewer than 2 English letters (empty lines, "* * *", page numbers like "7").
4. If nothing is left, the whole chapter text is one paragraph (index 0).
5. Only when **every spine content document in the book** has no `p` element at all: also count each innermost `div` that contains text directly or through inline elements (`span`, `i`, `b`, `em`, `strong`, `a`, and so on). An empty `div`, or a `div` that holds only an image, does not count. A `div` that wraps another text-bearing `div` does not count; the inner one does. These sit in the same document order as the headings, list items and quotations. A book with even one `p` ignores this step, and its paragraphs stay exactly as they were without it.

A chapter heading that is part of the chapter html is a paragraph too (index 0 when it comes first). A paragraph is
the text of the block with every run of spaces made into one space, and with soft hyphens removed (3.2).
The paragraph index is the same as it would be if those characters had not been in the file.
Use `node scripts/extract-epub-text.mjs book.epub --paragraphs 3` to print chapter 3 with `[0] [1] [2] ...` in front of each
paragraph, and `--paragraph-search "some words"` to find the chapter and paragraph that hold some words.
As with words, the number is exact only for the same EPUB file; `context` is the check and the fallback.

## 4. Version 1 files

Unchanged. `{ "version": 1, "glossary": { "word": { "pos", "meaning", "whyHard" } } }`.
They are read as a v2 file with no senses. A v1 list can be added to a book too.

## 5. Importing a list (in the app)

New books are added from the **Discover** page only (a signed-in reader; public-domain packs download
from their cards, a word-list book asks for the reader's own EPUB). The app has no `.zip` import;
packs (one `.zip` with `book.epub` + `glossary.json`; see [book-pack-spec.md](book-pack-spec.md),
section 3) are the format for the books host. For a book that is already on the shelf,
use the book's menu "Add word list" (a `.json` file). The app first
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
node scripts/validate-glossary.mjs --json book.epub glossary.json
```

The script is `scripts/validate-glossary.mjs` in a git checkout of this repository. It is not
in the website build and not inside `book-pack-kit.zip`. Run it from the repository root.

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
| `chapter`, `paragraph` | yes | `chapter` is 0-based (see 3.1) or an extra id such as `"x2"` or `"x3"` (a recovered contents file, or any other extra, including an appendix). `paragraph` is 0-based (see 3.4). |
| `context` | yes | 6 to 14 words copied exactly from the paragraph. Checked in the app and by the validator. |
| `mainIdea` | yes | 1 or 2 short sentences (up to 400 letters). |
| `simple` | yes | The whole paragraph in very common words (up to 3000 letters). |
| `hardWords` | no | Up to 20 hard words or phrases **from the original paragraph**. |

How the reader finds the note: a note belongs to **one** paragraph of the book. The order is: (1) the paragraph with the note's `paragraph` id in its own `chapter`, if its text contains the `context`; (2) the paragraph of that chapter that contains the `context` and is nearest to the id; (3) when the note's chapter does not exist in the user's book or holds no match (users import their own EPUB, so chapter numbers can differ), the whole book is searched, and the note is placed only if **exactly one** paragraph in the whole book contains the `context`. That search counts every numbered chapter and every extra (a recovered contents file and an appendix, ids such as `x2` and `x3`), and it counts a paragraph that already owns notes. That one paragraph gets the note, also when it already owns other notes (a paragraph may own several notes; the first note placed is the primary one, and the help panel shows that primary note first). With zero matches, or two or more, the place is ambiguous and the note gets no lightbulb. Steps 1 and 2 still skip a paragraph that already has an owner. A note whose `chapter` is an extra id such as `"x2"` uses that extra as its own chapter for steps 1 and 2, the same way a number uses a numbered chapter. A numbered chapter never takes such a note at steps 1 or 2. So make the `context` long enough to be unique in the book. A short `context` that also appears in other paragraphs ("Sora.") is therefore safe: it lights its own paragraph by `chapter` + `paragraph`, or nothing. The lightbulb is drawn on exactly the paragraphs that own a note with real `mainIdea` and `simple` text, however short the paragraph is (a one-line dialogue or a heading is fine). A note whose `context` is nowhere in the book is never shown. If the list says `chapters: N` and the user's book has another number of chapters, a numeric `chapter` is only a hint for steps 1 and 2; step 3 does not guess among several matches. An extra id still has to name that extra for steps 1 and 2.

### 7.2 `sentences`: help for one sentence

```json
"sentences": [
  { "chapter": 11, "context": "If I can get rid of some of these balloons",
    "simple": "If I can let some of these balloons go, I will stop going up.",
    "grammar": "'If + present, will + verb' is a real plan: if the first thing happens, the second will happen." }
]
```

Found by `context` inside the sentence (same chapter first, longest snippet first). `chapter` may be an extra id such as `"x3"` (see 3.1); that note matches only while that extra is on screen. `simple` up to 800 letters; `grammar` is ONE line (up to 400 letters).

### 7.3 `phrases`: phrasal verbs and idioms

```json
"phrases": {
  "give up": { "meaning": "To stop trying.", "pos": "phrasal verb", "forms": ["gave up", "giving up"], "example": "He did not give up." },
  "break the ice": { "meaning": "To start a talk with people who do not know each other.", "pos": "idiom" }
}
```

The key is the base form in lower case, two or more words (`one's` stands for my/your/his/her/its/our/their). A comma may sit between words (`oh, brother`, and the same in `forms`). That entry matches the words with the comma or without it, and only when they are next to each other. A key with no comma still stops at a comma. `pos` is `phrasal verb`, `idiom` or `phrase`.
A phrase is not slang. Write one when the textbook meaning of each word, put into the sentence in order, stops reporting the same event (`next to no` is almost none; `make up one's mind` is to decide; `come to a conclusion` is to decide after thinking, and `general` there means the decision covers many places, not "what everyone already knows"). Leave the group out when those meanings still report the same event (`come up` is still "move to a higher place"). The key is the whole unit, so an ordinary use of a shorter piece stays plain (`next to the door`, `made up the story`, `come to the door`). When the book puts an extra word inside, list that shape in `forms` (`come to the general conclusion`). Do not define the noun with that same verb phrase. `make out` means to manage to see, hear, or understand (`she soon made out that`). `shut up like a telescope` is not "be quiet, like a telescope." `shut up` there means to close by sliding shorter. The object word is an Old thing entry: the tube is made of parts that slide shorter or longer, which a lens telescope does not do. Say that one fact on the object. Keep the long key `shut up like a telescope` when the book also uses `shut up` to mean be quiet. A book whose only `shut up` is this motion may use the key `shut up`. `opening out like a telescope` is the same tube pulled longer, so the object entry covers it. A paragraph note does not replace the object entry. Do not write a short key that also sits inside a longer ordinary group (`as well` inside `as well as she could`). If a word entry already gives the group meaning, do not add that phrase again.
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

### 7.5b `trickyMeaning` senses (familiar word, unfamiliar meaning)

A sense may carry `"trickyMeaning": true`. Use it for a common word that is used here in a meaning learners will not know
(`well` = a water well). An old way a familiar object moved is not this mark when the textbook still names the thing (`telescope` is still a telescope): that is an ordinary Old thing entry, unless the book also uses the modern object, in which case only the old-way places are `senseOnly`. The same mark is for a familiar spelling used as a different job: a person-word used as an action, or an action-word used as a person or a thing (`nurse` in `a nice soft thing to nurse` means to hold a baby or a soft animal; `Coming in a minute, nurse!` is the person and stays plain). The sense needs `anchors`; the usual `chapter` + `occurrence` or `context` rules apply (see 7.5).

```json
"senses": [
  {
    "meaning": "A deep hole in the ground where people get water.",
    "whyHard": "Not the usual meaning! Usually: well means \"in a good way\".",
    "trickyMeaning": true,
    "anchors": [{ "chapter": 0, "occurrence": 2, "context": "falling down a very deep well" }]
  }
]
```

- Where an anchor of such a sense is the one that resolves, the reader marks the word with a wavy accent-colour line and the
  card shows that sense first. It is a different mark from the hard-word underline and the phrase underline, in every theme.
- Only the anchored token is marked. An anchor with `chapter` + `occurrence` marks that one occurrence. An anchor with only a `context`
  marks the first use of the word inside that snippet ("Tap tap tap." marks the first "tap"); the card still opens with the sense on the
  other uses inside the snippet. Other uses of the word are never marked.
- The mark is decided by the boolean only. The reader never reads `whyHard` or `meaning` to find these spots.
- A word with an unmarked use (no anchor lands) stays plain. A missing or non-boolean field means no mark.
- Combine with `"senseOnly": true` for very common words, so the word is not underlined everywhere else.

### 7.6 Writing rules for all help text

- English only. Very common words (the 2000 most common words). Short sentences.
- Only restate the original. Add no new facts, no opinions, no guesses about what happens next.
- Keep names and key plot words unchanged (`Willy Wonka`, `Oompa-Loompa`, `Narnia`), even if they are not common words.
- Do not copy more than a short snippet of the book into any field except `context`.
