---
name: annotate-book-glossary
description: Build a Margin Words word list (glossary format v2) for an EPUB book. Extracts the chapter text with the app's own numbering, picks hard words for a chosen reading level, writes context-based meanings (senses) with chapter/occurrence/context anchors, validates the JSON against the book, and tells the user how to upload it on the shelf. Use when the user wants a custom glossary, word list, or per-chapter word meanings for an English book.
---

# Annotate a book with a v2 glossary

You make a word list for **one EPUB book** for the Margin Words reader. The reader shows a
meaning when the learner taps a word. The same word can mean different things in different
places, so you write **senses** and tie each one to places in the book (**anchors**).

Spec: `docs/GLOSSARY_FORMAT.md` · Schema: `docs/glossary.schema.json` · Example: `docs/glossary.example.json`.
Run all commands in the reader project folder (run `npm install` there once).
Short all-in-one spec for any AI agent: `docs/book-pack-spec.md` (shipped in `book-pack-kit.zip`). Worked example: `examples/sample-book/`.

## Parameters (ask the user; use the default if they do not care)

| Parameter | Default | Meaning |
| --- | --- | --- |
| `epub` | (required) | Path to the book file. |
| `target_level` | First year of Chinese junior high (about 12) | Reader's level. Use the tests in `skills/make-glossary/SKILL.md`. Do not use "skip the 2000 most common words" as the line. |
| `definition_language` | English | Language of `meaning`. The app is English-only, so prefer simple English. If the user wants another language, write it, but tell the user the app shows a small notice. |
| `definition_style` | Short, one idea, words below the target level | How to write meanings. |
| `max_words` | 200 | How many entries at most. |
| `output` | `<book>.glossary.json` | Where to save the file. |

## Steps

### 1. Get the book text, numbered like the app

```
node scripts/extract-epub-text.mjs book.epub                    # list chapters (0-based), word counts, sha256, title
node scripts/extract-epub-text.mjs book.epub --out work/text    # work/text/ch000.txt, ch001.txt ... + book.json
```

The tool runs the app's own EPUB code, so **chapter numbers match the app**. Do not count
chapters yourself from the EPUB files. Note `title`, `author`, `sha256` and the number of
chapters from the summary.

### 2. Choose the hard words

- Read the chapters (or sample them if the book is long). Optionally get frequent candidates the app would
  pick: `node scripts/extract-epub-text.mjs book.epub --candidates 300`.
- Keep a word when any test in `skills/make-glossary/SKILL.md` is yes (wrong twin, old thing, old label, or not the school meaning). If you are not sure they know it, keep it. Skip names, a textbook word used in the textbook meaning, and words the book itself explains. A word that appears once, including inside a letter or a label, still counts. `max_words` is only a safety stop for a huge book, not a reason to drop `hearthrug` or `struck`.
- Use **lower-case** entries. The key is the word as the reader can tap it: nouns in the singular
  (`monkey`, the app maps `monkeys` to it), but a verb form that is not mapped by plural rules is its own key
  (`cried`, `shrinks` -> `shrink` only when it ends in a plural-like -s: check with `--find`). For other
  shapes, list them in `"forms"`. The key must be letters only (an apostrophe or hyphen inside is allowed).

### 3. Find where each word is used

For each chosen word:

```
node scripts/extract-epub-text.mjs book.epub --find stuck
```

It prints every use: `chapter N, occurrence M: ...text around the word...`. These numbers are exactly
what an anchor needs. `--json` gives the same as data.

- If the word means the **same thing everywhere**: write only `pos`, `meaning`, `whyHard`. No senses needed.
- If it has **two or more meanings in this book** (for example `sight` = "something you see" vs. "catch sight of" vs.
  "out of sight"), write one **sense** per meaning, with anchors at the places where that meaning is used.
  Read the sentence around each use before you decide. Do not invent senses a learner will not meet in this book.

### 4. Write the JSON (format v2)

```json
{
  "version": 2,
  "title": "<from step 1>", "author": "<from step 1>", "sha256": "<from step 1>",
  "chapters": 29,
  "level": "CEFR B1, simple English meanings",
  "glossary": {
    "stuck": {
      "pos": "past-tense verb",
      "meaning": "Joined firmly to something, with glue or a pin, so that it stays there.",
      "whyHard": "This word has more than one meaning.",
      "senses": [
        { "pos": "past-tense verb", "meaning": "Joined firmly to something, with glue or a pin, so that it stays there.",
          "default": true,
          "anchors": [ { "chapter": 14, "occurrence": 1, "context": "The moment they landed on a branch, their feet stuck and that was that" } ] },
        { "pos": "adjective", "meaning": "Not able to move or to get away.",
          "anchors": [ { "chapter": 28, "occurrence": 2, "context": "Now we’ll never get free! We’re stuck here for ever!" } ] }
      ]
    }
  }
}
```

Rules to follow:

- Only `meaning` is required (on the entry, or on each sense). `pos`, `whyHard`, `forms`, `default` are optional.
- **`context` is the most important part.** Copy 6 to 12 words **exactly** from one paragraph (they may
  contain curly quotes). It must contain the word. The app and the validator ignore the difference between curly and
  straight quotes, spaces and capitals. Do not paraphrase. Do not cross a paragraph break.
- `chapter` and `occurrence` come **only** from `--find` output (never from guessing). `occurrence` counts the
  exact spelling (`stuck` is counted apart from `sticks`); if the entry key is not the spelling in the book, add
  `"form": "<spelling>"` to the anchor. Always give `chapter`, `occurrence` **and** `context` together.
- Anchor each sense in the places you read, not every place. Mark the most common meaning `"default": true`
  so the places you did not anchor still get a sensible meaning.
- One place may point to only one sense. At most one `default` per word.
- Meanings: write at or below `target_level`, in `definition_language`, one idea, up to about 25 words,
  and do not use the word itself to explain it. Explain how the word is used **in this book**.
- Add `"chapters": <count from step 1>` so a different edition of the book falls back to `context` only.

### 5. Validate (do not skip)

```
node scripts/validate-glossary.mjs book.epub book.glossary.json
```

Exit code 0 means every chapter, occurrence and context was found in the book. If it prints problems, fix each one
(the message names the word and the anchor) and run it again until it says `OK`. If an occurrence is wrong, run
`--find` again. If a context is not found, copy it again from the text. Do not delete an anchor just to get a pass
unless the sense really has no clear place in the book. Warnings are not errors but read them.

### 5b. Optional: paragraphs, sentences, phrases, coined words

Add these only when the user asks for paragraph help, sentence help, phrases or invented words. They are optional top-level
parts of the same file (spec: `docs/GLOSSARY_FORMAT.md` section 7). Files without them stay valid.

**Get the numbers from the tool, never by guessing.**

```
node scripts/extract-epub-text.mjs book.epub --paragraphs 3            # chapter 3, every paragraph as [0] [1] [2] ...
node scripts/extract-epub-text.mjs book.epub --paragraph-search "words from the text"   # chapter + paragraph that hold them
```

The `paragraph` index is 0-based, counted as the reader counts it (the chapter heading is paragraph 0 when it is in the chapter).

**`paragraphs`** (help for hard, important paragraphs; for example 1 in 10, not all):

```json
{ "chapter": 1, "paragraph": 2, "context": "6 to 14 words copied exactly from that paragraph",
  "mainIdea": "One or two short sentences.", "simple": "The whole paragraph in very common words.",
  "hardWords": ["hard word or phrase from the ORIGINAL paragraph"] }
```

**`sentences`** (one tricky sentence each): `{ "chapter": 11, "context": "6 to 14 words copied exactly from the sentence", "simple": "...", "grammar": "ONE line: the tricky grammar and what it means." }`

**`phrases`** (phrasal verbs and idioms that appear in the book): key = base form in lower case, `{ "meaning": "...", "pos": "phrasal verb" | "idiom" | "phrase", "forms": ["gave up"], "example": "a sentence from the book" }`.
Write only phrases the book really uses. The reader knows simple forms (gave, giving, gives) and phrasal verbs split by up to 3 words, so you only list odd forms.

**Coined words**: add `"coined": true` to the entry of a word the **author invented** (`snozzcumber`). Not for real rare words or funny spellings.

**Writing rules** (all of these fields):

- English only. Use very common words (the 2000 most common words; `src/lib/basic-words-data.ts`). Short sentences.
- Only restate the original. Add no new facts, no opinions, no guesses. Do not explain more than the text says.
- Keep names and key plot words unchanged (`Willy Wonka`, `Oompa-Loompa`), even when they are not common words.
- `context` must be copied exactly (quotes, dashes, capitals and spaces do not matter). It must sit inside ONE paragraph, and for a paragraph note inside the paragraph with that number.
- Do not put more than a short snippet of the book in any field except `context`.

The validator (step 5) checks that every `context` is in the right paragraph or chapter (errors), and that `simple`, `mainIdea`,
`grammar` and phrase `meaning` use only common words (warnings that name the words: rewrite those parts with easier words, or leave a name or key word as it is).

### 6. Hand it to the user

Tell the user (plain words):

1. Make the pack: `node scripts/make-pack.mjs book.epub book.glossary.json my-book.pack.zip` (one `.zip` with exactly
   `book.epub` + `glossary.json`; the script checks that the list belongs to the book). The app cannot add a bare EPUB.
2. Open Margin Words, tap **Add book**, then **Choose .zip file** (or drop the zip on the shelf). A book already on the
   shelf: open the book's menu (the three dots) and tap **Add word list** to add only the `.json`.
3. The app checks the pack again and says in plain words what is wrong, if anything. If you add a list to a book that has
   words, you choose **Add only new words** or **Replace**.
4. Open the book and tap a word that has several meanings: the card shows the meaning that fits that place, and a
   small "Other meanings in this book" list shows the rest.

Also tell the user how many words, how many have several meanings, and which `target_level` you used. The format
is in `docs/book-pack-spec.md` (also inside `book-pack-kit.zip`).

## Quality checklist

- [ ] JSON is valid; `version` is 2; `validate-glossary.mjs` with the EPUB says OK.
- [ ] Every multi-sense word has real, different meanings seen in the book, and a `default`.
- [ ] No meaning uses a word harder than `target_level`.
- [ ] No copied book passages longer than a short context snippet in any field.
- [ ] If you added paragraphs, sentences or phrases: the validator says OK with the EPUB, and its word warnings are fixed or are only names or key words.
- [ ] `coined: true` only on words the author invented.
- [ ] Title/author match the book; `chapters` and `sha256` come from the tool, not from memory.
