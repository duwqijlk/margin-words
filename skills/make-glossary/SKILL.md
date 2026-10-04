---
name: make-glossary
description: Write a Margin Words word list from one attached EPUB. Covers hard words, senses, paragraph notes, sentence notes, and phrases. Context is copied from the attached file. Use when the only input is the book file and the project scripts are not available.
---

# Make a Margin Words glossary

You write the word list for one English book. The readers are Chinese junior-high students, about grade 7 to 9. They know everyday English. They get stuck when a sentence is old, a joke turns on a sound, or a familiar word is used in a strange way.

The user attaches one EPUB. That file is the only source. A line you remember from another edition is not in this book until you find those words in the file.

## Two jobs

The user says which job. If they do not, and they say the word list already exists, do job A.

**Job A, notes only.** The hard-word list already exists. Do not rewrite it. Return `paragraphs`, `sentences`, `phrases`, and `tricky`.

**Job B, full list.** No list exists yet. Return `glossary` as well as the notes.

Skip the Project Gutenberg license, the title page, and the contents page.

## The copy rule

`context` is 6 to 14 words in a row, copied from one paragraph of the attached file.

- Same words, same order. Do not skip a word. Do not add a word. Do not join two speakers. Do not join two paragraphs.
- Do not put `...` inside `context`.
- Curly quotes and straight quotes are treated as the same later. Still do not change any word.
- Search the attached file for that exact span before you keep the note. If the span is not there, drop the note.

A remembered line is a failed note. This file says `Oh, how I wish I could shut up like a telescope!` A note that says `I must be shutting up like a telescope` is wrong, because those words are not in the file.

If you cannot paste the words from the file, omit the note. Do not invent a sentence and do not say you cannot and then guess.

## What gets a note

A note is only where a student gets stuck even when the words look easy. Ordinary action gets nothing. One scene gets one note. Do not write a paragraph note, a sentence note, and a phrase for the same joke. Pick one box.

- **poem.** A song or rhyming lines. One note for the whole song.
- **shape.** Lines that get shorter, or a poem the speaker treats as a thing with bends.
- **pun.** Two meanings, or two words that sound the same.
- **riddle.** A puzzle question, including one nobody answers. Also a sentence and the same sentence turned around.
- **picture.** `like a ...` when a machine or a tool is a picture of a body. Not `like the wind`.
- **wrong-name.** Someone is called another person's name, often a servant.
- **wrong-kind.** An animal decides a person is a different creature.
- **catchphrase.** A short order said again in the same words. One phrase, not a note every time it appears.
- **break.** An impossible scene becomes an ordinary room.
- **old-grammar.** An old sentence shape, or a mistake the speaker makes on purpose. This is a sentence note.
- **old object.** The only hard part is an unfamiliar name for a thing. This is a phrase or a word, not a paragraph note. If the object is inside a riddle, the riddle is the note.

A chapter with none of these gets no note. Do not fill a quota.

## Which box

| Stuck spot | Box |
| --- | --- |
| The whole paragraph is hard to follow | paragraph note |
| One sentence has a strange shape | sentence note |
| Two or more words work as one unit | phrase |
| A common word is used in an unfamiliar meaning | tricky sense |

## Paragraph note

```json
{
  "chapter": 0,
  "paragraph": 0,
  "context": "six to fourteen words copied from that paragraph",
  "mainIdea": "One or two short sentences.",
  "simple": "The whole paragraph again in very common words.",
  "hardWords": ["a hard word from the original paragraph"]
}
```

`chapter` starts at 0 for the first story chapter. `paragraph` starts at 0 inside that chapter. Count each `p`, `h1`, `h2`, `h3`, `h4`, `li`, and `blockquote` as one paragraph, in order. Skip a block that sits inside another `p`, `li`, or `blockquote`. Skip a block with fewer than 2 English letters. A poem inside one `blockquote` is one paragraph. A heading that is in the chapter is a paragraph too.

`context` is the part that must be right. If you are unsure of the index, still copy the words, and set `paragraph` to the index you counted. Make the snippet long enough that it appears once in the book.

`mainIdea` is 1 or 2 short sentences, at most 400 letters. `simple` retells the whole paragraph in new words, at most 3000 letters. `hardWords` lists at most 20 words or phrases that are actually in that paragraph.

At most one note for the same chapter and paragraph. The first one is the one the reader shows first.

## Sentence note

```json
{
  "chapter": 0,
  "context": "six to fourteen words copied from the sentence",
  "simple": "The sentence in easier English.",
  "grammar": "ONE line: what is special about how the sentence is built."
}
```

`simple` is at most 800 letters. `grammar` is one line, at most 400 letters. One or two sentence notes in a chapter, and only when the shape of the sentence is the problem.

## Phrase

```json
"off with one's head": {
  "meaning": "A short angry order to cut off someone's head.",
  "pos": "idiom",
  "forms": ["off with her head", "off with his head"],
  "example": "Off with her head!"
}
```

The key is the base form: lower case, two or more words, at most 60 letters. `one's` stands for my, your, his, her, its, our, their. `pos` is exactly `phrasal verb`, `idiom`, or `phrase`. Any other value is an error.

`example` is one short sentence copied from the book, at most 400 letters. `forms` lists only shapes the reader cannot build. The reader already knows regular verb endings and about 100 irregular verbs, and it allows a two-word phrasal verb split by up to 3 words. An idiom must be words that sit next to each other.

Write a phrase only when the book uses it.

## Tricky sense

Use this for an everyday word that is hard in one or two places. Without `senseOnly`, the reader underlines every use of that word.

```json
"well": {
  "senseOnly": true,
  "pos": "noun",
  "meaning": "A deep hole in the ground where people get water.",
  "senses": [
    {
      "meaning": "A deep hole in the ground where people get water.",
      "whyHard": "Not the usual meaning! Usually: well means in a good way.",
      "trickyMeaning": true,
      "anchors": [
        { "chapter": 0, "context": "falling down a very deep well" }
      ]
    }
  ]
}
```

The anchor `context` is 6 to 12 words from one paragraph and must contain the word. `whyHard` starts with `Not the usual meaning!` and says the usual meaning. Put `trickyMeaning` only on that sense. In job A, put these entries under `tricky`, not inside a rebuilt glossary.

## Full word list (job B only)

```json
{
  "version": 2,
  "title": "The title from the file",
  "author": "The author from the file",
  "chapters": 12,
  "glossary": {
    "lantern": {
      "pos": "noun",
      "meaning": "A lamp you can carry.",
      "whyHard": "The word is less common than lamp."
    }
  }
}
```

A hard word is one a grade 7 to 9 student may not know, and that matters for the story. Skip the most common English words, names of people and places, and words the book explains. A short story needs about 10 to 40 words. A novel needs about 15 to 30 new words per chapter. Do not repeat a word unless it has a new meaning in this book.

The key is lower case. Use the base form for a noun (`lantern`, not `lanterns`). A verb shape the reader does not reduce (`cried`, `faded`) is its own key, or it goes in `forms` of the base entry. The key is letters, with at most one apostrophe or hyphen inside.

Use `senses` only when this book uses the word in more than one meaning. Give exactly one sense `"default": true`. Put `anchors` on the other senses. One place belongs to only one sense. Do not invent a meaning the book does not use.

`"coined": true` is only for a word the author invented. Start the meaning with `In this story, ...`. Do not use it for a rare real word or a funny spelling.

`pos` for a single word is a short label such as `noun`, `verb`, `past-tense verb`, `adjective`, `adverb`. Phrase `pos` is only the three values above.

`chapters` is how many story chapters you counted, starting at 0. If a reader's copy has a different count, the app ignores `chapter` and uses `context` only. So `context` still has to be right.

## How to write the help

- English only. No Chinese in any field.
- Very common words and short sentences. A meaning is one idea, about 25 words, at most 600 letters.
- Do not explain a word with that word or its forms.
- Only restate the paragraph or the sentence. No new facts, no history of the object, no guess about what happens later.
- Keep names and story words as they are.
- `simple` uses new words. It must not be a copy of the book.
- `context` and `example` are the only fields that quote the book, and only as a short snippet.
- If you are not sure, leave it out.

## Output

Return one JSON object and nothing else. No introduction and no summary.

Job A:

```json
{
  "paragraphs": [],
  "sentences": [],
  "phrases": {},
  "tricky": {}
}
```

Job B: the same object, plus `version`, `title`, `author`, `chapters`, and `glossary`.

## Check every item before you answer

1. The `context` words appear in a row in the attached file.
2. They sit inside one paragraph.
3. There are 6 to 14 words.
4. No word was replaced by a word you remember.
5. `mainIdea`, `simple`, `grammar`, and `meaning` add no fact the text does not say.
6. One scene has one note.

Drop any item that fails.
