# Daily word-list patrol (for an AI agent)

Read this whole page before you start. It is the job description for an agent that runs once a
day with **only a Cloudflare API token**. You do not need this repository, a site login, a build
or a deploy: every step below is one HTTPS call to `api.cloudflare.com`. The page is also in the
repository as `docs/GLOSSARY_PATROL.md` and on the site at `https://inputread.site/kit/patrol.md`.

## 1. The job

Readers of inputread.site read English books with a word list (glossary) that explains hard
words. Two things tell you a list needs work:

- **Taps** (table `book_word_taps`): a reader opened a word that has **no meaning of its own** at
  that place. Only such words are recorded.
- **Reports** (table `word_feedback`), sent with the card's feedback button:
  - `missing_meaning`: the word has no meaning here.
  - `suggested`: the reader wrote their own meaning without saying what was wrong with the one
    shown. Treat it as "this place may need a better or different meaning" and judge it the same
    way as a `wrong_meaning` that carries a suggestion.
  - `too_hard`: the meaning uses words that are too hard for a learner.
  - `wrong_meaning`: the meaning, or a phrase match, does not fit this place in the book.
  - Any report may carry `suggestion`: the reader's own meaning for this place (plain text, at most
    200 characters, English or Chinese). Readers often look the word up while reading, so this is
    usually the quickest way to the right sense. Review it; never paste it in unchecked.

Once a day you read the open items, fix the word lists, publish them, and mark the items done.
You may **add** entries and **fix** existing ones: rewrite a meaning that is too hard, correct one
that is wrong, add or move an anchor, add a sense, and remove a wrong phrase match. Example: in
The Wonderful Wizard of Oz the phrase "even to" was matched in "want to kill anybody, even to see
Aunt Em", where the words are not that phrase. The fix was to remove that phrase match.

## 2. Access

- `Authorization: Bearer <token>` on every call. The token needs, on this account, **D1 Edit**
  and **Workers R2 Storage Edit**. Never print the token, put it in a file, or send it anywhere
  but `api.cloudflare.com`.
- `API = https://api.cloudflare.com/client/v4/accounts/6ece9f6dbbc73db1be2810fb39f277c3`
- D1 database `margin-words`, id `c286e644-2ead-438c-bb65-70ee028d957a`.
- R2 buckets:
  - `margin-words-books`: what readers download. You read and write here.
  - `margin-words-private`: copyrighted EPUBs. **Read only**, to check anchors.

The three calls you use:

```
D1 query   POST {API}/d1/database/c286e644-2ead-438c-bb65-70ee028d957a/query
           body {"sql": "...", "params": [...]}      rows in result[0].results
R2 read    GET  {API}/r2/buckets/<bucket>/objects/<key, URL-encoded>
R2 write   PUT  {API}/r2/buckets/<bucket>/objects/<key, URL-encoded>
           body = the exact file bytes, header Content-Type: application/json
```

Always use `params` for values in SQL. Never build SQL by pasting text into it.

## 3. Find the work (read only)

Open taps and reports:

```sql
SELECT book_title, word, form, chapter, occurrence, context, sentence, glossary_rev, tap_count
  FROM book_word_taps WHERE in_glossary = 0 AND status != 'resolved'
  ORDER BY tap_count DESC, last_tapped_at DESC LIMIT 500;

SELECT f.id, f.book_title, f.word, f.form, f.reason, f.chapter, f.occurrence, f.context,
       f.sentence, f.sense_index, f.sense_meaning, f.suggestion, f.glossary_rev, f.status,
       u.public_id AS suggested_by
  FROM word_feedback f LEFT JOIN users u ON u.id = f.user_id
 WHERE f.status != 'resolved'
 ORDER BY (f.suggestion != '') DESC, f.created_at DESC LIMIT 500;
```

`suggested_by` is set only on a report that carries a suggestion: the public id of the reader who
wrote it (12 letters and digits; never an email). Use it for `credit` below.

`status` is `pending`, or `reopened` when a reader reported the same place again after it was
resolved. A reopened item means the last fix did not work: look at it first.

`book_id` in these rows is the reader's device id, not the catalog id. Find the book by **title**
in the live catalogs (R2 read, bucket `margin-words-books`):

- `word-lists/catalog.json`: `{ "lists": [ { "id", "title", "words", "phrases", "paragraphs",
  "sentences", "updated", "glossary": { "url", "bytes", "sha256" }, ... } ] }`
- `public-books/catalog.json`: `{ "packs": [ { "id", "title", "rev", ..., "glossary": { "url",
  "bytes", "sha256", "rev" } } ] }`

The book's list is `word-lists/<id>/glossary.json` or `public-books/<id>/glossary.json`. Its
**revision** is the first 12 hex digits of `glossary.sha256`. A row whose `glossary_rev` is not the
current revision was made on an older list: check whether the current list already fixed it.

## 4. Fix the list

Download the live `glossary.json` and the book (`margin-words-private`, key `<id>/book.epub`; for
a public-domain book, `margin-words-books`, key `public-books/<id>/book.epub`). Use the book only
to read the place the reader saw.

The format is `docs/GLOSSARY_FORMAT.md` (online:
`https://github.com/duwqijlk/margin-words/blob/main/docs/GLOSSARY_FORMAT.md`). The parts you need:

```
"glossary": {
  "huge": {
    "pos": "adjective",
    "meaning": "Very, very big.",
    "senses": [
      { "meaning": "Very, very big.",
        "anchors": [ { "chapter": 4, "occurrence": 1, "form": "huge", "context": "they came to a huge oak." } ] }
    ]
  }
}
```

- The key is the lemma in lower case. A shape the book uses (`peeked`) can be its own key or go
  in `forms`.
- An anchor is a place: `chapter` (0-based), `occurrence` (1-based count of that word form in the
  chapter), `form`, and `context` (6 to 12 words copied exactly from the book). Copy them from
  the tap or report row: they use the same numbers.
- `senseOnly: true` entries apply only at their anchors. Phrases live in `"phrases"`, keyed by the
  phrase, with their own `forms` and `anchors`.

What to do with each kind of item:

| Item | Usual fix | Leave it open |
| --- | --- | --- |
| Tap or `missing_meaning` | Add the entry, or add this place as an anchor to an existing sense | Very common words tapped to hear them (`said`, `top`); character and place names (`annie`) |
| `too_hard` | Rewrite `meaning` (and `here`) in easier words, same sense | The meaning is already as easy as it can be |
| `wrong_meaning` | Point the anchor at the right sense, add a sense, or remove the wrong phrase match / anchor | You cannot tell the right meaning without guessing the plot |

Reviewing a reader's `suggestion`:

- **Accept the sense, rewrite the words.** If the suggestion names the sense that fits the
  sentence, write the entry in your own simple English (rules below). Do not copy it word for
  word: it may be copied from a dictionary, and it may be Chinese, which a word list must not hold.
- **Reject** it when it does not fit the sentence, guesses at the plot, is a joke, spam, a link,
  or anything other than a meaning. Then fix the item as if no suggestion was given, or leave it
  open.
- Several readers suggesting the same sense for one place is a strong signal. One reader alone
  is a hint, not proof: check it against the sentence.
- Never put a reader's text, name, or anything personal into the word list or your report beyond
  "accepted" / "rejected" and why.
- **You fill in the rest.** A reader sends only a meaning. Every entry and new sense you write must
  also have `pos` (part of speech) for the word **as it appears in this sentence** (`drifted` ->
  `past-tense verb`, `lanterns` -> `plural noun`). Use the labels the app knows, listed in
  `docs/book-pack-spec.md` section 4.1 (online:
  `https://github.com/duwqijlk/margin-words/blob/main/docs/book-pack-spec.md`). Also add the anchor
  from the report, and `whyHard` when a short reason helps. Never ask the reader for these.
- **Credit an accepted suggestion.** On the sense (or entry) whose meaning came from it, add
  `"credit": "<suggested_by>"`. The card then shows "From <their nickname>" with their picture. Use
  only `suggested_by`; never write a name or email. One credit per sense.

When a place already has a meaning, possibly one credited to an earlier reader (A), and a new
suggestion arrives from reader B, compare B's with the meaning shown **at this place** and choose one:

| B's suggestion | What to do | Credit | Mark B's report |
| --- | --- | --- | --- |
| A **different sense** that fits this sentence (A's fits other places) | Add a new sense with an anchor for this place; leave A's sense as it is | New sense: B | resolved + accepted |
| The **same sense, said clearly better** (simpler, closer to this sentence, or A's was wrong) | Rewrite that sense's `meaning` | Switch the sense's `credit` to B | resolved + accepted |
| The same sense, **not better** | Change nothing | Keep A | resolved, **not** accepted |
| Does not fit the sentence | Change nothing | Keep A | resolved, not accepted |

- A's past help still counts: the rank counts accepted reports, not the credits shown now, so A
  keeps their place after B improves the sense.
- Several suggestions for one place in the same run: read them together, write one meaning, and
  credit the earliest reader whose sense you essentially used. Mark the others resolved; mark one
  accepted only when you really took their sense.
- Repeated `wrong_meaning` or `too_hard` reports on a credited sense (status `reopened`) mean the
  sense still does not work: fix it first, by the same table.

Writing rules (GLOSSARY_FORMAT.md 7.6): English only, the 2,000 most common words, short, one
idea; restate, never add facts or guess the plot; keep names. Change **only** what an item asks
for. Do not reformat the file, reorder keys, or touch unrelated entries, and keep `version`,
`title`, `chapters`, `sha256`, `spine` and `segmentation` as they are.

Copyright: only a short `context` may come from the book. Never put more of the book anywhere,
never upload the EPUB anywhere, never include book text in your report beyond a context.

## 5. Check before you publish

The file must parse as JSON, and every anchor you added or changed must point at a real place:
in that chapter (split as GLOSSARY_FORMAT.md section 3 describes), the `occurrence`-th time the
`form` appears must be inside the `context` text. If you cannot confirm a place, leave it out.
Compare with the live file: every change must be one you meant to make for an item. If you can
run Node and have the repository, `node scripts/validate-glossary.mjs book.epub glossary.json`
does this check fully; it is optional.

## 6. Publish (two R2 writes, in this order)

1. Write the new `glossary.json` bytes to its key. Compute `sha256` of exactly those bytes.
2. Read the catalog again (just before writing), change **only this book's row**, write it back:
   - word list: `words` = number of keys in `glossary` (or the file's `count` if set), `phrases`,
     `paragraphs`, `sentences` = their counts; `glossary.bytes`, `glossary.sha256`; set
     `previousUpdated` to the old `updated` when the hash changed; `updated` = now (ISO time);
     top-level `updated` = now.
   - public book: the same, plus `rev` and `glossary.rev` = first 12 digits of the new sha256.
   Keep every other row, field and order exactly. The catalog is JSON with one-space indent and a
   newline at the end.

If the catalog write fails, stop and report: readers keep the old list until the catalog points
at the new one, so nothing breaks. Readers get the new list when they tap **Update** on the book.

## 7. Mark items done

Only for items your published change fixes, with the **new** revision:

```sql
UPDATE book_word_taps SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE book_title = ?3 AND word = ?4 AND in_glossary = 0 AND status != 'resolved';

UPDATE word_feedback SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE id = ?3;
```

`?1` = now in milliseconds, `?2` = new revision. If a reader reports the same place again on the
new revision, the site reopens the item by itself.

For each **accepted** suggestion, also record it (this is what the rank counts):

```sql
UPDATE word_feedback SET accepted_at = ?1, accepted_rev = ?2 WHERE id = ?3 AND suggestion != '';
```

Then, once per run after the last accepted suggestion, refresh the public credit file. Read the
rows with this query and write them as `contributors.json` to bucket `margin-words-books`
(R2 write, `Content-Type: application/json`):

```sql
SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
       COUNT(DISTINCT f.book_id || ':' || f.word || ':' || f.chapter || ':' || f.occurrence) AS helped
  FROM word_feedback f JOIN users u ON u.id = f.user_id
 WHERE f.accepted_at > 0 AND u.public_id IS NOT NULL
 GROUP BY u.id ORDER BY helped DESC, MIN(f.accepted_at) ASC LIMIT 500;
```

```
{ "format": 1, "updated": "<now, ISO>", "people": [ { "id": "...", "name": "...", "helped": 3, "avatar": 1792900000 } ] }
```

Leave out `avatar` when it is 0. Write nothing else into the file: no email, no internal id.

## 8. Limits

- At most 10 books per run; reopened and reported items first, then the most-tapped words.
- D1 is on the Free plan (100,000 row writes a day for the whole site). The queries above read a
  few thousand rows; each resolve writes a few. Do not loop queries.
- No other SQL that writes. No `DELETE`, `DROP` or `ALTER`. No R2 writes except a glossary, its
  catalog, and `contributors.json`. Never write to `margin-words-private`, and never touch
  `avatars/`.
- Skipped items stay open and come back the next day. That is fine.

## 9. Report

End each run with a short report per book: what you added, what you changed and why (the
item that asked for it), which reader suggestions you accepted or rejected and why, what you
skipped and why, the new revision, and any error. Say so if
nothing was open.
