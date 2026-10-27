# Daily word-list patrol (for an AI agent)

Read this whole page before you start. It is the job description for an agent that runs once a
day with **only a Cloudflare API token**. You do not need this repository, a site login, a build
or a deploy. Use only Cloudflare HTTPS API calls for remote access; no Node, repository scripts or
site login are required. This task is hosted at [patrol.md](https://inputread.site/kit/patrol.md).
The [maintenance map](https://inputread.site/kit/maintenance.md) owns shared storage, count/version,
publishing and recovery rules; the actionable API/D1 steps for this patrol are below.

## Before each run: reread the sources

Every round, reread this **whole patrol playbook**, the
[maintenance map](https://inputread.site/kit/maintenance.md), and the glossary format/specification
sections used below before reviewing reports or writing. Do not operate from a previous run's
summary, an old copied page or the authoring ZIP. Do not guess a local checkout or specification
path. If a required source is unreadable, stay read-only and report it.

With a checkout, read its actual `docs/GLOSSARY_PATROL.md`, `docs/MAINTENANCE.md` and the required
source specs; record the resolved checkout path, branch/commit and dirty state. Without one, read
the hosted patrol/maintenance URLs above and their specification links afresh; record the actual
URLs and retrieval times. A local checkout is not proof of the deployed instructions or app.
Record SHA-256 of each source's **original bytes** where available. Compare local `.md` and its
hosted `.md` only as comparable raw bytes, never HTML, a summary or reconstructed text. Record
both sources/hashes and equality/mismatch if verified; otherwise explicitly record **unverified**.
A mismatch needs reconciliation of the governing instructions/app version before writes, not an
assumption that either copy is newer. No repository or Node is required to read the hosted sources.
See [documentation authority](https://inputread.site/kit/maintenance.md#ownership).

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
  `span` is `sentence` when it holds a whole sentence (its final full stop need not be selected),
  else `words`: part of one sentence, of any length. `words` is not "a phrase": decide by the text
  (the table below). Older rows labelled a whole sentence without its stop as `words`. Reports that
  overlap on one paragraph share a
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
SELECT book_id, word, chapter, occurrence, catalog_id, book_title, form, chapters, context, sentence,
       glossary_rev, last_tapped_at, tap_count
  FROM book_word_taps WHERE in_glossary = 0 AND status != 'resolved'
  ORDER BY tap_count DESC, last_tapped_at DESC LIMIT 500;

SELECT f.id, f.catalog_id, f.book_title, f.word, f.form, f.reason, f.chapter, f.chapters, f.occurrence,
       f.context, f.sentence, f.sense_index, f.sense_meaning, f.suggestion, f.glossary_rev, f.status,
       u.public_id AS suggested_by
  FROM word_feedback f LEFT JOIN users u ON u.id = f.user_id
 WHERE f.status != 'resolved'
 ORDER BY (f.suggestion != '') DESC, f.created_at DESC LIMIT 500;
```

Open passage reports:

```sql
SELECT p.id, p.topic, p.book_id, p.catalog_id, p.book_title, p.chapter, p.chapters, p.paragraph, p.sel_start, p.sel_end, p.span,
       p.selected, p.before, p.after, p.reason, p.suggestion, p.glossary_rev, p.status, p.created_at,
       u.public_id AS suggested_by
  FROM passage_feedback p LEFT JOIN users u ON u.id = p.user_id
 WHERE p.status != 'resolved'
 ORDER BY p.topic, p.created_at LIMIT 300;
```

`suggested_by` is set only on a report that carries a suggestion: the public id of the reader who
wrote it (12 letters and digits; never an email). Use it for `credit` below.

**Statuses differ by source.** Word feedback can be `pending`, `reopened` or `resolved`;
`reopened` is fresh work after a previous resolution, so prioritize it. Revision strings are not
ordered versions: do not infer "newer" by comparing their hashes. Passage inserts are always
`pending`, not `reopened`; a closed topic means all its reports are `resolved`, not a stored
`closed` status. Later unsuppressed passage reports search for an open overlap or start a new topic.
Missing-word taps do **not** automatically reopen after resolution (see §7). These three lifecycles
must not be treated as one state machine.

**Bounded topic discovery: do not let a deferred first topic starve later work.** The initial
300-report query is only a triage sample, not the work queue or a cursor source. Discover distinct
open topics independently of their report counts:

```sql
-- Passage topic discovery: ?1 = saved discovery_topic_cursor (initially 0).
SELECT DISTINCT topic FROM passage_feedback
 WHERE status != 'resolved' AND topic > ?1
 ORDER BY topic ASC LIMIT 20;
```

Use at most **3 topic-discovery pages per run** (20 topics per page). Walk the returned topics in
order, either reviewing through their cutoff below or explicitly recording why each is deferred.
Advance and persist `discovery_topic_cursor` to the **last considered topic**, even if that topic
was deferred; do not reset it just because no fixes were published. If the 10-book budget or other
run limit stops you partway through a page, save only the last considered topic, not the page's
last returned topic, so unconsidered topics reappear next run. Record pages used, cursor start/end
and deferred topic ids/reasons in the run report; use that record to continue next run. If the
saved record is unavailable, say so and restart at 0 rather than inventing a cursor. An empty page
ends this discovery sweep: save cursor 0 for the **next run**, without wrapping again in this run.
This eventually revisits old deferred topics and any newly open lower-numbered topics, while the
finite page budget prevents endless discovery/polling. Topic discovery never authorizes closure.

**LIMIT 300 is never a complete topic.** The initial report sample may cut one topic in half or
omit others; the distinct-topic pages above avoid that starvation. For each discovered topic you will handle, record a fixed upper id
before editing, then read **all** its reports up to that cutoff with keyset pagination (including
already resolved rows for context):

```sql
-- Passage topic cutoff: ?1 = the discovered topic id. Save cutoff_id for this topic/run.
SELECT MAX(id) AS cutoff_id FROM passage_feedback WHERE topic = ?1;

-- Passage topic page: ?1 = topic, ?2 = last id read (initially 0), ?3 = saved cutoff_id.
SELECT p.id, p.topic, p.book_id, p.catalog_id, p.book_title, p.chapter, p.chapters, p.paragraph,
       p.sel_start, p.sel_end, p.span, p.selected, p.before, p.after, p.reason, p.suggestion,
       p.glossary_rev, p.status, p.created_at, u.public_id AS suggested_by
  FROM passage_feedback p LEFT JOIN users u ON u.id = p.user_id
 WHERE p.topic = ?1 AND p.id > ?2 AND p.id <= ?3
 ORDER BY p.id ASC LIMIT 300;
```

Use the last returned `id` for the next page; continue until an empty page (not just until you
have 300 rows). Save the complete reviewed id list and each row's original association/revision.
If there is no cutoff or any page cannot be read/reviewed, defer the topic. Never widen or refresh
the cutoff during this review to pull in unseen reports. Reports inserted after the cutoff,
including reports joining this same still-open topic, belong to later work; never resolve them
as a side effect of this run. Bounded pagination is required, not unbounded polling.

`book_id` in these rows is the reader's device id and means nothing across devices. Find the book by
**`catalog_id`**, `<catalog>:<id>`: `word-lists:<id>` is the row with that `id` in
`word-lists/catalog.json`, `public-books:<id>` the row in `public-books/catalog.json`. Only when it is
`''` (an older page, a list the reader added by hand, a book installed before this was recorded)
consider a **title fallback only if normalization matches exactly one row across both live
catalogs**, using `normalizeTitle` in `src/lib/book-title.ts` (at most two edition-label passes,
real subtitles retained). Zero matches or ambiguity: leave it pending and report it. A malformed
or unknown **nonempty** reference must never fall back to title; leave it pending too. An empty
reference may also be a custom list: title uniqueness alone does not prove the report concerns the
published list; check context and edition before acting. See
[identity and naming](https://inputread.site/kit/book-upload.md#identity-and-naming).
Two same-title books are told apart by `catalog_id`, not device id. The
catalogs (R2 read, bucket `margin-words-books`):

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
| 2 to 5 words that belong together (`phrase`, or a hard group) | a `phrases` entry (GLOSSARY_FORMAT.md 7.3), key = base form | Only when it is really a fixed phrase (7.3's rule), judged by the words themselves, never by `span`. A single hard word inside it is a word entry instead. A longer group, or words that only make sense with the rest of their sentence, is a sentence note. |
| One sentence, or most of one | a `sentences` note (7.2): `context` copied from that sentence and `simple`; add the one-line `grammar` only when the grammar is the hard part (it is optional) | A figure of speech: say plainly what it means here. |
| Several sentences of one paragraph | a `paragraphs` note (7.1) on that paragraph: `mainIdea` and `simple` | When the reader asked about the whole paragraph (or most of it), or no sentence note would do. |
| `wrong` | fix the phrase, sentence or paragraph note shown there, or remove a wrong phrase match | |

Leave it open when the selection is a single easy word, a name, or text you cannot find in the book.
Never copy more of the book than a note's `context` needs.

**Where readers see each note.** A paragraph note and a sentence note open from the same place:
a lightbulb beside the paragraph. The paragraph panel shows the paragraph note, then a "Hard
sentences" list with every sentence note whose `context` is inside that paragraph. In the word card
a sentence note is only a small "Explain this sentence" link that opens that panel. While the panel
is open, the sentence each note explains is marked in the page like a highlighter: the sentence that
holds the note's `context`. Copy the
`context` exactly from ONE sentence: the bulb needs it inside one paragraph, and the word-card link
needs it inside the tapped sentence. A `context` that is not in the book, or runs across two
paragraphs, lights no bulb and shows nowhere.

**Passage topics: device-local open overlap, not global book identity.**
`functions/api/feedback/passage.ts` searches unresolved reports with the same device `book_id`,
`chapter` and `paragraph`, then joins an overlapping selection's topic. Offsets use half-open
character overlap; without offsets, one selected text must contain the other. This is not a global
cross-device group, not guaranteed to collect every overlapping report, and the lookup currently
does **not** separate `catalog_id`. Do not infer same book, edition or contributor from `topic`.
A device association can change; verify **each report's** catalog reference, edition and context
independently under §3, even inside one topic. Do not apply a report from another catalog to this
book, or let one ambiguous/unmatched row silently inherit another row's identity. Other devices'
reports may be useful separate evidence only after their own identity/context checks.

Read every page through the saved cutoff (§3) before writing. Where those individually verified
reports truly concern the same place (a short selection inside a longer one, or shared words),
review them together:

1. **Find what is really hard.** When most reports point at the same few words (B's "as if the" sits
   inside A's sentence, and C also marked "as if"), the hard part is those words. Several readers
   marking the same small part is a strong signal; one reader marking a big part is a weak one
   for WHERE the difficulty is. It is still a real question about that big part: a whole paragraph
   asked about with an explanation gets its paragraph note (see step 2).
2. **Write the smallest set of notes that answers every report**, never one note per report:
   - The short part is a phrase or an idiom: a `phrases` entry for it. If the longer selection is
     still hard once that phrase is explained, also a `sentences` note for the whole sentence. Its
     `simple` uses the phrase's plain meaning, so the two say the same thing.
   - The short part is only hard because of the sentence around it: one `sentences` note for the
     sentence. It answers B too; do not add a phrase entry that is not a real phrase.
   - Two reports that only share a few words and point at different hard parts: answer each part
     on its own.
   - **A whole-paragraph report together with reports on sentences inside it** (reader A selected
     the paragraph, readers B and C one sentence each): write **both** a `paragraphs` note for the
     paragraph and a `sentences` note for each of those sentences, each credited to its own reader.
     They answer different questions. The paragraph note says what the paragraph is about as a
     whole; a sentence note explains only its sentence. Keep them consistent: the panel shows the
     paragraph note first and the sentence notes under it. "Only when no sentence note would do"
     does not apply when a reader asked about the whole paragraph and gave an explanation.
3. **Explanations:** compare them with each other and with the sentence. Use the sense the best one
   gives, write it in your own words (writing rules below), and credit that reader. The table for
   "a new suggestion when a meaning already exists" below applies here too: a different sense of a
   different part is its own note and its own credit; the same sense said better replaces the text
   and moves the credit.
4. **Decide per reviewed report id, never close by topic.** After verified publication, resolve
   only the ids read through the saved cutoff whose individual questions and book associations
   your notes answer. Mark `accepted` only the reports whose explanation you really used, one
   credit per note. Unanswered, unverified, mismatched and post-cutoff reports stay open. A topic
   is a review aid, not authorization for a bulk UPDATE.

A topic is closed only when all its reports are resolved. A later report that survives duplicate
suppression starts a new `pending` topic if no overlapping unresolved report is found; otherwise
it can join an existing open topic. It never acquires word feedback's `reopened` status. A failed
fix therefore comes back as fresh work, not necessarily the same topic id.

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
 WHERE book_id = ?3 AND word = ?4 AND chapter = ?5 AND occurrence = ?6
   AND catalog_id = ?7 AND glossary_rev = ?8 AND last_tapped_at = ?9
   AND in_glossary = 0 AND status != 'resolved';

UPDATE word_feedback SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE id = ?3;

UPDATE passage_feedback SET status = 'resolved', resolved_at = ?1, resolved_rev = ?2
 WHERE id = ?3 AND topic = ?4 AND id <= ?5 AND status != 'resolved';
```

`?1` = now in milliseconds, `?2` = verified live revision. For **taps**, bind `?3`–`?6` to the
selected row's full primary key (`book_id`, `word`, `chapter`, `occurrence`), `?7` to its **original**
`catalog_id` (keep `''` for a verified legacy fallback), `?8` to its selected `glossary_rev`, and
`?9` to its selected `last_tapped_at`. Save these snapshots when reading §3; do not substitute
the current live revision for `?8`. Execute once per verified location, never a `book_title + word`
batch. Zero changed rows means the row changed or is already resolved: reread and re-evaluate,
not a reason to broaden the WHERE. These guards avoid resolving a new tap or a changed catalog/list
on that device while you worked. Word feedback `?3` is its individually reviewed `id`.
For passage feedback, execute **once per reviewed, answered id**: `?3` = that id, `?4` = its
original topic, `?5` = the saved topic cutoff from §3. Do not use `WHERE topic = ...` as an
alternative UPDATE, even when you believe you answered a whole topic: unseen/new rows can arrive
while you work. Do not construct the id list from a fresh broad query after publishing. Zero changed
rows requires a reread/re-evaluation, not a broader WHERE. Acceptance below also uses only these
individually reviewed ids, after their resolution and credit have been verified.
Word feedback may return as `reopened`; passage feedback instead inserts `pending` and joins an
open overlap or starts a new topic. **Missing-word taps do not currently reopen automatically**:
the tap upsert keeps a resolved status even when its revision/time changes. Do not treat absence from the open-taps query
as proof that a previously resolved word is now covered; investigate repeat reports separately.

For each **accepted** suggestion, also record it (this is what the rank counts):

```sql
UPDATE word_feedback SET accepted_at = ?1, accepted_rev = ?2 WHERE id = ?3 AND suggestion != '';

UPDATE passage_feedback SET accepted_at = ?1, accepted_rev = ?2 WHERE id = ?3 AND suggestion != '';
```

An accepted passage suggestion is credited like a word one: `"credit": "<suggested_by>"` on the phrase
entry, sentence note or paragraph note whose text came from it (GLOSSARY_FORMAT.md 7.1-7.3).

Then, once per run after the last accepted suggestion, refresh the public credit file. Read the
rows with this query and write them as `contributors.json` to bucket `margin-words-books`
(R2 write, `Content-Type: application/json`, `Cache-Control: public, max-age=300`; set and
verify both metadata fields on every refresh):

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
{ "format": 1, "updated": "<now, ISO>", "people": [ { "id": "...", "name": "...", "helped": 3, "avatar": 1792900000 } ],
  "books": { "word-lists:wonder": { "count": 12, "top": ["<id>", "<id>", "<id>"] } } }
```

Leave out `avatar` when it is 0. Write nothing else into the file: no email, no internal id.

**`books` is required.** Discover covers and book details show each book's maintainers from it: a
file written without it removes them from every cover. Build it from this query (the same rule as
`functions/lib/book-maintainers.ts`):

```sql
WITH accepted AS (
  SELECT user_id, catalog_id, book_title,
         'w:' || book_id || ':' || word || ':' || chapter || ':' || occurrence AS place, accepted_at
    FROM word_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
  UNION ALL
  SELECT user_id, catalog_id, book_title,
         'p:' || book_id || ':' || chapter || ':' || paragraph || ':' || selected AS place, accepted_at
    FROM passage_feedback WHERE accepted_at > 0 AND user_id IS NOT NULL
)
SELECT u.public_id AS id, COALESCE(u.nickname, '') AS name, u.avatar_rev AS avatar,
       a.catalog_id AS ref, a.book_title AS title,
       a.place AS place, MIN(a.accepted_at) AS first
  FROM accepted a JOIN users u ON u.id = a.user_id
 WHERE u.public_id IS NOT NULL
 GROUP BY u.id, a.catalog_id, a.book_title, a.place;
```

- The book of a row is its `ref` (`word-lists:<id>` / `public-books:<id>`). A row with `ref` `''` is an
  older report: find its `title` in the two live catalogs (case, spaces and punctuation ignored).
  Normalize using `normalizeTitle` in `src/lib/book-title.ts` (including its edition-label rule).
  Use it only when the title names exactly **one** catalog book; otherwise leave that row out. If
  either catalog cannot be read or parsed, abort the refresh rather than guess or lose credits.
  Ignore malformed nonempty references; do not fall back to title for those.
- Per book, count each reader's distinct non-NULL `place` after resolving the book, even when
  multiple titles or references name it. `count` is how many readers the book
  has; `top` is the public ids of the three with the most help (ties: the earlier `first`, then the
  public id in alphabetical order, so the same data always gives the same faces).
- Every id in a `top` must also be in `people`. When the 500-row `people` query left one out, add
  that reader there with their `name`, `avatar` and total `helped`: the count of distinct
  non-NULL `place` across all their rows, including rows that cannot be matched to a book.
  After merging, keep `people` sorted by total `helped` descending, not by book reference.
  Added readers with equal help are ordered by their earliest acceptance across all rows, then
  public id; preserve the original 500-row query order ahead of added readers with equal help.
  Keep those original 500 rows unchanged. For each added reader, also write `rank`: their global
  position after the original 500, counting **all** remaining readers in that order, including
  readers not selected for any `top`. Its position in the filtered `people` array is not its rank.
For this file too, keep the coordinated window, snapshot bytes/metadata, reread before overwriting
and verify the R2 readback against the query result. If it changed, abort/rebase instead of dropping
another writer's changes. Report a failed credit-file refresh; do not claim the public rank is updated.

## 8. Limits

- At most 10 books per run; reopened word feedback and reported items first (word and passage
  reports), then the most-tapped words. Fully read a passage topic through its saved cutoff before
  deciding; resolve only its individually verified, answered ids. Defer it if review is incomplete.
- D1 is on the Free plan (100,000 row writes a day for the whole site). The queries above read a
  few thousand rows; each resolve writes a few. Use only the bounded topic discovery and finite topic/cutoff pagination in §3;
  do not poll, rerun discovery indefinitely or broaden writes to save queries.
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
or unresolved recovery. Include discovery pages used, start/end topic cursor and deferred topics
for next-run continuation. Include each topic's saved cutoff, reviewed ids, resolved/accepted ids and
unreviewed/deferred rows; do not claim the topic is closed from a partial query. Record the
instruction sources, retrieval times, checkout commit/dirty state when applicable, original-byte
hashes and comparable local/hosted result (or **unverified**). Say so if nothing was open.
