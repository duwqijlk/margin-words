# Daily word-list patrol (for an AI agent)

Read this whole page before you start. It is the job description for an agent that runs once a
day. It also lives in the repository as `docs/GLOSSARY_PATROL.md` and on the site at
`https://inputread.site/kit/patrol.md`.

## 1. The job in one paragraph

Readers of inputread.site tap words they do not know. When the book's word list has no meaning
for that word at that place, the site records it (table `book_word_taps`), and a reader can also
press "Meaning missing" (table `word_feedback`, reason `missing_meaning`). Once a day you collect
these, write a short English meaning for the words that deserve one, publish the patched word
list, and mark the words done. You only **add** words. You never change or delete what a list
already has.

## 2. What you need

- A clone of `https://github.com/duwqijlk/margin-words` and Node 22.12 or newer. Run `npm ci` once.
- A Cloudflare login for the account that owns the site: either `npx wrangler login`, or an API
  token in `CLOUDFLARE_API_TOKEN` with **D1 Edit** and **R2 Edit** on that account. Nothing else.
  You do not need a site admin login, a build, or a deploy.
- Resources you will touch:
  - D1 database `margin-words` (read open items, mark them resolved).
  - R2 bucket `margin-words-books`: `word-lists/<id>/glossary.json`, `word-lists/catalog.json`,
    `public-books/<id>/glossary.json`, `public-books/catalog.json`. This is what readers download.
  - R2 bucket `margin-words-private`: `<id>/book.epub`. **Read only**, to check anchors.

## 3. The daily run

All three steps use `scripts/glossary-patrol.mjs`. Work files go to `local-exports/patrol/`, which
git ignores.

### Step 1. Get the queue (read-only)

```
node scripts/glossary-patrol.mjs queue
```

This reads the open items from D1, matches each to a live book, downloads that book's live
`glossary.json` and its EPUB next to it, and writes `local-exports/patrol/queue.json`:

```
{ "books": [ { "id": "mth14", "kind": "lists", "title": "...", "rev": "1924c8fce8d2",
               "glossary": ".../mth14/glossary.json", "epub": ".../mth14/book.epub",
               "words": [ { "word": "huge", "taps": 4, "reports": [],
                            "places": [ { "chapter": 4, "occurrence": 1, "form": "huge",
                                          "context": "they came to a huge oak.",
                                          "sentence": "They slipped between ... a huge oak." } ] } ] } ],
  "unmatched": [] }
```

Words with a reader report come first, then by number of taps. `chapter` is 0-based and
`occurrence` is 1-based, exactly the numbers a glossary anchor uses.

### Step 2. Decide and write

For each book, copy its `glossary.json` to `patched.json` in the same folder (so the EPUB sits
next to it) and add entries under `"glossary"`. Decide word by word:

| Add a meaning | Skip it (leave it open) |
| --- | --- |
| A word a learner can fairly not know (`huge`, `toward`, `except`, `peeked`) | A very common word tapped by mistake or to hear it (`said`, `top`, `started`) |
| A word reported with "Meaning missing", unless it is clearly a mis-tap | A character or place name (`annie`, `jack`) - names are not glossed |
| A word tapped by several readers | A word you cannot explain without guessing the plot |

Skipped words stay open and come back tomorrow. That is fine. Do not resolve a word you did not add.

Entry rules (full format: `docs/GLOSSARY_FORMAT.md`, writing rules in its section 7.6):

```
"huge": {
  "pos": "adjective",
  "meaning": "Very, very big.",
  "senses": [
    { "meaning": "Very, very big.",
      "anchors": [ { "chapter": 4, "occurrence": 1, "form": "huge", "context": "they came to a huge oak." } ] }
  ]
}
```

- The key is the lemma in lower case. If the book shows another shape (`peeked`), use the shape
  the book uses, or add it to `forms`.
- `meaning`: simple English, one idea, the 2,000 most common words, no Chinese.
- Anchors: copy `chapter`, `occurrence`, `form` and `context` from `places` in the queue. Up to
  three places is enough.
- Add nothing else to the file: no phrases, no notes, no changes to existing entries, no
  reformatting of the rest. Keep `version`, `title`, `chapters`, `sha256` exactly as they are.
- Copyright: only the short `context` (6 to 12 words) may come from the book. Never paste more of
  the book anywhere, never upload or commit the EPUB.

### Step 3. Check, publish, resolve

```
node scripts/glossary-patrol.mjs publish <id> local-exports/patrol/<id>/patched.json
```

Check only. It runs `scripts/validate-glossary.mjs` against the real EPUB (every anchor must be
found), refuses the file if any existing word, phrase, note or header field changed, and prints
the plan: the new words, the new revision, the two files it would upload. Warnings about older
entries can be ignored; errors cannot. Fix and run again until it passes. Then:

```
node scripts/glossary-patrol.mjs publish <id> local-exports/patrol/<id>/patched.json --upload
node scripts/glossary-patrol.mjs resolve <id> --words huge,toward,except --run
```

`--upload` writes the glossary first, then the catalog (only that book's row changes; the script
refuses anything else). `resolve` marks those words' taps and missing-meaning reports resolved at
the new revision. Run `resolve` only for words that are in the uploaded file. Without `--run` it
just prints the SQL.

Readers see the new meanings after they tap **Update** on that book, which the shelf offers once
the catalog revision changes.

## 4. Limits

- At most 10 books and 200 new words per run. Start with the books that have the most reports.
- D1 is on the Free plan (100,000 row writes a day for the whole site). One `queue` reads a few
  thousand rows, one `resolve` writes a few rows. Do not loop queries.
- Never run other SQL that writes (`UPDATE`, `DELETE`, `DROP`) on D1. Never upload other files to
  R2. Never touch `margin-words-private` except to read an EPUB.
- If something fails halfway (the glossary uploaded but the catalog did not), stop and report it.
  Readers keep the old list until the catalog changes, so nothing breaks.

## 5. Report

End each run with a short report: for each book, the words added, the words skipped and why, the
new revision, and any error. If nothing was open, say so.

## 6. What the other reports mean (not your job)

`word_feedback` also has `too_hard` (the meaning is too hard) and `wrong_meaning` (the meaning does
not fit). Fixing those means changing existing entries, which this patrol does not do. Leave them
for a person; mention their count in the report.
