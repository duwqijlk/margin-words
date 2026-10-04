---
name: make-glossary
description: Universal instructions for any model that makes a Margin Words word list. Covers the dictionary, hard paragraphs, hard sentences, and phrases. The book text the human provides is the only source. No project scripts and no particular chat product are required.
---

# Make a word list

These instructions are for any model. They do not depend on a tool, a script, a file-upload button, or a particular chat product. Follow them whether you are given a system prompt, a skill file, or a pasted message.

You write a word list for one English book. The readers are about 12 to 15 years old. They know everyday English. A tap on a word shows your meaning. A hard paragraph and a hard sentence can show a short restatement. A phrase shows when the whole phrase is in the sentence.

## What you are given

The human gives you the book in one of these forms. Use the first one that you actually have.

1. **Numbered text.** Chapters are labeled, and paragraphs are already marked `[0]`, `[1]`, `[2]`. Those numbers are the truth. Do not recount them.
2. **The book itself.** An EPUB, or the chapter HTML or plain text. Then you number the book by the rules in this file.
3. **One chapter at a time.** The human may send a single chapter and ask you to finish that chapter only.

The text you were given is the only source. A sentence you remember from this book, or from another edition, does not count until you find those words in the text you were given. If the remembered wording and the given text differ, keep the given text and drop the memory.

Skip a license, a title page, a contents page, and a copyright page. Do not write notes for them.

## What you return

Return one JSON object and nothing else. No introduction and no summary.

The human says which job. If they do not, write the full list.

**Notes only.** A dictionary already exists. Do not rewrite it. Return only the four keys below.

**Full list.** No dictionary exists yet. Return the four keys, and also `version`, `title`, `author`, `chapters`, and `glossary`.

```json
{
  "paragraphs": [],
  "sentences": [],
  "phrases": {},
  "tricky": {}
}
```

`tricky` holds dictionary entries for everyday words that are hard in only one or two places. In a full list, those same entries also belong inside `glossary`.

If the whole book will not fit in one answer, finish one chapter as valid JSON and stop. Do not start a chapter you cannot finish. The human will ask for the next chapter and merge the objects.

## The copy rule

Every `context` is 6 to 14 words in a row, copied from one paragraph of the text you were given.

- Same words, same order. Do not skip a word. Do not add a word.
- Do not join two speakers. Do not join two paragraphs. Do not join two pieces that have other words between them.
- Do not put `...` inside `context`.
- Curly quotes and straight quotes are treated as the same later. Still do not change any word.
- Before you keep an item, find that exact span in the text you were given. If it is not there, drop the item.

A remembered line is a failed note. If the text says `Oh, how I wish I could shut up like a telescope!`, a note that says `I must be shutting up like a telescope` is wrong, because those words are not in the text.

If you cannot copy the words, omit the item. Do not invent a sentence.

`example` on a phrase is one short sentence copied from the book. The same copy rule applies, except that an example may be one whole short sentence.

## How to number the book

Use this only when the human did not already number the paragraphs.

- The first story chapter is chapter `0`. The next is `1`.
- A paragraph is each `p`, `h1`, `h2`, `h3`, `h4`, `li`, and `blockquote`, in order, starting at `0` inside that chapter.
- Skip a block that sits inside another `p`, `li`, or `blockquote`. The outer block is the paragraph.
- Skip a block with fewer than 2 English letters.
- A poem or a quotation inside one `blockquote` is one paragraph.
- A heading that is part of the chapter is a paragraph too.
- `context` is the part that must be right. If you are unsure of a number, still copy the words, and set the number to the index you counted. Make the snippet long enough that it appears once in the book.

For a dictionary anchor, `occurrence` is how many times that exact lower-case spelling has appeared in that chapter so far, starting at 1. `stuck` and `sticks` are counted apart. If you cannot count reliably, omit `occurrence` and keep `context`. An anchor needs `context`, or both `chapter` and `occurrence`. Write all three when you know them.

## Dictionary

A hard word is a word these readers may not know, and that matters for the story. Skip the most common English words, names of people and places, and a word the book explains by itself.

A short story needs about 10 to 40 words. A novel needs about 15 to 30 new words per chapter. Do not enter a word twice unless this book uses it in a new meaning.

```json
"lantern": {
  "pos": "noun",
  "meaning": "A lamp you can carry.",
  "whyHard": "The word is less common than lamp."
}
```

- The key is lower case, letters only, with at most one apostrophe or hyphen inside. At most 48 letters.
- Use the base form for a noun: `lantern`, not `lanterns`.
- A verb shape that is not a simple plural (`cried`, `faded`) is its own key, or it is listed in `forms` of the base entry.
- `meaning` is required. One idea, about 25 words, at most 600 letters. Do not explain a word with that word or its forms.
- `pos` is a short label: `noun`, `verb`, `past-tense verb`, `adjective`, `adverb`, and the same kind of label.
- Explain the word as this book uses it. Do not add a meaning the book does not use.

Use `senses` only when this book uses the word in more than one meaning. Give exactly one sense `"default": true`. Put `anchors` on the other senses. One place belongs to only one sense.

```json
"stuck": {
  "pos": "past-tense verb",
  "meaning": "Joined firmly so that it stays there.",
  "senses": [
    {
      "meaning": "Joined firmly so that it stays there.",
      "default": true,
      "anchors": [
        { "chapter": 2, "occurrence": 1, "context": "their feet stuck and that was that" }
      ]
    },
    {
      "meaning": "Not able to move or to get away.",
      "anchors": [
        { "chapter": 4, "occurrence": 2, "context": "we will never get free we are stuck here" }
      ]
    }
  ]
}
```

`"coined": true` is only for a word the author invented. Start the meaning with `In this story, `. Do not use it for a rare real word or a funny spelling.

`chapters` is how many story chapters you counted. `title` and `author` come from the book you were given.

## Hard paragraphs

Write a paragraph note where the student cannot follow the paragraph even after knowing the words. Ordinary action gets nothing. One scene gets one note.

- **poem.** A song or rhyming lines. One note for the whole song.
- **shape.** Lines that get shorter, or a poem the speaker treats as a thing with bends.
- **pun.** Two meanings, or two words that sound the same, when the joke needs the whole paragraph.
- **riddle.** A puzzle question, including one nobody answers.
- **picture.** `like a ...` when a machine or a tool is a picture of a body. Not `like the wind`.
- **wrong-name.** Someone is called another person's name.
- **wrong-kind.** An animal decides a person is a different creature.
- **break.** An impossible scene becomes an ordinary room.

A chapter with none of these gets no paragraph note. Do not fill a quota. At most one note for the same chapter and paragraph.

```json
{
  "chapter": 0,
  "paragraph": 4,
  "context": "six to fourteen words copied from that paragraph",
  "mainIdea": "One or two short sentences.",
  "simple": "The whole paragraph again in very common words.",
  "hardWords": ["a hard word from the original paragraph"]
}
```

`mainIdea` is 1 or 2 short sentences, at most 400 letters. `simple` retells the whole paragraph in new words, at most 3000 letters. It must not be a copy of the paragraph. `hardWords` lists at most 20 words or phrases that are actually in that paragraph.

## Hard sentences

Write a sentence note when one sentence is hard because of its shape, even if the words are easy.

- An old sentence shape.
- A mistake the speaker makes on purpose.
- A sentence and the same sentence turned around.
- A long sentence whose clauses are hard to hold.

One or two sentence notes in a chapter. Do not also write a paragraph note for the same joke. Pick one box. A turned-around sentence is a sentence note. A whole song is a paragraph note.

```json
{
  "chapter": 0,
  "context": "six to fourteen words copied from the sentence",
  "simple": "The sentence in easier English.",
  "grammar": "ONE line: what is special about how the sentence is built."
}
```

`simple` is at most 800 letters. `grammar` is one line, at most 400 letters. `simple` restates only what that sentence says.

## Phrases

A phrase is two or more words that work as one unit: a phrasal verb, an idiom, a short order said again in the same words, or an old name for a thing. An unfamiliar name for a thing is a phrase, not a paragraph note. If that thing is inside a riddle, the riddle is the note.

Write a phrase only when the book uses it. One scene gets one entry, not a new entry every time the words repeat.

```json
"off with one's head": {
  "meaning": "A short angry order to cut off someone's head.",
  "pos": "idiom",
  "forms": ["off with her head", "off with his head"],
  "example": "Off with her head!"
}
```

The key is the base form: lower case, two or more words, at most 60 letters. `one's` stands for my, your, his, her, its, our, their. `pos` is exactly `phrasal verb`, `idiom`, or `phrase`.

`forms` lists only shapes a reader cannot build from the key. Regular verb endings are already known. An idiom must be words that sit next to each other.

## Everyday words used in a strange way

Use this when a word the student already knows is hard in one or two places (`well` as a water hole, `run` as a road that goes along a river). The entry is marked so the word is not explained on every ordinary use.

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

The anchor `context` contains the word. `whyHard` starts with `Not the usual meaning!` and says the usual meaning. In a notes-only job, put the entry in `tricky`.

## How to write the help

- English only. No other language in any field.
- Very common words and short sentences. A 12-year-old should be able to read the help. Names, numbers, and words from the story may stay as they are.
- Only restate the text you were given. No new facts, no history of an object, no guess about what happens later.
- Keep names as they are.
- `context` and `example` are the only fields that quote the book, and only as a short snippet.
- If you are not sure, leave it out. A short correct list is better than a long list with errors.

## Check every item

1. The `context` words appear in a row in the text you were given.
2. They sit inside one paragraph.
3. There are 6 to 14 words.
4. No word was replaced by a word you remember.
5. `mainIdea`, `simple`, `grammar`, and `meaning` add no fact the text does not say.
6. One scene has one note.
7. The JSON is one object and it parses.

Drop any item that fails.
