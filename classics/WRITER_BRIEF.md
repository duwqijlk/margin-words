# Brief: write a glossary.json for one public-domain book (Margin Words reader)

Project: /workspace/reader (Node). READ FIRST, completely: /workspace/reader/docs/book-pack-spec.md (the full spec).
Also useful: /workspace/reader/docs/GLOSSARY_FORMAT.md (sections 3.4 and 7). Run all scripts from /workspace/reader.
Learners: Chinese junior-high students (CEFR A2-B1). All help text is ENGLISH ONLY, about the 2000 most common words, short sentences.

## You must write the content yourself, by reading the book
No dictionary API, no script that fills meanings automatically. Use scripts only to find words and numbers:
  node scripts/extract-epub-text.mjs <epub> --out <workdir> --numbered     (chapter text with [paragraph] numbers)
  node scripts/extract-epub-text.mjs <epub> --candidates 400               (candidate hard words)
  node scripts/extract-epub-text.mjs <epub> --find WORD                    (chapter, paragraph, occurrence)
  node scripts/extract-epub-text.mjs <epub> --paragraph-search "words"
  node scripts/validate-glossary.mjs <epub> <glossary.json>                (must say OK, 0 errors)
  node scripts/check-definition-words.mjs --fail <glossary.json>           (meanings in common words)
  npm run check:cjk                                                        (no Chinese characters anywhere)
Chapter numbers are the reader's 0-based chapter list (front matter such as Titlepage/Imprint counts as chapters 0,1,2...). Use the tool numbers, never guess.

## What to produce (version 2 file; title, author, sha256, chapters, level, language set)
- glossary: hard words (key = lower-case base form; verbs the app can't reduce, like "gazed", go in forms or as key). Use `senses` + `anchors` only when the word truly has 2+ meanings in the book. Each anchor needs chapter, occurrence, context (6-12 words copied exactly).
- paragraphs: ParagraphNote = chapter, paragraph, context (6-14 exact words), mainIdea (1-2 short sentences), simple (WHOLE paragraph restated in very common words), hardWords (from the ORIGINAL paragraph).
- sentences: SentenceNote = chapter, context (6-14 exact words), simple, grammar (ONE line, accurate and specific: name the real structure).
- phrases: map keyed by base form (2+ words, lower case). pos is phrasal verb | idiom | phrase. forms only for forms the app cannot derive. example = short EXACT book snippet (about 4-12 words, copied exactly, containing the phrase).
- coined: true ONLY if the author invented the word (a real old/rare word, dialect, funny spelling, or a proper name is NOT coined). If unsure, leave it out. Meaning starts "In this story, ...".
Also include old-fashioned/archaic words and dialect words that block understanding (explain them as used in the book).

## Writing rules (learned from earlier reviews: these were the common mistakes)
1. Only restate the original. No new facts, no guesses, no background, no later plot. Never change a color, object, number, name, who-did-what, or a quote. Never drop an important detail (e.g. "perfectly well", "foolish") or add one. Two short facts may sit outside the sentence: a size in centimetres or litres, and how a familiar object used to move when the comparison needs that motion (Old thing in the spec). Do not add who made it, the year, or any other history.
2. `simple` restates the WHOLE paragraph, in new words, not copied. Keep names and key story words.
3. Do not explain a word with itself or its forms. A basic word used in a special way: define that use in basic words. Each meaning: one idea, at most ~25 words.
4. Explain the word as used IN THIS BOOK only. Write the sense this sentence needs, the way a learner dictionary does: one everyday idea, and the card should let a 12-year-old say what the word does there. A meaning taken from one line stays on those lines. Do not put it on the base key, and list a form only when that spelling has the same meaning. A past shape that is another word, and a piece a hyphen splits off, are marked only at those places. A group whose textbook meanings stop the sentence is one phrase (`at last`, `hold your tongue`, `a narrow escape`, `never mind`, `this minute` for right now). Search again for the same neighbouring words and anchor every place of that sense. A helper word can change job: `does` in `It does the boots and shoes` means the fish cleans the shoes. Mark only those places. When a speaker uses a word because it sounds like another word, the card names that other word (`Mystery` is history, `A knot!` is hearing `not`, `axes` sounds like `axis`). A paragraph note does not replace the card. A line about one use stays off the base key when another use is a different job (`murdering the time`, `dipped suddenly down`).
5. Grammar lines: name the actual structure (e.g. "'Had she not been...' means 'If she had not been...'"), never vague like "complex sentence" or "passive idea" unless it truly is.
6. Choose words that matter for understanding; skip the 2000 most common words, people/place names, words the book explains itself. Do not repeat a word unless it has a new meaning.
7. If unsure, leave it out. A short correct list beats a long one with errors.
8. Do not quote the book beyond short snippets (context/example only).
9. This is public domain text but still never put long book text in any field except the required short contexts.

## Size targets
(see your book-specific note below). Cover EVERY real story chapter spread evenly (skip Titlepage/Imprint/Colophon/Uncopyright/Epigraph-type pages unless they have story text).

## Process (do all of it)
1. Work chapter by chapter; write pieces to files in your workdir, merge into one JSON with a small script (merge is fine; content is yours).
2. Validate; fix every error; read the warnings (title warning for Standard Ebooks titles is fine).
3. SELF-REVIEW PASS (important, earlier drafts always needed it): re-read EVERY paragraph `simple`/`mainIdea` against the original paragraph (use --numbered text) and fix any wrong or missing detail; re-check every grammar line, every phrase example is an exact snippet, every meaning fits the book, and coined flags are only for truly invented words. Re-validate after fixes.
4. Make the pack: node scripts/make-pack.mjs <book.epub> <glossary.json> <out.pack.zip>. Then list the zip to confirm exactly book.epub + glossary.json.
5. Put final files in /workspace/classics/<id>/ : book.epub (already there, do not modify), glossary.json, <id>.pack.zip. Do not edit any file under /workspace/reader (read-only for you) and do not touch other books' folders.
6. Report back: path, counts (glossary words, senses words, paragraph notes, sentence notes, phrases, coined), validator result, check-definition-words result, number of fixes made in self-review, and any doubts.
