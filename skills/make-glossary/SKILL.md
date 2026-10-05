---
name: make-glossary
description: Any model can follow this. The human gives one EPUB. You return one glossary.json in the Margin Words format, with the dictionary, hard paragraphs, hard sentences, and phrases.
---

# Make a glossary.json from one EPUB

These instructions are for any model. They do not depend on a tool, a script, or a particular chat product.

The human gives you one EPUB of one English book. You read that file and return one `glossary.json`. That file is the word list the Margin Words reader loads. It holds the dictionary, the hard-paragraph notes, the hard-sentence notes, and the phrases.

If you cannot read the words inside the EPUB, stop. Say that you cannot read the file. Do not write the list from memory.

## Readers

The readers are in the first year of Chinese junior high. They are about 12. They can read a school sentence (`she`, `said`, `little`, `head`, `foot`, `house`, `door`). They do not know old things in a house, old titles, or a verb that looks like another verb. A tap on a word shows your meaning. A hard paragraph and a hard sentence show a short restatement. A phrase shows when the whole phrase is in the sentence.

The right level for a meaning is the plainness of a sentence that student can already read. `A small animal that flies at night. It looks like a mouse with wings.` is easy enough. So is `Cutting off someone's head as a punishment.` School words are fine: `frightened`, `reply`, `oven`, `meal`, `flowers`, `guilty`, `manners`. Do not make a meaning shorter or vaguer to avoid them.

A list of the 2000 most common words is the wrong line for two different jobs. It is too high for choosing which words to mark: `struck` is common on that list, and these readers still think it might mean `stuck`. It is too low for judging a meaning: a warning from that list is not a reason to rewrite a clear meaning. `fly` and `wings` are ordinary. So are animals, the body, food, clothes, the house, and simple actions.

A meaning is too hard only when the explaining words are harder than the idea: an old word used to explain a common one, or a grammar-class word in a note the student reads (`participle`, `clause`, `conditional`). Say what the line is doing, in plain words. Do not name the grammar category.

## The file you return

Return one JSON object and nothing else. No introduction and no summary. This is the whole file:

```json
{
  "version": 2,
  "title": "The title from the EPUB",
  "author": "The author from the EPUB",
  "chapters": 12,
  "level": "Chinese junior-high (CEFR A2-B1). Simple English meanings.",
  "language": "English",
  "glossary": {},
  "paragraphs": [],
  "sentences": [],
  "phrases": {}
}
```

`version` is `2`. `title` and `author` come from the EPUB. `chapters` is how many story chapters you counted. `glossary` is the dictionary and must not be empty. `paragraphs`, `sentences`, and `phrases` are part of the same file. Do not invent any other top-level key.

Skip a license, a title page, a contents page, and a copyright page. Do not write notes for them.

If the whole book will not fit in one answer, return one chapter as valid JSON in this same shape, with only that chapter's words and notes, and stop. The human will ask for the next chapter. Each chapter file uses the same keys, so the pieces can be merged into one `glossary.json`.

## Read the EPUB

An EPUB is a zip of HTML. Open it. Read the spine and the table of contents. The text inside this file is the only source. A sentence you remember does not count until you find those words in this EPUB. If your memory and the file differ, keep the file.

Number the book as you read:

- The first story chapter is chapter `0`. The next is `1`.
- A paragraph is each `p`, `h1`, `h2`, `h3`, `h4`, `li`, and `blockquote`, in order, starting at `0` inside that chapter.
- Skip a block that sits inside another `p`, `li`, or `blockquote`. The outer block is the paragraph.
- Skip a block with fewer than 2 English letters.
- A poem or a quotation inside one `blockquote` is one paragraph.
- A heading that is part of the chapter is a paragraph too.

`context` is the part that must be right. If a reader's copy of the book splits the chapters differently, the app keeps the note only when `context` is found. Make each snippet long enough that it appears once.

## The copy rule

Every `context` is 6 to 14 words in a row, copied from one paragraph of this EPUB.

- Same words, same order. Do not skip a word. Do not add a word.
- Do not join two speakers. Do not join two paragraphs. Do not join two pieces that have other words between them.
- Do not put `...` inside `context`.
- Curly quotes and straight quotes are treated as the same later. Still do not change any word.
- Before you keep an item, find that exact span in the EPUB. If it is not there, drop the item.

A remembered line is a failed note. If this EPUB says `Oh, how I wish I could shut up like a telescope!`, a note that says `I must be shutting up like a telescope` is wrong, because those words are not in the file.

If you cannot copy the words, omit the item. Do not invent a sentence.

`example` on a phrase is one short sentence copied from the book. The same rule applies, except that an example may be one whole short sentence.

For a dictionary anchor, `occurrence` is how many times that exact lower-case spelling has appeared in that chapter so far, starting at 1. `stuck` and `sticks` are counted apart. If you cannot count reliably, omit `occurrence` and keep `context`. An anchor needs `context`, or both `chapter` and `occurrence`. Write all three when you know them.

## Dictionary (`glossary`)

Mark a word when any test below is yes. There is no maximum and no per-chapter quota. A cap of 15 or 30 words is why a real hard word gets left out. Do not enter a word twice unless this book uses it in a new meaning.

1. **Wrong twin.** The spelling looks like a word they know, or they would guess the wrong meaning. `struck` in `her head struck against the roof` means hit. It does not mean stuck. The meaning says both.
2. **Old thing.** A thing, a tool, clothes, a room, food, or a job that a school book does not teach, even once. `hearthrug` is the rug in front of the fire. `fender` here is the metal guard in front of the fire. `carrier` is the person who takes parcels. A measure they cannot picture is this test too: say the size in centimetres or litres. One inch is about 2.5 centimetres. A gallon is about four and a half litres. That size is the one fact that is not in the story. Do not add history. The same test covers a familiar object when this sentence uses an old way that object used to move or fit together. The textbook still names the thing, so test 4 does not fire by itself. `telescope` in `Oh, how I wish I could shut up like a telescope!` is still a tube you look through. In that book the tube is made of parts that slide in, slowly, to become shorter, and slide out to become longer. A telescope now changes the picture with a lens, so it does not fold. `shut up` in a textbook means be quiet. Be quiet, plus a modern tube, does not give "I wish I could become small by folding in." Put that one fact in the object's meaning: parts that slide shorter or longer. Do not add who made it, the year, or a history of the tool. `opening out like the largest telescope` is the same tube pulled longer. Mark the object as an ordinary entry when every use in this book is that old way. When the book also names the modern object, mark only the old-way places (`senseOnly`). The closing words are a phrase, not a second history: see Phrases.
3. **Old label.** A title or a short form they have not met. `Esq.` after a name.
4. **Not the school meaning.** A familiar spelling, used here for something else. Before you leave any familiar word out, put the meaning a first-year textbook gives that spelling into this sentence. If the textbook gives two meanings, try each one. When the sentence still reports the same event, leave the word out. When the sentence stops reporting that event, mark only the places that use the other meaning (`senseOnly`, and `trickyMeaning` on that sense). Start `whyHard` with `Not the usual meaning!` and say the textbook meaning. `puzzle` in `that's the great puzzle` is a hard question; a textbook puzzle is a picture cut into pieces. `shedding` in `shedding gallons of tears` is the verb "to let something fall"; a textbook shed is a small building. `scale` in `On every golden scale` is one hard plate on the crocodile; a textbook scale is a tool for weighing, or how big something is. Also notice the job the word is doing. A textbook may teach that spelling only as a person, only as a thing, or only as one action. A person-word used as an action, or an action-word used as a person or a thing, fails this test. `nurse` in a first-year book is a person who looks after sick people. `she is such a nice soft thing to nurse` and `you may nurse it a bit` mean to hold a baby or a soft animal in your arms. Mark only those places. `Coming in a minute, nurse!` is calling that person, so the textbook meaning still fits and that place stays plain. A familiar object used for an old way it moved stays in test 2. `telescope` is still a telescope. The school name fits the thing. The missing piece is the old motion, not a second meaning of the spelling.
5. **Unclear name.** A person's name a first-year reader may try to translate as an ordinary word. `Ada` and `Mabel` are girls Alice knows. The meaning says only that it is a name, and who it is if this sentence says so. Skip a name the sentence already calls a name. Skip a place name used as a label.

If you are not sure they know the word, mark it. A missing mark is the mistake. An extra mark on a real hard word is fine. `coast` in `on the English coast` is the land beside the sea. A first-year book often has `sea` and not `coast`. The textbook meaning still fits this sentence, so it is an ordinary entry, not `senseOnly`.

Leave a word out only after its textbook meaning still fits this sentence (`she`, `said`, `little`, `head`, `foot`, `roof`, `door`). Leave it out when the same sentence explains it in plain words. A word already named in a paragraph note's `hardWords` still needs its own dictionary entry, unless that sentence explains it. The note does not stand in for the entry.

A word inside a letter, a label, or lines that are not a numbered paragraph is still a dictionary word. The reader can tap it there. `Hearthrug` and `Fender` in the address to Alice's foot are this case.

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
- `pos` is a short label such as `noun`, `singular noun`, `verb`, `base verb`, `past-tense verb`, `adjective`, or `adverb`.
- Explain the word as this book uses it. Do not add a meaning the book does not use.

Use `senses` only when this book uses the word in more than one meaning. Give exactly one sense `"default": true`. Put `anchors` on the senses. One place belongs to only one sense.

```json
"stuck": {
  "pos": "past-tense verb",
  "meaning": "Joined firmly so that it stays there.",
  "whyHard": "This word has more than one meaning.",
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

An everyday word that is hard in only one or two places goes in `glossary` too. Mark it so the reader does not explain it on every ordinary use.

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

The anchor `context` contains the word. `whyHard` starts with `Not the usual meaning!` and says the usual meaning.

`"coined": true` is only for a word the author invented. Start the meaning with `In this story, `. Do not use it for a rare real word or a funny spelling.

## Hard paragraphs (`paragraphs`)

Write a paragraph note where the student cannot follow the paragraph even after knowing the words. Ordinary action gets nothing. One scene gets one note. A paragraph note does not replace the dictionary: every word in `hardWords` is still an entry, unless the same sentence explains it.

Also write a note when the paragraph sets up a letter, a label, or an address, including when those lines are not themselves a numbered paragraph. `And how odd the directions will look!` is that setup: she is picturing the address on a present to her own foot. Do not write a paragraph note whose only hard part is one word (`struck`). That word is a dictionary entry.

- **poem.** A song or rhyming lines. One note for the whole song.
- **shape.** Lines that get shorter, or a poem the speaker treats as a thing with bends.
- **pun.** Two meanings, or two words that sound the same, when the joke needs the whole paragraph.
- **riddle.** A puzzle question, including one nobody answers.
- **picture.** `like a ...` when a machine or a tool is a picture of a body. Not `like the wind`. When the picture uses an old way that machine moved, the machine word is still an Old thing entry. The note does not replace it.
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

## Hard sentences (`sentences`)

Write a sentence note when one sentence is hard because of its shape, even if the words are easy.

- An old sentence shape.
- A mistake the speaker makes on purpose.
- A sentence and the same sentence turned around.
- A long sentence whose clauses are hard to hold.

One or two sentence notes in a chapter. Do not also write a paragraph note for the same joke. Pick one. A turned-around sentence is a sentence note. A whole song is a paragraph note.

```json
{
  "chapter": 0,
  "context": "six to fourteen words copied from the sentence",
  "simple": "The sentence in easier English.",
  "grammar": "ONE line: what is special about how the sentence is built."
}
```

`simple` is at most 800 letters. `grammar` is one line, at most 400 letters. `simple` restates only what that sentence says.

## Phrases (`phrases`)

A phrase is two or more words that work as one unit: a phrasal verb, an idiom, a short order said again in the same words, or an old name for a thing. It is not slang. Slang is a word a small group uses instead of the ordinary word. A phrase here is ordinary textbook words whose joined meaning the textbook does not teach. An unfamiliar name for a thing is a phrase, not a paragraph note. If that thing is inside a riddle, the riddle is the note.

Before you leave a group of neighbouring words out, put the textbook meaning of each word into the sentence, in order. When the sentence still reports the same event, leave the group out. When the sentence stops reporting that event, write one phrase for the whole unit. Do not shorten the key to a piece that is ordinary in other sentences.

- `Come up again, dear!` is "move to a higher place." The people above the hole are calling her back up. Leave `come up` out.
- `next to no toys` is not "beside no toys." `next to no` means almost none. The key is `next to no`, so `next to the door` stays plain.
- `made up my mind` is not "built my mind in a higher place." `make up one's mind` means to decide. The key keeps `one's mind`, so `made up the story` stays plain.
- `had come to the general conclusion` is not a move toward an ending, and it is not "what everyone already knows." `come to a conclusion` means to decide after thinking. `general` means that decision covers many places, not only one. The key is `come to a conclusion`. When the book puts an extra word inside, list that shape in `forms` (`come to the general conclusion`), so `come to the door` stays plain. Do not define the noun `conclusion` with the words `come to`.
- `she soon made out that` is not "she made something outside." `make out` means to manage to see, hear, or understand.
- `shut up like a telescope` is not "be quiet, like a telescope." `shut up` here means to close by sliding shorter. The object entry (Old thing) says the tube is made of parts that slide. A phrase that only says "become smaller," and leaves `telescope` as a modern tube, still fails. Write the phrase for that comparison. When this book also uses `shut up` to mean be quiet, keep the long key `shut up like a telescope`, so the quiet places stay plain. A book whose only `shut up` is this motion may use the key `shut up`. `opening out like the largest telescope` is not this phrase; the object entry covers it. A paragraph note does not replace either one.

Write a phrase only when the book uses it. One scene gets one entry, not a new entry every time the words repeat. Leave out a group the same sentence explains in plain words. Do not write a short key that also sits inside a longer ordinary group: `as well` sits inside `as well as she could`, and there `well` still means "in a good way." Write the longer idiom (`might as well`) or leave the short group out. If a word entry already gives the meaning of the group (`a good deal` on `deal`, `in spite of` on `spite`), do not add a second phrase for those same words.

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

## How to write the help

- English only. No other language in any field.
- Short sentences a junior-high student can read. School words and ordinary words are fine. Names, numbers, and words from the story may stay as they are. Do not rewrite a clear meaning because a frequency list does not contain one of its words. In a sentence note, do not use a grammar-class word (`participle`, `clause`, `conditional`). Say what the line is doing.
- Write the meaning the way a learner dictionary does. Longman is the model: one everyday idea, the sense this sentence uses, in ordinary words. If that dictionary gives two senses, use the one this sentence needs. Do not invent a picture it does not say. `respectable` in `one respectable person` is good enough, or big enough, to count as a real one. It is not "fit to be seen by other people." `left` in `enough of me left` is remaining: the part that is still here. Say what remains. "Still there" alone sounds like a place.
- Only restate this EPUB. No new facts, no history of an object, no guess about what happens later. Two short facts may sit outside the sentence, and only these: a size they cannot picture, in centimetres or litres; and, for Old thing, how a familiar object used to move or fit together when the comparison needs that motion. Do not add who made it, the year, or any other history.
- Keep names as they are.
- `context` and `example` are the only fields that quote the book, and only as a short snippet.
- If you are not sure a line is in the EPUB, or you cannot copy its `context`, leave that item out. A short correct list is better than a long list with errors. This rule is not for "maybe they know this word." When you are not sure they know it, mark it.

## Check every item

1. You read the words in the EPUB. You did not write from memory.
2. The `context` words appear in a row in this EPUB, inside one paragraph, and there are 6 to 14 of them.
3. No word was replaced by a word you remember.
4. `mainIdea`, `simple`, `grammar`, and `meaning` add no fact the text does not say, except a size in centimetres or litres, or that one Old thing fact about how the object used to move.
5. One scene has one note.
6. The JSON has `version`, `glossary`, `paragraphs`, `sentences`, and `phrases`, and it parses.

Drop any item that fails.
