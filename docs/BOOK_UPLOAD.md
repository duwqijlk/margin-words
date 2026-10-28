# Uploading a book, a word list, or a series (for an AI agent)

Read this whole page before you start. It is the job description for an agent that puts a book on
inputread.site, replaces the word list (词典) of a book that is already there, or moves books into a
series, with **wrangler** and a Cloudflare login. It targets the same live files as the admin
page's **Books** and **Series** tabs, but **not the same safety mechanism**: direct R2 writes bypass
the admin routes' cooperative D1 catalog lock. Follow the checkpoints in §3 before any write.
You do not need a site login, a build or a deploy. This page is hosted at
[book-upload.md](https://inputread.site/kit/book-upload.md).

**The one sentence to remember:** upload the book's files first, then change only its row in the
live catalog and upload the catalog last. The [maintenance map](https://inputread.site/kit/maintenance.md#storage)
owns storage/source-of-truth rules: live R2 lists are not rebuilt from git; no book commits or PRs.

Use this page for **one book at a time**. To fix readers' reports in a live list, follow
[the patrol task](https://inputread.site/kit/patrol.md) instead.

## Before each run: reload the instructions and record their source

Reread this whole upload playbook, the [maintenance map](https://inputread.site/kit/maintenance.md),
and the glossary format/specification sections needed for the job **on every run**, before deciding
or writing. A previous run's notes, a summary, an old copied playbook or the authoring ZIP is not
an operations source. Do not infer a local path from a machine name, title or a previous session.

- With a checkout: read the actual `docs/BOOK_UPLOAD.md`, `docs/MAINTENANCE.md` and relevant source
  specifications in that checkout; record its resolved path, branch/commit and dirty state. A commit
  alone does not identify uncommitted document edits. These are local instructions, not proof of
  what `/kit/` or the production app currently serves.
- Without a checkout: read the hosted upload and maintenance URLs linked above and follow their
  specification links. Record each actual URL and retrieval time. If a required source cannot be
  read, stop before writes and report the missing source; do not substitute the ZIP or guess a path.
- Record the SHA-256 of each source's **original bytes** when available. Only compare hashes of
  comparable raw Markdown bytes (local `.md` versus the corresponding hosted `.md`, or the same
  pinned raw specification), never rendered HTML, a summary, or parsed/reserialized text. Record
  local/hosted byte equality or mismatch only after that comparison; otherwise say **unverified**,
  not "current" or "in sync". Record both sources/hashes for a mismatch and stop to reconcile which
  instructions/app version govern this job before publishing. This runbook's presence in a checkout
  is not evidence that its safety fixes have been deployed. See
  [documentation authority](https://inputread.site/kit/maintenance.md#ownership).

## 0. Words this page uses

| Term | What it means |
| --- | --- |
| **book** | One title a reader can add. It has files and one catalog row. |
| **word list** (词典) | The `glossary.json` file: the words, meanings and help for one book. [Glossary format](https://github.com/duwqijlk/margin-words/blob/main/docs/GLOSSARY_FORMAT.md). |
| **catalog** | A JSON file that lists books. Discover reads only this, never a folder. |
| **row** | One book's object inside a catalog: id, title, author, counts, series, cover address. |
| **id** | A stable catalog row id, not a title or device id. New ids use lower-case hyphenated names; existing ids stay unchanged. See [identity and naming](#identity-and-naming). |
| **kind** | `lists` = a copyrighted book (trusted readers only). `public` = a public-domain book (everyone). |
| **category** | `"speech"` for a talk, address or lecture; nothing at all for a novel. Picks the Discover tab and the weekly allowance. |
| **series** | Two fields on the row, `series` (a name) and `seriesNumber` (1, 2, 3 …). Books with the same name are one series. |
| **Discover rail** | A sideways row of covers on Discover. The three largest series get one automatically; an admin can also save its own rows. |
| **books host** | `https://books.inputread.site`, the public address of the `margin-words-books` bucket. |

<a id="identity-and-naming"></a>
## Identity and naming

- **Catalog identity** is `<catalog>:<id>`: `word-lists:the-lantern-seller` or
  `public-books:alice`. The two catalogs allocate ids independently; an id alone is not a global
  identity. Reports store this reference in `catalog_id`.
- **Device `book_id`** identifies one reader's installed book, not a catalog book across devices.
  Admin **`kind`** is `lists` or `public`, not a catalog prefix. Discover saved-row **keys** are
  `list:<id>` or `classic:<id>`, not report references.
- **New ids**: derive a meaningful lower-case slug from the book's complete official title (and
  distinguishing series/number words when needed), with digits and single hyphens, at most 64
  characters (`^[a-z0-9]+(?:-[a-z0-9]+)*$` plus the length limit). For example, *Magic Tree House
  5: Night of the Ninjas* gets `magic-tree-house-5-night-of-the-ninjas`, never a new `mth05`.
  `custom` is reserved for reader-edited lists; never publish it as a catalog id. The parser accepts
  underscores (`^[a-z0-9][a-z0-9_-]{0,63}$`) for compatibility, not as a new naming recommendation.
  **Do not rename or migrate old ids**, folders or references to tidy their spelling: a live legacy id
  such as `mth05` and every path or report reference that uses it stays exactly as it is.
- **The admin pages make the new id for you.** For a file that matches no existing book (by
  file-name id, then by title), the Word lists and Books pages show the title slug
  (`src/lib/book-id.ts` `idFromTitle`: series and number first when the title does not already name
  the series) and publish under it; the file name does not set it. On the Word lists page the id can
  be edited: a non-slug id cannot be published, and an id with words that are not in the title or
  series (an abbreviation such as `mth05`) needs a ticked confirmation. The server refuses a new row
  whose id is not a slug or is `custom` (`bad-new-id`); updates to existing ids, old spellings
  included, are unchanged.
- **Display names are complete official names.** New rows and series use the full official `title`
  and `series` display names; do not abbreviate *Magic Tree House* as `MTH`. An official name that
  is itself an abbreviation, such as the `TED` series, may remain abbreviated. Correcting an existing
  series display name is a separate reviewed change, not part of new-id creation or an ordinary upload.
- **Title, author and ISBN are evidence, not interchangeable ids.** Check that catalog and
  word-list metadata and the actual EPUB's metadata **and body** name the intended book/edition.
  The source EPUB filename is only a hint; renaming it proves nothing. Do not rename, repackage, or
  edit the EPUB to make its filename, internal bytes, or metadata fit a catalog row. Validate the
  exact intended bytes you were given. Title comparison uses `src/lib/book-title.ts`: punctuation/case
  ignored, at most two trailing edition labels removed, real subtitles retained. A title collision
  means stop and disambiguate (author, ISBN, body), not overwrite another book.
- **Glossary filenames and storage keys are different contracts.** For a new book submitted through
  the admin Books page, name the selected glossary file `<id>.glossary.json`, where `<id>` is the
  final new-title slug. This filename is an id hint and must still pass the catalog checks; it does
  not override the title or edition evidence. In a trusted staging folder, use the neutral working
  name `glossary.json`; the remote key is also `<id>/glossary.json`. The EPUB stays `book.epub` in
  staging and at its remote key. The source EPUB filename is only a hint: preserve its exact bytes,
  internal metadata and other contents unchanged.
- Compare ISBN using the existing `isbnDigits` in `src/lib/book-meta.ts`: it validates check digits,
  converts valid ISBN-10 to ISBN-13, and returns `""` for invalid values. This is **not** just
  stripping punctuation. A matching ISBN/title does not prove that anchors fit this EPUB.
- Validate the **exact intended EPUB bytes** against the final list (anchors/context, chapter
  count, `sha256`, `spine.merge`, `segmentation`); inspect body/front matter for the edition.
  `node scripts/validate-glossary.mjs book.epub glossary.json` may exit **0 with warnings**.
  Review every warning, especially title, hash, chapter and spine differences; explain or fix it
  before publication. Exit 0 alone is not approval. Without the validator, manual anchor checks
  must establish the same book/edition; uncertainty means stop, not upload.
- Old lists without `title` pass `replacesSameBook` for compatibility only: this is **not an
  identity guarantee**. Verify live metadata and the actual EPUB yourself. Updates preserve all
  unrelated catalog and word-list metadata, including unknown fields, author, ISBN, edition/anchor
  settings and reader credits. Do not rebuild metadata from filenames or apply new-book defaults
  to an existing row; deliberate metadata changes need separate review.

## 1. Pick your job

| You were asked to… | Go to |
| --- | --- |
| Add a **new copyrighted book** (EPUB + word list, novel or speech) | §5 |
| Replace or improve **only the word list** of a book that is live | §6 |
| Replace the **EPUB** of a book that is live | §7; public API contract is implemented but CPU-budget gated |
| Put a book **into a series**, move it to another series, or take it out | §8 |
| Change a book between **novel and speech** | §8.8 |
| Add or replace the **cover** | §10 |
| Add or rewrite the **story summary** (简介) | §11 |
| Add a **new public-domain book** | Unsupported here: stop and escalate (§5.0). |

## 2. What a book is on the site

Every book has a **word list** and a **row in a catalog**. Two kinds:

| Kind | Who may read the EPUB | Word list | EPUB | Catalog |
| --- | --- | --- | --- | --- |
| Copyrighted (`lists`) | Trusted readers only | `margin-words-books`: `word-lists/<id>/glossary.json` | `margin-words-private`: `<id>/book.epub` | `margin-words-books`: `word-lists/catalog.json`, field `lists` |
| Public domain (`public`) | Everyone | `margin-words-books`: `public-books/<id>/glossary.json` | `margin-words-books`: `public-books/<id>/book.epub` | `margin-words-books`: `public-books/catalog.json`, field `packs` |

Both kinds also have, in `margin-words-books`:

| File | Key | Section |
| --- | --- | --- |
| Discover card cover | `covers/lists-<id>.jpg` or `covers/public-<id>.jpg` | §10 |
| Story summary (the book sheet) | `word-lists/<id>/blurb.json` or `public-books/<id>/blurb.json` | §11 |

The cover and the summary are optional. Without a cover the app draws a title-and-author cover
(a speech gets its own quotation-mark look); without a summary the sheet shows none.

**Category.** A novel has no `category` field; a speech has `"category": "speech"`. The category
picks the Discover tab (Novels / Speeches) and the weekly allowance: a plain reader may open 7 new
novels and 7 new speeches in a rolling 7 days, and the server counts them from these catalogs. Ask
the person who gave you the book which it is when you cannot tell. A talk, address or lecture is a
speech.

**Series.** `series` is just a string on the row. Discover groups a tab's books by that exact string,
so a series needs no file of its own and works for speeches too (a TED row). Section 8 is the whole
story.

## 3. Access and the commands

- `npx wrangler login` once, or `CLOUDFLARE_API_TOKEN` set in the environment. The token needs
  **Workers R2 Storage Edit** on account `6ece9f6dbbc73db1be2810fb39f277c3`. Never print the token,
  put it in a file, or send it anywhere but Cloudflare.
- Always pass `--remote`. Without it wrangler writes to a local copy and nothing reaches the site.
- The two commands you need:

```
read   npx wrangler r2 object get "<bucket>/<key>" --file <local file> --remote
write  npx wrangler r2 object put "<bucket>/<key>" --file <local file> --content-type <type> --remote
```

Content types: `application/json` for `.json`, `application/epub+zip` for `.epub`,
`image/jpeg` for covers. A cover also gets `--cache-control "public, max-age=31536000, immutable"`.

Use a **new, trusted staging folder**, not a downloaded archive's extraction directory. Keep each
untrusted download/extraction in its own separate empty directory. Copy only the selected data files
(`book.epub`, JSON, cover) into staging; never copy executable files or dependency manifests there.
Save the scripts you write below in staging's separate `scripts/` subfolder, and run commands from
staging, not from an untrusted download directory. Relative data paths in the examples use staging.
Before using any write command below, complete the
[publishing checkpoints](https://inputread.site/kit/maintenance.md#publishing):

- Coordinate an **exclusive window with all writers** (admin publishers, patrol and CLI/API agents).
  Wrangler does not acquire the cooperative D1 lock; a last-second reread alone is not exclusion.
- Snapshot the exact current bytes **and metadata** of every object you will change (record an
  absent key too). Keep backups separate from the edited files.
- Reread affected live objects immediately before publishing, including both catalogs for a new
  book. If bytes or metadata changed since your snapshot, **abort and rebase** on fresh snapshots;
  do not overwrite the change.
- After writing, reread R2 and verify exact bytes, metadata, hashes/counts and preserved rows before
  releasing the window or clearing a work mark. A successful upload command is not verification.

If any stage fails, stop and follow [recovery](https://inputread.site/kit/maintenance.md#recovery).
Direct writes have no automatic rollback; replacing an existing key can leave the live file and
catalog hash inconsistent.

## 4. Check the files before you upload

1. `glossary.json` parses as JSON and has a non-empty `glossary` object. It is at most 16,000,000
   bytes. A new copyrighted book must carry a `title` in the file.
2. The word list matches the EPUB. With Node and the repository:
   `node scripts/validate-glossary.mjs book.epub glossary.json`. Without them, check at least that a
   few anchors' `context` texts appear in the book. Do not upload a list you could not check.
3. The cover, if any, is a JPEG at most 400 px wide and under 5 MB. Without one, the app draws its
   own cover; that is fine.
4. **Same book, not a new one.** When `<id>` is already in the catalog, the file's `title` must
   name that same book. Compare the titles in lower case with only letters and digits kept, after
   dropping at most two trailing edition labels (`: A Novel`, `: A Memoir`, `(A Novel)` and the
   like), never a real subtitle. Missing `title` is legacy compatibility, not proof of identity:
   follow [identity and naming](#identity-and-naming). If titles differ, stop and investigate;
   another book needs its own id, not an overwrite.
5. **No second id for one book.** For a new `<id>`, no row in either catalog may have the same
   title (compared the same way). If one does, stop and disambiguate; reuse its id only after
   proving it is the same book, never a different book with the same title.

## 5. Job A — a new copyrighted book, end to end

This is the whole job for one book. The example is *The Lantern Seller* by Mei Lin, id
`the-lantern-seller`, a novel, the first book of the series *Lantern Street*, with a cover and a
summary. Change the names, keep the order.

### 5.0 What cannot be added this way

A **brand-new public-domain id** is unsupported by this procedure and the current admin publisher.
If the id is not in `public-books/catalog.json`, **stop and escalate to the owner**. Do not use the
[retired offline pipeline](https://inputread.site/kit/maintenance.md#retired) to invent or rebuild its
row. You can still update the word list (§6) or the EPUB (§7) of a public book that is live.

### 5.1 Put the files in one folder

```
the-lantern-seller/
  book.epub        the book
  glossary.json    its word list
  cover.jpg        optional
  blurb.json       optional, the story summary
```

### 5.2 Download both catalogs and check the id

```
npx wrangler r2 object get "margin-words-books/word-lists/catalog.json" --file word-lists-catalog.json --remote
npx wrangler r2 object get "margin-words-books/public-books/catalog.json" --file public-catalog.json --remote
```

Create a `scripts/` folder in staging (not inside an untrusted download). Save this shared helper
as `scripts/book-identity.mjs`; both local examples below use it. It matches
`normalizeTitle` / `replacesSameBook` in `src/lib/book-title.ts`.

```js
// Staging helper: scripts/book-identity.mjs
const EDITION = "a novel|a memoir|a biography|a true story|an autobiography|a novella|a graphic novel";
const EDITION_TAIL = new RegExp(
  `(?:\\s*[:：]\\s*(?:${EDITION})|\\s+[-–—]\\s*(?:${EDITION})|\\s*\\((?:${EDITION})\\))\\s*$`, "i",
);
export function norm(value) {
  let title = value.trim();
  for (let pass = 0; pass < 2; pass += 1) {
    const next = title.replace(EDITION_TAIL, "").trim();
    if (!next || next === title) break;
    title = next;
  }
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
export function replacesSameBook(existingTitle, incomingTitle) {
  if (typeof incomingTitle !== "string" || !incomingTitle.trim()) return true;
  return norm(incomingTitle) === norm(typeof existingTitle === "string" ? existingTitle : "");
}
```

Then look for the id and the title in **both** fresh catalogs. Save this as `scripts/find-book.mjs`
and run from staging `node scripts/find-book.mjs the-lantern-seller "The Lantern Seller"`:

```js
// Is this book already live? Print every collision, not just the first.
import { readFileSync } from "node:fs";
import { norm } from "./book-identity.mjs";
const [id, title] = process.argv.slice(2);
if (!id || !title?.trim()) throw new Error("usage: find-book.mjs <id> <title>");
for (const file of ["word-lists-catalog.json", "public-catalog.json"]) {
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  const rows = catalog.lists ?? catalog.packs;
  const missing = rows.filter((row) => typeof row.title !== "string" || !row.title.trim());
  if (missing.length) throw new Error(`${file}: verify missing titles for ids ${missing.map((row) => row.id).join(", ")} before publication`);
  const hits = rows.filter((row) => row.id === id || norm(row.title) === norm(title));
  console.log(file, hits.length ? hits.map((row) => `TAKEN: ${row.id} — ${row.title}`).join("\n") : "free");
}
```

- A missing-title diagnostic is a preflight stop, not a `free` result: inspect those live rows and
  establish their identities with the owner. Do not rename old ids or invent titles to pass the check.
- Both say `free`: it is a new book. Continue after the identity/edition checks above.
- The id is taken and verified to name the same book: it is not new. Go to §6 (list) or §7 (EPUB).
- The title is taken under **another id**: verify author, ISBN and actual body. Reuse that id only
  for the same book; ambiguous or same-title different books require owner review.
- The id is taken by a **different** book: pick a new id; never overwrite another book.

### 5.3 Upload the EPUB

```
npx wrangler r2 object put "margin-words-private/the-lantern-seller/book.epub" --file book.epub --content-type application/epub+zip --remote
```

The private bucket is never public: readers stream the EPUB through the site, which checks the
account. Do not put a copyrighted EPUB in `margin-words-books`, and do not put it anywhere else.

### 5.4 Upload the word list

```
npx wrangler r2 object put "margin-words-books/word-lists/the-lantern-seller/glossary.json" --file glossary.json --content-type application/json --remote
```

A public-domain book uses `public-books/<id>/glossary.json` instead, and its EPUB goes to
`public-books/<id>/book.epub` in the same bucket.

### 5.5 Upload the cover (when you have one)

```
npx wrangler r2 object put "margin-words-books/covers/lists-the-lantern-seller.jpg" --file cover.jpg --content-type image/jpeg --cache-control "public, max-age=31536000, immutable" --remote
```

A public book uses `covers/public-<id>.jpg`. Section 10 explains why the cache header and the
`?v=` address matter; skipping either leaves readers on an old picture for up to a year.

### 5.6 Write the row

A **new** row is built from the word list's metadata (`title`, `author`, `lexile`, `isbn`, `series`,
`seriesNumber`, `category`). Updates preserve unrelated live metadata and change only job fields,
plus counts and exact-byte hashes, following the
[shared count/version rules](https://inputread.site/kit/maintenance.md#versions). Do not type the
numbers by hand: save this script as `scripts/row.mjs`, fill in `JOB`, run from staging, then publish
`catalog.next.json` through §3's checkpoints. This local script does not lock, snapshot or upload.

It works in three modes and **never touches another row**:

| `mode` | What it does | Which files it needs |
| --- | --- | --- |
| `"new"` | Adds a row for a book that is not live yet. | `glossary.json`, the live catalog |
| `"list"` | Keeps the live row, updates the counts, the glossary hash and `updated` for a new word list. | `glossary.json`, the live catalog |
| `"series"` | Keeps everything and changes only `series`, `seriesNumber`, `category` or `isbn`. | the live catalog |

```js
#!/usr/bin/env node
// Rewrite ONE row of a live catalog. It never uploads and never touches another row.
// 1. fill in JOB  2. node scripts/row.mjs  3. upload catalog.next.json as §5.7 says
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { replacesSameBook } from "./book-identity.mjs";

const JOB = {
  mode: "new",                 // "new" | "list" | "series"
  kind: "lists",               // "lists" (copyrighted) | "public"
  id: "the-lantern-seller",
  catalog: "word-lists-catalog.json", // the live catalog downloaded in §5.2
  glossary: "glossary.json",   // the exact word list you uploaded ("" in mode "series")
  cover: "cover.jpg",          // "cover.jpg" if you uploaded one, else ""
  category: null,              // "speech" | "novel" | null (leave the row as it is)
  series: null,                // "Lantern Street" | "" (remove) | null (leave)
  seriesNumber: null,          // 1-99, used only with a series name
  isbn: null,                  // "978..." | "" (clear) | null (leave)
  now: new Date().toISOString(),
};

if (JOB.mode === "new" && (JOB.id === "custom" || JOB.id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(JOB.id)))
  throw new Error("new ids must be lower-case hyphenated names, not custom");
const isPublic = JOB.kind === "public";
if (isPublic && JOB.mode === "new") throw new Error("new public id unsupported: stop and escalate (§5.0)");
const field = isPublic ? "packs" : "lists";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

const catalog = JSON.parse(readFileSync(JOB.catalog, "utf8"));
const rows = catalog[field];
if (!Array.isArray(rows)) throw new Error(`${JOB.catalog} has no ${field} array`);
const at = rows.findIndex((item) => item.id === JOB.id);
if (JOB.mode === "new" && at >= 0) throw new Error(`${JOB.id} is already live: use mode "list"`);
if (JOB.mode !== "new" && at < 0) throw new Error(`${JOB.id} is not in ${JOB.catalog}`);

const row = at >= 0 ? { ...rows[at] } : { id: JOB.id };

if (JOB.glossary) {
  const bytes = readFileSync(JOB.glossary);
  const file = JSON.parse(bytes.toString("utf8"));
  if (JOB.mode === "list" && !replacesSameBook(row.title, file.title))
    throw new Error("incoming title names another book: stop and investigate (identity-and-naming)");
  const entries = file.glossary;
  if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length === 0)
    throw new Error("the word list has no glossary object");
  const sha = sha256(bytes);
  if (JOB.mode === "new") {
    row.title = text(file.title);
    if (!row.title) throw new Error("a new book needs a title in the word list");
    row.author = text(file.author);
    if (text(file.lexile)) row.lexile = text(file.lexile);
    if (text(file.isbn)) row.isbn = text(file.isbn);
    if (text(file.series)) {
      row.series = text(file.series).replace(/\s+/g, " ").slice(0, 80);
      const n = Number(file.seriesNumber);
      if (Number.isInteger(n) && n >= 1 && n <= 99) row.seriesNumber = n;
    }
    if (file.category === "speech") row.category = "speech";
    row.added = JOB.now;
  } else if (row.glossary?.sha256 && row.glossary.sha256 !== sha && typeof row.updated === "string") {
    row.previousUpdated = row.updated;
  }
  row.words = Number(file.count) || Object.keys(entries).length;
  row.paragraphs = Array.isArray(file.paragraphs) ? file.paragraphs.length : 0;
  row.sentences = Array.isArray(file.sentences) ? file.sentences.length : 0;
  row.phrases = file.phrases && typeof file.phrases === "object" ? Object.keys(file.phrases).length : 0;
  row.glossary = { ...row.glossary, url: `${JOB.id}/glossary.json`, bytes: bytes.length, sha256: sha };
  if (isPublic) row.rev = row.glossary.rev = sha.slice(0, 12);
  row.updated = JOB.now;
}

if (JOB.cover) {
  const bytes = readFileSync(JOB.cover);
  row.cover = {
    url: `https://books.inputread.site/covers/${isPublic ? "public" : "lists"}-${JOB.id}.jpg`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

if (JOB.category !== null) {
  if (JOB.category === "speech") row.category = "speech";
  else delete row.category;
}

if (JOB.series !== null) {
  const name = text(JOB.series).replace(/\s+/g, " ").slice(0, 80);
  if (!name) {
    delete row.series;
    delete row.seriesNumber;
  } else {
    row.series = name;
    const n = Number(JOB.seriesNumber);
    if (Number.isInteger(n) && n >= 1 && n <= 99) row.seriesNumber = n;
    else delete row.seriesNumber;
  }
}

if (JOB.isbn !== null) {
  if (text(JOB.isbn)) row.isbn = text(JOB.isbn);
  else delete row.isbn;
}

if (JOB.mode === "new") {
  // Keep the row's fields in a readable order, the same as every other row.
  const ordered = {};
  for (const key of ["id", "title", "author", "lexile", "isbn", "series", "seriesNumber", "category",
    "words", "paragraphs", "sentences", "phrases", "updated", "glossary", "cover", "added"])
    if (row[key] !== undefined) ordered[key] = row[key];
  for (const key of Object.keys(row)) if (!(key in ordered)) ordered[key] = row[key];
  for (const key of Object.keys(row)) delete row[key];
  Object.assign(row, ordered);
}

const next = { ...catalog, updated: JOB.now };
next[field] = at >= 0 ? rows.map((item, i) => (i === at ? row : item)) : [...rows, row];

const ids = new Set();
for (const item of next[field]) {
  if (!item || typeof item.id !== "string" || ids.has(item.id)) throw new Error("the catalog would have a missing or repeated id");
  ids.add(item.id);
}
for (const old of rows) {
  if (old.id === JOB.id) continue;
  const kept = next[field].find((item) => item.id === old.id);
  if (!kept) throw new Error(`refusing to drop ${old.id}`);
  if ((kept.glossary?.sha256 ?? "") !== (old.glossary?.sha256 ?? "")) throw new Error(`refusing to change ${old.id}`);
}

writeFileSync("catalog.next.json", `${JSON.stringify(next, null, 1)}\n`);
console.log(JSON.stringify({ id: JOB.id, mode: JOB.mode, rows: next[field].length, row }, null, 1));
console.log(`\nUpload:\nnpx wrangler r2 object put "margin-words-books/${isPublic ? "public-books" : "word-lists"}/catalog.json" --file catalog.next.json --content-type application/json --remote`);
```

Run it and read what it prints. The row it shows is the row that will be live:

```
node scripts/row.mjs
```

Before running `row.mjs` in **any** mode, complete the identity/edition preflight above; for a new
book, run §5.2 against both catalogs using the final glossary title. The script checks same-book
titles in list mode (legacy missing titles still need manual verification), ids and other rows'
hashes, but cannot see the **other** catalog or verify the actual EPUB body for you.

### 5.7 Upload the catalog last

```
npx wrangler r2 object put "margin-words-books/word-lists/catalog.json" --file catalog.next.json --content-type application/json --remote
```

The catalog goes last so a **new row** is not advertised before its files exist. Replacing an
existing file is not atomic with the catalog write: keep §3's exclusive window and verification,
and use [recovery](https://inputread.site/kit/maintenance.md#recovery) if either write fails.

### 5.8 Write the summary (optional)

```
npx wrangler r2 object put "margin-words-books/word-lists/the-lantern-seller/blurb.json" --file blurb.json --content-type application/json --remote
```

Only after the row is live. Section 11 links the summary format and writing rules.

### 5.9 Check the result from outside

First reread the written objects through authenticated R2 access: compare glossary/EPUB/cover bytes
and metadata with the intended files, catalog hashes and counts with those bytes, and all unrelated
rows/fields with the snapshot (§3). Then check the reader-facing result:

```
curl -s https://books.inputread.site/word-lists/catalog.json -o live-catalog.json
node -e "console.log(require('./live-catalog.json').lists.find(r=>r.id==='the-lantern-seller'))"
```

- The row shows the values the script printed; counts match the file (optional note counts may be 0).
- The cover opens at `<cover.url>?v=<first 12 of cover.sha256>` and answers
  `Cache-Control: public, max-age=31536000, immutable`:
  `curl -sI "https://books.inputread.site/covers/lists-the-lantern-seller.jpg?v=<12>" | grep -i cache-control`.
- The summary shows at `https://books.inputread.site/word-lists/the-lantern-seller/blurb.json`.
- The word list answers **403** at
  `https://books.inputread.site/word-lists/the-lantern-seller/glossary.json`. That is right: readers
  get word lists only through the site's account API, which counts the weekly allowance.
- Discover shows the book under its tab, and its detail sheet shows the series and number.

Reader-facing checks are subject to cache and page state; they do not replace the R2 reread.
See [cache/version behavior](https://inputread.site/kit/maintenance.md#versions). A cover replacement
needs a new hash-derived `?v=` (§10); ordinary readers may need a full page reload for a changed summary.

### 5.10 Clear the work mark

Only after publication is verified, if `margin-words-books/word-lists/glossary-work.json` lists this
book (`{"kind": "lists" or "public", "id": "<id>"}` in `items`), remove that item, set `updated` to now,
and write the file back under §3's checkpoints (including snapshot, reread and verification of this
file). It marks books an admin is still working on. A missing file is fine.

## 6. Job B — replace only the word list (词典)

The book is already live and you were given a better word list: more words, better meanings, fixed
paragraph help. The EPUB, cover, title, series and category do not change.

**The live list is not the file you were given.** The daily patrol edits the live list: it adds
words, fixes meanings, and credits readers. Overwriting it blindly erases that work.

1. **Read the live catalog and the live word list.**

```
npx wrangler r2 object get "margin-words-books/word-lists/catalog.json" --file word-lists-catalog.json --remote
npx wrangler r2 object get "margin-words-books/word-lists/<id>/glossary.json" --file live-glossary.json --remote
```

A public book uses `public-books/catalog.json` and `public-books/<id>/glossary.json`.
The public admin write endpoint is CPU-budget gated as described in §7; do not use direct writes
as a workaround for a closed deployment gate. A separately authorized direct workflow still
requires its own complete validation and exclusive writer window.

2. **Compare before you overwrite.** Save this as `scripts/compare.mjs` and run from staging
   `node scripts/compare.mjs live-glossary.json glossary.json`:

```js
// Full structural comparison; this reports differences, it never merges or uploads.
import { readFileSync } from "node:fs";
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error("usage: compare.mjs live.json candidate.json");
function readComparableJson(path) {
  const raw = readFileSync(path, "utf8");
  // Scan original tokens BEFORE JSON.parse can round numbers or turn overflow into Infinity.
  // Match strings first, including escaped quotes/backslashes; their digits are not numbers.
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    if (!/^-?(?:0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token)) || token === "-0") {
      throw new Error(`${path}: unsupported numeric token at offset ${match.index}; stop for lossless comparison and manual review`);
    }
  }
  return JSON.parse(raw); // Syntax validation remains JSON.parse's job.
}
const [live, next] = paths.map(readComparableJson);
const pointer = (path, key) => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
const kind = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const changes = [];
function compare(before, after, path = "") {
  if (kind(before) !== kind(after)) {
    changes.push({ op: "changed", path, before, after });
  } else if (before !== null && typeof before === "object") {
    // Arrays are compared by index, not guessed identity. A move can change many paths.
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const child = pointer(path, key);
      if (!Object.hasOwn(after, key)) changes.push({ op: "deleted", path: child, before: before[key] });
      else if (!Object.hasOwn(before, key)) changes.push({ op: "added", path: child, after: after[key] });
      else compare(before[key], after[key], child);
    }
  } else if (before !== after) changes.push({ op: "changed", path, before, after });
}
function credits(value, path = "", out = new Map()) {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const location = pointer(path, key);
      if (key === "credit") out.set(location, child);
      credits(child, location, out);
    }
  }
  return out;
}
compare(live, next);
const oldCredits = credits(live), newCredits = credits(next);
const creditChanges = [];
for (const path of new Set([...oldCredits.keys(), ...newCredits.keys()])) {
  const had = oldCredits.has(path), has = newCredits.has(path);
  const before = oldCredits.get(path), after = newCredits.get(path);
  if (!has) creditChanges.push({ op: "deleted", path, before });
  else if (!had) creditChanges.push({ op: "added", path, after });
  else if (JSON.stringify(before) !== JSON.stringify(after)) creditChanges.push({ op: "changed", path, before, after });
}
// JSON serialization avoids console inspection's depth/array truncation. No sampling or slice.
console.log(JSON.stringify({ changes, creditChanges }, null, 2));
```

**Numeric fail-closed guard:** before parsing either file, the script checks raw JSON number
tokens, not already-rounded JavaScript values. It permits only decimal safe-integer tokens
(`-9007199254740991` through `9007199254740991`), rejecting fractional/exponent notation,
unsafe integers and negative zero. Digits inside JSON strings are not numeric tokens. This is
intentionally conservative: even `1.0` and `1e0` stop the comparison. A rejection is **not** a
no-difference result: preserve the original bytes and stop for a lossless comparison and manual
review; do not round, coerce, delete unknown fields or rewrite numeric tokens just to pass this
helper. No upload is authorized until every original value/difference is verified.

The output uses JSON Pointer paths (`~0` = `~`, `~1` = `/`; `""` = the root). It includes
all additions, changes and deletions in words, senses, anchors, phrases, sentences, paragraphs,
metadata and **unknown fields**. Added/deleted subtrees and type changes carry their complete
values; array elements use their index paths, not a guessed semantic match. `creditChanges`
separately checks **every credit at its own location**, even if the same public id survives on
another entry, sense, phrase or note. This is a conservative audit of any field named `credit`,
including unknown structures; that name alone does not establish a schema-valid contribution or
justify acceptance. Array reordering can move a credit: inspect its meaning and
anchor, never treat a matching public id somewhere else as preservation. Save the full output;
there is no 50-item cap or truncated object inspection. A zero exit code means the comparison ran,
**not** that a candidate is safe to publish.

3. **Merge until every difference is intended — manual review is mandatory.** Review **every**
   reported path, including additions and unknown fields, and record why it is in scope. Restore
   deleted/changed live words, senses, phrases, sentence/paragraph notes, anchors and their credits
   unless an explicitly reviewed intended change supersedes them. If the live meaning is a patrol
   fix, keep it; if your file is the intended new text, keep yours only after reviewing its context
   and credit. When uncertain, keep the live content and report the difference instead of guessing.
   Preserve unrelated top-level metadata and unknown fields too; title/author/ISBN and edition
   settings are not replacement defaults. The script is a structural report, not an automatic
   merge, a schema validator or permission to delete. Revalidate the **merged** file against the
   actual EPUB, reviewing warnings as above. Run the comparison again and review the final output.
   **Before any upload**, prepare `catalog.next.json` locally with `row.mjs` in list mode using
   step 5's settings; its same-book guard must pass before step 4 writes the glossary. A missing title
   still requires the manual identity check, not just a passing script.

4. **Reread and compare the live list and catalog to your snapshots** (§3). If either changed,
   abort and redo the merge on fresh snapshots. Within the coordinated exclusive window, upload
   the merged word list, then the row:

```
npx wrangler r2 object put "margin-words-books/word-lists/<id>/glossary.json" --file glossary.json --content-type application/json --remote
```

5. **Write the row** with `row.mjs` in mode `"list"` (§5.6). Set `glossary: "glossary.json"`,
   `cover: ""`, and leave `category`, `series`, `seriesNumber` and `isbn` as `null`. The script:

   - keeps every other field of the row (title, author, series, cover, `added`);
   - updates `words`, `paragraphs`, `sentences`, `phrases`;
   - sets `glossary.bytes` and `glossary.sha256` to the exact file you uploaded;
   - sets `previousUpdated` to the row's old `updated` when the hash changed, and `updated` to now;
   - for a public book also sets `rev` (the first 12 hex digits of the hash) on the row and on
     `glossary`.

6. **Upload the catalog** and check it as in §5.9. Readers who already have the book see **Update**
   on its card, because the glossary hash changed. Their copy of the list is not replaced silently:
   the app checks the new list against their book and asks them.

Do not change `added`: it is when the book first came to the catalog, and Discover's new-books row
is ordered by it.

## 7. Job C — replace the EPUB

Use §3's exclusive window, exact-byte/metadata snapshots, prewrite reread and postwrite verification
for EPUB replacements too. **Copyrighted book.** Put the new file at the same private key:

```
npx wrangler r2 object put "margin-words-private/<id>/book.epub" --file book.epub --content-type application/epub+zip --remote
```

The word-list row has no EPUB field, so the catalog does not change. The site does not push a new
EPUB to readers who already added the book; they keep the copy they downloaded. If the new EPUB
changes the text, the word list must be rebuilt for it — and publishing that list (§6) is what
offers readers an Update.

**Public-domain book: the implemented API is CPU-budget gated; stop before any write unless the operator has confirmed the deployment budget.**
The admin **Books** tab now sends one multipart request to
`POST /api/admin/books?id=<id>&kind=public`, with EPUB and glossary required and cover optional.
It does not first publish to the private word-list catalog. Both this request and the public
list-only endpoint (`/api/admin/word-lists?catalog=public`) require
`PUBLIC_BOOK_PUBLISH_CPU_CONFIRMED=true` in the deployment; the default is HTTP 503
`publish-budget-unconfirmed`, after authentication but before body parsing, hashing or writes.
This code change does not enable that setting or authorize production book writes.

A local Node test with valid 4 MB / 7,000-entry and 16 MB / 28,000-entry JSON took about 20 ms
and 61 ms wall time for parse + strict validation alone. This is **not** Cloudflare CPU evidence
and does not demonstrate safety under Pages Free's 10 ms budget. Do not guess a safe byte threshold,
raise the budget, or enable the setting as part of a routine upload. The operator must separately
verify the target runtime and paid CPU budget before enabling either public write path. Until then,
remain read-only and report. The 16 MB size cap is not a CPU guarantee.

Once separately enabled and authorized, the handler strictly validates the glossary and checks the
live row's same-book title guard before any content write. It saves original uploaded bytes,
preserves unknown fields, computes counts from validated content, and updates catalog timestamps.
The title guard is not verification of EPUB text, edition or anchors; all editorial checks and the
exclusive window with every writer still apply. A brand-new public id remains unsupported.

**Version contract:** `glossary.rev` is the first 12 hex characters of the glossary SHA-256.
When EPUB bytes change, top-level `row.rev` is the first 12 hex characters of
`sha256(epubSHA + "\n" + glossarySHA)` (the two full lowercase hashes joined by one newline).
A glossary-only change uses the glossary hash prefix for row `rev`; an identical-byte retry
preserves the current row `rev`, including an existing combined revision. Reader update scans
also compare EPUB SHA even when the row revision matches, so a glossary rollback cannot hide
a changed book file. `updated` or
`epub.sha256` alone cannot replace the reader's row revision gate. Exact references include URL,
bytes and full SHA-256. `row.mjs` does not implement EPUB replacement: do not improvise a direct
write or revive retired publishing tools. The catalog lock and content/cover compensation are
best-effort, not a cross-object transaction; retain snapshots and verify readback before completion.
Private Books uploads remain two steps: a saved word list followed by the EPUB. A second-step
failure is explicitly partial success, not a complete publish; inspect live files before retrying.
Implementation references: `src/components/books-admin.tsx`, `functions/api/admin/books.ts`,
`functions/lib/public-book-publish.ts` and `src/lib/word-list-update.ts`.
See [versions](https://inputread.site/kit/maintenance.md#versions).

## 8. Job D — series

### 8.1 What a series is

A series display name is the complete official name, not a locally invented abbreviation. Use an
official abbreviation only when that is the name itself (for example, `TED`). Do not turn `Magic Tree
House` into `MTH`; correcting an existing series name requires a separate reviewed change across all
affected rows and any saved rail, and is not part of an ordinary upload.

A series is two fields on the row and nothing else:

```json
{ "id": "mth05", "title": "Magic Tree House 5: Night of the Ninjas",
  "series": "Magic Tree House", "seriesNumber": 5 }
```

This example deliberately shows a legacy id. Do not use `mth05` for a new row, and do not migrate
this existing id or any reference/path that contains it. A new row for this complete title would use
a meaningful full-title slug such as `magic-tree-house-5-night-of-the-ninjas` (subject to the 64-
character and collision checks in [identity and naming](#identity-and-naming)).

- `series` is the name. Every book in the series must carry **exactly the same string**. It is
  trimmed and its runs of spaces are collapsed when read; case still matters, so
  `Magic Tree House` and `magic tree house` are two different series.
- `seriesNumber` is the book's place, a whole number from 1 to 99. It is stored only together with
  a name; a number without a name is ignored.
- There is no series file and no database table. Change the rows and the series changes.
- A series works the same for speeches. The live catalog has a speech series named `TED`.

### 8.2 Put a book into a series

**Find the name that already exists.** Do not invent a near-duplicate. This lists every series name
in the tab and how many books it has:

```
node -e "const c=require('./word-lists-catalog.json');const m={};for(const r of c.lists){const k=(r.category==='speech'?'speech: ':'novel: ')+(r.series||'(none)');m[k]=(m[k]??0)+1}console.log(m)"
```

**Legacy series-name conflict: stop and report.** If the existing series uses an old invented
abbreviation such as `MTH`, adding a new row with the required complete name `Magic Tree House`
would create a parallel series, while copying `MTH` would violate the new-name rule. Neither is an
ordinary upload solution. Stop before publishing that new row and request a **separate reviewed
series/rails migration** covering every affected existing row and saved Discover rail. Do not create
a parallel `Magic Tree House` series, and do not silently rename old rows during an ordinary upload.
Keep all legacy book ids and paths unchanged. Resume the new upload only after the reviewed
series-name migration is complete and verified; official abbreviations such as `TED` are not this
conflict.

When the existing name satisfies the complete-official-name rule, use it exactly as it appears
(for example `Magic Tree House`), then run `row.mjs` from §5.6 in mode `"series"`:

```js
const JOB = {
  mode: "series",
  kind: "lists",
  id: "mth05",                    // existing legacy id only; never use this for a new row
  catalog: "word-lists-catalog.json",
  glossary: "",
  cover: "",
  category: null,              // null keeps the tab as it is
  series: "Magic Tree House",  // "" removes the series from this book
  seriesNumber: 5,
  isbn: null,
  now: new Date().toISOString(),
};
```

Then upload the catalog as in §5.7. The script changes only this book's `series` and
`seriesNumber`; the title, cover, word list and `updated` stay as they are, so the card does not
claim an update that did not happen.

**A new book** can go straight into a series: in mode `"new"`, set `series` and `seriesNumber` in
`JOB` (or put `"series"` and `"seriesNumber"` in the word list file before uploading it).

**With an admin login**, the same change is
`POST /api/admin/word-lists?id=<id>&series=<name>&seriesNumber=<n>` with the live word list as the
body, or the series fields on `/admin/` → Books. The admin route also refreshes `updated`, which
this page's script does not.

### 8.3 The order inside a series

Books are ordered by:

1. `seriesNumber` when it is 1–99;
2. otherwise the first number in a range in the title, minus 0.5 — an omnibus such as
   `Magic Tree House Books 1-4 Collection` counts as 0.5, so it comes before book 1;
3. otherwise last (after every numbered book);
4. ties by title.

The live *Magic Tree House* row set is a good example: the `1-4` collection comes first, then 5, 6,
7 …

### 8.4 What readers see

| Where | Effect |
| --- | --- |
| Discover, browsing | The **three largest series** in the current tab (each with 3 or more books) get a sideways rail, largest first, then by name. A rail shows 18 covers and **See all**. |
| Discover, a saved rail | If an admin saved Discover rows, a `{"source":"series","name":"…"}` row shows every book with that name, even a series of one. §8.6. |
| Discover, Filter | The series menu lists every series name in the tab, plus "not in a series" and "group by series". |
| Discover, book sheet | Shows the series name and, with a number, "Book n". |
| Shelf | The same series filter and "group by series"; one card per book, never a stack. |
| Overview | Counts the series in the library. |

A series of one or two books is kept everywhere; it just never gets an **automatic** rail.

### 8.5 Move, rename, remove

- **Move one book** to another series: mode `"series"` with the other name and its number. One row.
- **Take one book out**: mode `"series"` with `series: ""`. The script deletes both fields.
- **Rename a series**: change the name on **every** row of it, or you get two half-series. Download
  the catalog, then:

```js
// scripts/rename-series.mjs — change one series name on every row, and nothing else.
import { readFileSync, writeFileSync } from "node:fs";
const [file, field, oldName, newName] = process.argv.slice(2);
const catalog = JSON.parse(readFileSync(file, "utf8"));
let changed = 0;
for (const row of catalog[field]) if (row.series === oldName) { row.series = newName; changed += 1; }
if (!changed) throw new Error(`no row has the series ${oldName}`);
catalog.updated = new Date().toISOString();
writeFileSync("catalog.next.json", `${JSON.stringify(catalog, null, 1)}\n`);
console.log({ changed, rows: catalog[field].length });
```

  Save it in staging's `scripts/` folder and run
  `node scripts/rename-series.mjs word-lists-catalog.json lists "Lantern St." "Lantern Street"`, then
  upload `catalog.next.json`. If a saved Discover rail names the old series, it must be renamed too
  (§8.6) or it will show nothing.
- **Remove a series entirely**: take the name off every row. When fewer than three books are left,
  the automatic rail disappears. A saved rail with that name shows whatever is left, or nothing.

### 8.6 A book's series vs a Discover rail

These are two different things that use the same word:

| | A book's series | A saved Discover rail |
| --- | --- | --- |
| Stored in | each catalog row: `series`, `seriesNumber` | one file, `word-lists/discover-rails.json` |
| Who changes it | anyone with R2 write (this page) | an admin, on `/admin/` → Series, or `PUT /api/admin/discover-rails` |
| What it groups | books that share the exact name | a series name, or a hand-picked list of books |
| Minimum | 3 books for an automatic rail | 1 book for a saved rail |
| Order | by `seriesNumber` | the saved order of rows |
| How many | the three largest, automatically | up to 12 rows per file, split by tab |

The live file looks like this (shortened):

```json
{ "format": 1, "updated": "2026-10-26T04:05:00.000Z", "rails": [
  { "source": "series", "name": "Magic Tree House" },
  { "source": "custom", "name": "Roald Dahl", "books": ["list:charlie", "list:matilda"] },
  { "source": "series", "name": "TED", "category": "speech" }
] }
```

- `source: "series"` follows the name, so books you later add to that series join the row by
  themselves. `source: "custom"` lists book keys in the order you want: `list:<id>` for a word-list
  book, `classic:<id>` for a bundled classic.
- `category: "speech"` puts a row on the Speeches tab. A row without it is on the Novels tab.
- **A saved file replaces the automatic rows on every tab.** Even an empty list does: a file with
  no speech row leaves the Speeches tab with no series rows. If you save rails, include every row
  you still want.
- A series rail needs the exact same name as the rows. Renaming a series without renaming its rail
  empties the rail.

**Do not edit `discover-rails.json` unless you were asked to.** It is the admin's editorial list,
not part of a book upload. Changing a book's series is enough for the automatic rows; a saved rail
follows a `source: "series"` name on its own.

### 8.7 Mistakes that break a series

| Mistake | Result |
| --- | --- |
| `seriesNumber` with no `series` | The number is ignored; the book has no series. |
| `"seriesNumber": "5"` written by hand as a string | The app reads a numeric string, but write a JSON number: other tools do not. |
| `seriesNumber` 0, 100, or a decimal | Dropped; the book goes last in the series. |
| Two spellings or two cases of one name | Two series, each with fewer books and possibly no rail. |
| Renaming one book of a series | That book leaves; the others stay in the old series. |
| Renaming a series but not its saved rail | The saved rail is empty. |
| Adding 2 books and expecting a rail | Automatic rails need 3 in the tab; save a rail for fewer. |
| Changing `series` and expecting the card's "updated" date to move | `updated` tracks the word list, not the series. |

### 8.8 Novel or speech

`category` is separate from the series. To move a book between tabs, mode `"series"` with
`category: "speech"` or `"novel"` (`"novel"` deletes the field). The weekly allowance follows the
category, so say in your report when you change it.

## 9. The catalog row, field by field

Change only the fields listed for your job. Keep every other row, every other field, and the order
of rows and fields exactly as they are. Keep the catalog's top-level `format` and `name`, and set
its `updated` to now. Write the catalog as JSON with a one-space indent
(`JSON.stringify(catalog, null, 1)`) and a newline at the end. `row.mjs` does this for you.

| Field | Value |
| --- | --- |
| `id` | The book's id. Never changes. |
| `title`, `author` | **New row only:** from the word list's own `title` / `author`; title required. Updates preserve live values, not incoming glossary metadata. |
| `lexile`, `isbn` | New row: only when the word list has them. Updates preserve live values unless explicitly reviewed for change. Never guess a measure or edition; compare ISBN with `isbnDigits`. |
| `words` | `Number(file.count) || Object.keys(file.glossary).length`, matching the admin publisher. Check the resulting count is intended; shared semantics: [versions](https://inputread.site/kit/maintenance.md#versions). |
| `paragraphs`, `sentences` | Length of the file's `paragraphs` / `sentences` array, 0 when missing. |
| `phrases` | Number of keys in the file's `phrases` object, 0 when missing. |
| `glossary` | `{ "url": "<id>/glossary.json", "bytes": <n>, "sha256": "<hex>" }`; a public book also has `"rev"` = the first 12 digits of the sha256. |
| `rev` (public only) | Glossary-only update: the same 12 digits. EPUB changes use the combined hash; identical bytes preserve the current revision. CPU gate and procedure: §7. |
| `epub` (public only, when it changed) | `{ "url": "<id>/book.epub", "bytes": <n>, "sha256": "<hex>" }`. |
| `cover` (when you uploaded one) | `{ "url": "https://books.inputread.site/covers/<lists or public>-<id>.jpg", "bytes": <n>, "sha256": "<hex>" }`. |
| `series`, `seriesNumber` | §8. A name alone is fine; a number is 1–99 and only with a name. |
| `category` | `"speech"` for a speech. For a novel, **remove** the field. |
| `previousUpdated` | When the glossary sha256 changed: the row's old `updated`. Otherwise leave it as it is. |
| `updated` | Now, as an ISO time (`2026-10-25T08:00:00.000Z`). |
| `added` | When the book first came to the catalog. Set it only on a new row, and **never change** it on an existing row: the new-books rail is ordered by it. |
| `version`, `chapters`, `coined`, `level`, `notes`, `zip` (public only) | Preserve the existing live values. They are not an instruction to rerun the retired build. |

A **new** copyrighted row looks like this (the order `row.mjs` writes):

```json
{
 "id": "the-lantern-seller",
 "title": "The Lantern Seller",
 "author": "Mei Lin",
 "lexile": "760L",
 "series": "Lantern Street",
 "seriesNumber": 1,
 "words": 912,
 "paragraphs": 40,
 "sentences": 0,
 "phrases": 120,
 "updated": "2026-10-26T05:00:00.000Z",
 "glossary": { "url": "the-lantern-seller/glossary.json", "bytes": 268451, "sha256": "…" },
 "cover": { "url": "https://books.inputread.site/covers/lists-the-lantern-seller.jpg", "bytes": 41233, "sha256": "…" },
 "added": "2026-10-26T05:00:00.000Z"
}
```

Before you write, check the new catalog against the one you read: the same ids plus at most your new
one, no id twice, and every other row's `glossary.sha256` unchanged. `row.mjs` refuses to write
otherwise. If you edit by hand and any of that fails, do not upload.

## 10. The cover

**Where readers get it.** Every card, on Discover and on the shelf, shows the cover named by the
catalog row's `cover` field, and only that one: nothing is taken from the EPUB, and nothing is
kept on the reader's device. The page loads it from

```
https://books.inputread.site/covers/<lists or public>-<id>.jpg?v=<first 12 hex digits of cover.sha256>
```

**Replacement checkpoint.** Follow the [cache/version rules](https://inputread.site/kit/maintenance.md#versions):
write the JPEG with `Cache-Control: public, max-age=31536000, immutable`, then set the catalog row's
`cover.bytes` and `cover.sha256` from those exact bytes. The new hash supplies the new `?v=`; a
same-key overwrite alone leaves readers using the old cached address.

To **remove** a cover, remove the row's `cover` field and leave the file. Keep `cover.url` under
`https://books.inputread.site/covers/...`, not the old `word-lists/<id>/cover.jpg` location.

**The file.** A JPEG, at most 400 px wide (the card is about 180 px; 400 covers sharp screens),
quality about 80, under 5 MB (a card-sized one is usually 20–60 KB). Portrait, about 2:3. Only a
picture you may use: the book's own cover from its EPUB, or one you were given. Some talks (TED)
may not use the event's picture: leave the cover out, and the speech look is drawn.

```
npx wrangler r2 object put "margin-words-books/covers/lists-<id>.jpg" --file cover.jpg \
  --content-type image/jpeg --cache-control "public, max-age=31536000, immutable" --remote
```

Then the row (§9): `"cover": { "url": "https://books.inputread.site/covers/lists-<id>.jpg", "bytes": <n>, "sha256": "<hex>" }`.

## 11. The story summary

Follow [BOOK_BLURBS — format, bilingual replacement and writing rules](https://inputread.site/kit/book-blurbs.md)
before preparing `blurb.json`. That page owns those rules and the admin/script alternatives.
After the row exists, use §3's publishing checkpoints and upload:

```
npx wrangler r2 object put "margin-words-books/word-lists/<id>/blurb.json" --file blurb.json \
  --content-type application/json --remote
```

For a public book use `public-books/<id>/blurb.json`. Verify the R2 readback; ordinary readers may
need a full page reload, not just reopening the sheet. See [cache behavior](https://inputread.site/kit/maintenance.md#versions).

## 12. After the upload

1. Verify R2 readbacks and the reader-facing checks (§5.9).
2. Only then clear and verify the work mark (§5.10).
3. Readers who already have the book see **Update** on its card when the word list changed. New
   readers find it on Discover under its category.
4. If you changed a series, open Discover: the book is in the rail and the detail sheet shows the
   number. With fewer than three books and no saved rail, no rail appears — that is expected.

## 13. Do not

- Do not upload a whole `dist-books/` folder, or a catalog made by `npm run build:books` or
  `build-packs`: they are rebuilt from git and would point other books at files that are not on the
  host.
- Do not put a copyrighted EPUB in `margin-words-books`, and do not upload any EPUB that you were
  not given for this job.
- Do not touch other books' rows, `contributors.json`, `avatars/`, other books' `covers/` or
  `blurb.json`, D1, or `word-lists/discover-rails.json` (unless the job is that list).
- Do not write a cover without `--cache-control "public, max-age=31536000, immutable"`, and never
  change a cover file without updating `cover.sha256` in the row (readers would keep the old one).
- Do not overwrite a live word list that the daily patrol has edited without bringing those edits
  over first: compare your file with the live `glossary.json` (§6), and keep words, phrases, senses
  and `credit` fields that the live file has and yours lacks, unless you were told to drop them.
- Do not change `added`, and do not change a series by editing only some of its books.

## 14. Report

End with a short report: the book id and title, the kind and category, every key you wrote, the new
glossary sha256 (first 12 digits), the cover sha256 (first 12) or "no cover", the series and number
(or "no series"), whether you wrote a summary (zh, en), and anything you skipped or that failed.
Include the instruction sources/retrieval time, checkout commit/dirty state when applicable,
original-byte hashes and local/hosted comparison result (or **unverified**), plus manual comparison
review and any fail-closed stop. Never include the token or book text beyond a title.
