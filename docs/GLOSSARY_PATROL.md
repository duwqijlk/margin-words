# Daily word-list patrol (for an AI agent)

Read this whole page before you start. It is the job description for an agent that runs once a
day with **only a Cloudflare API token**. You do not need this repository, a site login, a build
or a deploy. Use only Cloudflare HTTPS API calls for remote access; no Node, repository scripts or
site login are required. This task is hosted at [patrol.md](https://inputread.site/kit/patrol.md).
The [maintenance map](https://inputread.site/kit/maintenance.md) owns shared storage, count/version,
publishing and recovery rules; the actionable API/D1 steps for this patrol are below.

## 1. The job

Readers of inputread.site read English books with a word list (glossary) that explains hard
words. Three things tell you a list needs work:

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
- **Passage reports** (table `passage_feedback`): a reader selected a few words, a sentence or a
  short part of one paragraph and asked for help with it. `selected` is the exact text (at most
  600 characters, never across paragraphs); `before` / `after` are a few words around it;
  `chapter` and `paragraph` are the reader's own numbers in their copy of the book (see
  "Chapter numbers" below); `sel_start` / `sel_end` are its character offsets in that paragraph;
  `span` is `sentence` when it holds a whole sentence. Reports that overlap on one paragraph share a
  `topic` (see "Passage topics" below). `reason`:
  - `hard`: "I don't understand this part".
  - `phrase`: "these words go together" (often a phrasal verb or an idiom the list does not have).
  - `wrong`: the help shown at this place is wrong.
  - `suggested`: only the reader's explanation, in `suggestion` (plain text, at most 600
    characters: room to say what a sentence means and why).

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

**Before any R2 write**, coordinate an exclusive window with **all writers**, including admin
publishers, other patrols and CLI/API agents. Direct Cloudflare R2 calls bypass the admin routes'
cooperative D1 catalog lock; this task does **not** grant SQL lock acquisition or lock-table edits.
Snapshot exact bytes and metadata of each affected object (including absence), reread immediately
before publishing, and abort/rebase if anything changed. Keep the window through write verification.
If you cannot coordinate it, remain read-only and report. Details:
[publishing](https://inputread.site/kit/maintenance.md#publishing) and
[recovery](https://inputread.site/kit/maintenance.md#recovery).

## 3. Find the work (read only)

Open taps and reports:

```sql
SELECT book_title, word, form, chapter, chapters, occurrence, context, sentence, glossary_rev, tap_count
  FROM book_word_taps WHERE in_glossary = 0 AND status != 'resolved'
  ORDER BY tap_count DESC, last_tapped_at DESC LIMIT 500;

SELECT f.id, f.book_title, f.word, f.form, f.reason, f.chapter, f.chapters, f.occurrence,
       f.context, f.sentence, f.sense_index, f.sense_meaning, f.suggestion, f.glossary_rev, f.status,
       u.public_id AS suggested_by
  FROM word_feedback f LEFT JOIN users u ON u.id = f.user_id
 WHERE f.status != 'resolved'
 ORDER BY (f.suggestion != '') DESC, f.created_at DESC LIMIT 500;
```

Open passage reports:

```sql
SELECT p.id, p.topic, p.book_title, p.chapter, p.chapters, p.paragraph, p.sel_start, p.sel_end, p.span,
       p.selected, p.before, p.after, p.reason, p.suggestion, p.glossary_rev, p.status, p.created_at,
       u.public_id AS suggested_by
  FROM passage_feedback p LEFT JOIN users u ON u.id = p.user_id
 WHERE p.status != 'resolved'
 ORDER BY p.topic, p.created_at LIMIT 300;
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

**Chapter numbers.** Readers import their own copy of the book, so a reported `chapter` is an index
in **that** edition, not in the list's edition. Each row also carries `chapters`: how many chapters
the reporting reader's copy has (`0` from an older page that did not send it). Compare it with the
list's own `chapters`:

- Same number (or `0`): the chapter number is normally the same as the list's, and
  `chapter` + `occurrence` / `paragraph` locate the place.
- Different number: the editions are split differently, often because of front matter, so the
  chapter number may be off by a fixed amount. Do **not** trust it. Locate the place by the row's
  `context` (and, for a passage, `paragraph` and `before` + `selected` + `after`) in the book, and
  write the chapter that actually contains that text. A paragraph note's `paragraph` is also the
  reader's edition's id: the `context` decides, the id only breaks ties.

## 4. Fix the list

Download the live `glossary.json` and the book (`margin-words-private`, key `<id>/book.epub`; for
a public-domain book, `margin-words-books`, key `public-books/<id>/book.epub`). Retain the glossary
and catalog's original exact bytes and metadata as the base snapshots **before editing** (§2).
Use the book only to read the place the reader saw.

The [glossary format](https://github.com/duwqijlk/margin-words/blob/main/docs/GLOSSARY_FORMAT.md)
is the entry schema. The parts you need:

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
  chapter), `form`, and `context` (6 to 12 words copied exactly from the book). `occurrence` and
  `context` come from the row; the chapter is the one in the **list's** edition that holds that
  text (see "Chapter numbers"). When the row's `chapters` differs from the list's, count the
  occurrence in the list's chapter, not in the reader's.
- `senseOnly: true` entries apply only at their anchors. Phrases live in `"phrases"`, keyed by the
  phrase, with their own `forms` and `anchors`.

What to do with each kind of item:

| Item | Usual fix | Leave it open |
| --- | --- | --- |
| Tap or `missing_meaning` | Add the entry, or add this place as an anchor to an existing sense | Very common words tapped to hear them (`said`, `top`); character and place names (`annie`) |
| `too_hard` | Rewrite `meaning` (and `here`) in easier words, same sense | The meaning is already as easy as it can be |
| `wrong_meaning` | Point the anchor at the right sense, add a sense, or remove the wrong phrase match / anchor | You cannot tell the right meaning without guessing the plot |

What to do with a passage report. Find the place by its text: one paragraph of the book must
contain `before` + `selected` + `after` (spaces may differ). `chapter` and `paragraph` narrow the
search only while the row's `chapters` matches the list's (see "Chapter numbers"); the text decides.
Then write the smallest note that helps:

| The selection is | Write | Notes |
| --- | --- | --- |
| 2 to 5 words that belong together (`phrase`, or a hard group) | a `phrases` entry (GLOSSARY_FORMAT.md 7.3), key = base form | Only when it is really a phrase (7.3's rule). A single hard word inside it is a word entry instead. |
| One sentence, or most of one | a `sentences` note (7.2): `context` copied from that sentence and `simple`; add the one-line `grammar` only when the grammar is the hard part (it is optional) | A figure of speech: say plainly what it means here. |
| Several sentences of one paragraph | a `paragraphs` note (7.1) on that paragraph: `mainIdea` and `simple` | Only when no sentence note would do. |
| `wrong` | fix the phrase, sentence or paragraph note shown there, or remove a wrong phrase match | |

Leave it open when the selection is a single easy word, a name, or text you cannot find in the book.
Never copy more of the book than a note's `context` needs.

**Passage topics: one place, several readers.** All reports with the same `topic` overlap on one
paragraph: a short selection inside a longer one (reader A selected the whole 10-word sentence,
reader B only "as if the" inside it), or two that share words. Read the whole topic before you write:

1. **Find what is really hard.** When most reports point at the same few words (B's "as if the" sits
   inside A's sentence, and C also marked "as if"), the hard part is those words. Several readers
   marking the same small part is a strong signal; one reader marking a big part is a weak one.
2. **Write the smallest set of notes that answers every report**, never one note per report:
   - The short part is a phrase or an idiom: a `phrases` entry for it. If the longer selection is
     still hard once that phrase is explained, also a `sentences` note for the whole sentence. Its
     `simple` uses the phrase's plain meaning, so the two say the same thing.
   - The short part is only hard because of the sentence around it: one `sentences` note for the
     sentence. It answers B too; do not add a phrase entry that is not a real phrase.
   - Two reports that only share a few words and point at different hard parts: answer each part
     on its own.
3. **Explanations:** compare them with each other and with the sentence. Use the sense the best one
   gives, write it in your own words (writing rules below), and credit that reader. The table for
   "a new suggestion when a meaning already exists" below applies here too: a different sense of a
   different part is its own note and its own credit; the same sense said better replaces the text
   and moves the credit.
4. **Mark the whole topic.** Resolve every report in the topic that your notes answer. Mark
   `accepted` only the reports whose explanation you really used, one credit per note. A report you
   could not answer stays open (it keeps its topic).

A topic is closed once all its reports are resolved. A new report on that place later starts a new
topic, so a fix that did not work comes back as fresh work.

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
  [book-pack specification §4.1](https://github.com/duwqijlk/margin-words/blob/main/docs/book-pack-spec.md).
  Also add the anchor
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
Compare with the live snapshot: every change must be one you meant to make for an item. Confirm
these checks from the downloaded bytes; this API-token-only task does not require Node or a
repository checkout. If you cannot verify an anchor, leave that item open.

A malformed entry no longer hides the rest of the list: the reader drops that one entry or note and
shows the others, and a list with no readable word entry still fails to load. So a bad note does
not lock readers out, but it also fails silently — the note you wrote simply never appears. Keep
the shape exact: a sentence note needs `context` and `simple` (`grammar` is optional, ONE line), a
paragraph note needs `context`, `mainIdea` and `simple`, and an entry's fields are the ones
GLOSSARY_FORMAT.md lists.

**Every suggestion you will mark accepted must have its credit in the file.** Before you publish,
go through each report you plan to mark `accepted` in step 7 and find, in the new file, the entry or
sense that now holds that meaning. It must carry `"credit": "<suggested_by>"` of that report:

- An entry with no `senses`: `credit` sits on the entry itself, next to its `meaning`.
- An entry with `senses`: `credit` sits on the sense whose anchor is this report's place
  (same `chapter`, `occurrence` and `form`), not on the entry.
- A phrase: `credit` sits on the phrase entry.
- A passage report answered by a sentence note or a paragraph note: `credit` sits on that note
  (`sentences[i].credit`, `paragraphs[i].credit`). The help panel shows "From <nickname>" there.
- `credit` is a **field** inside that entry or sense. It is never a key of `glossary` or `phrases`:
  a top-level `"credit": { ... }` is a word entry for the word "credit", not a credit. If you find one
  you did not mean to add as a word, remove it.

A reader sees "From <their nickname>" on the card only from this field. Recording `accepted_at` in D1
alone counts them in the rank but shows nothing on the card. If you cannot place a credit, do not mark
that report accepted. List in your report each accepted id with the word and where its credit is.

## 6. Publish (two R2 writes, in this order)

Keep §2's coordinated exclusive window. Follow the
[shared count/version rules](https://inputread.site/kit/maintenance.md#versions):

1. Retain §4's pre-edit snapshots of the glossary and catalog's exact bytes and metadata.
   Immediately before the first write, reread both via the R2 API and compare with those snapshots.
   If either changed, **abort and rebase** the edits on fresh snapshots, repeating §5. Compute
   SHA-256 of the exact new glossary bytes.
2. Write those `glossary.json` bytes to its key. Then reread the catalog, confirming it still matches
   the snapshot. If it changed, stop for recovery below; do not overwrite it with the old candidate.
   Otherwise change **only this book's row** and write it back:
   - `words` = `Number(file.count) || Object.keys(file.glossary).length`, matching the admin
     publisher. Check it is correct for the edited list; update a stale explicit `count` if your
     edits change the word total. `phrases` = keys in its object, `paragraphs` / `sentences` = array
     lengths (0 when absent); `glossary.bytes` and `glossary.sha256` come from the exact written bytes.
   - Set `previousUpdated` to the old `updated` only when an existing glossary hash changes;
     otherwise preserve it. Set row `updated` and top-level `updated` to now (ISO time).
   - Public book: also set `rev` and `glossary.rev` to the first 12 hex digits of the new SHA-256.
   Keep every other row, field and order exactly. Use one-space JSON indent and a final newline.
3. **Verify before §7:** GET the glossary and catalog back through the authenticated R2 API.
   Compare exact bytes and metadata with the intended writes, recompute the glossary byte length
   and SHA-256, check counts/revisions and all preserved rows/fields, and confirm each intended fix
   and accepted suggestion's credit is present. A PUT success is not enough.

If a write or verification fails, **do not mark anything accepted or resolved**. Stop and report,
using [recovery](https://inputread.site/kit/maintenance.md#recovery) under the exclusive window.
Replacing `glossary.json` before the catalog can leave a hash mismatch if the catalog write fails;
readers may be unable to download or update. This is not a transaction or automatic rollback.
After verified publication and catalog refresh, readers can request **Update**; their device copy
is not silently replaced.

## 7. Mark items done

Only after §6's R2 readback verifies the fix (and credit for an accepted suggestion), mark items
that the verified live list answers, with its **verified revision**. If the current list already
fixed an older report, verify that live list and catalog in the same way before resolving it;
there is no need to rewrite identical bytes.

```sql
UPDATE book_word_taps SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE book_title = ?3 AND word = ?4 AND in_glossary = 0 AND status != 'resolved';

UPDATE word_feedback SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE id = ?3;

UPDATE passage_feedback SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE id = ?3;   -- or, for a topic you answered whole: WHERE topic = ?3 AND status != 'resolved'
```

`?1` = now in milliseconds, `?2` = new revision. If a reader reports the same place again on the
new revision, the site reopens the item by itself.

For each **accepted** suggestion, also record it (this is what the rank counts):

```sql
UPDATE word_feedback SET accepted_at = ?1, accepted_rev = ?2 WHERE id = ?3 AND suggestion != '';

UPDATE passage_feedback SET accepted_at = ?1, accepted_rev = ?2 WHERE id = ?3 AND suggestion != '';
```

An accepted passage suggestion is credited like a word one: `"credit": "<suggested_by>"` on the phrase
entry, sentence note or paragraph note whose text came from it (GLOSSARY_FORMAT.md 7.1-7.3).

Then, once per run after the last accepted suggestion, refresh the public credit file. Read the
rows with this query and write them as `contributors.json` to bucket `margin-words-books`
(R2 write, `Content-Type: application/json`):

```sql
WITH accepted AS (
  SELECT user_id, 'w:' || book_id || ':' || word || ':' || chapter || ':' || occurrence AS place, accepted_at
    FROM word_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
  UNION ALL
  SELECT user_id, 'p:' || book_id || ':' || chapter || ':' || paragraph || ':' || selected AS place, accepted_at
    FROM passage_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
)
SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
       COUNT(DISTINCT a.place) AS helped
  FROM accepted a JOIN users u ON u.id = a.user_id
 WHERE u.public_id IS NOT NULL
 GROUP BY u.id ORDER BY helped DESC, MIN(a.accepted_at) ASC LIMIT 500;
```

(This is the same query the site uses in `functions/lib/contributors.ts`.)

```
{ "format": 1, "updated": "<now, ISO>", "people": [ { "id": "...", "name": "...", "helped": 3, "avatar": 1792900000 } ] }
```

Leave out `avatar` when it is 0. Write nothing else into the file: no email, no internal id.
For this file too, keep the coordinated window, snapshot bytes/metadata, reread before overwriting
and verify the R2 readback against the query result. If it changed, abort/rebase instead of dropping
another writer's changes. Report a failed credit-file refresh; do not claim the public rank is updated.

## 8. Limits

- At most 10 books per run; reopened and reported items first (word and passage reports), then the
  most-tapped words. Answer a passage topic whole or leave it for the next run.
- D1 is on the Free plan (100,000 row writes a day for the whole site). The queries above read a
  few thousand rows; each resolve writes a few. Do not loop queries.
- No other SQL that writes. No `DELETE`, `DROP` or `ALTER`. No R2 writes except a glossary, its
  catalog, and `contributors.json`. Never write to `margin-words-private`, and never touch
  `avatars/`.
- Skipped items stay open and come back the next day. That is fine.

## 9. Report

End each run with a short report per book: what you added, what you changed and why (the
item that asked for it), which reader suggestions you accepted or rejected and why (for each accepted
one: report id, word or passage, and the entry, sense or note that holds its `credit`), each passage
topic you answered (its id, the reports in it, and the notes you wrote for it), what you
skipped and why, the verified revision, the R2 verification/credit-file refresh result, and any error
or unresolved recovery. Say so if nothing was open.
