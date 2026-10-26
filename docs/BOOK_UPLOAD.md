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

## 0. Words this page uses

| Term | What it means |
| --- | --- |
| **book** | One title a reader can add. It has files and one catalog row. |
| **word list** (词典) | The `glossary.json` file: the words, meanings and help for one book. [Glossary format](https://github.com/duwqijlk/margin-words/blob/main/docs/GLOSSARY_FORMAT.md). |
| **catalog** | A JSON file that lists books. Discover reads only this, never a folder. |
| **row** | One book's object inside a catalog: id, title, author, counts, series, cover address. |
| **id** | The book's short name in addresses: lower-case letters, digits, `-`, `_`, starting with a letter or digit, at most 64 characters (`^[a-z0-9][a-z0-9_-]{0,63}$`). |
| **kind** | `lists` = a copyrighted book (trusted readers only). `public` = a public-domain book (everyone). |
| **category** | `"speech"` for a talk, address or lecture; nothing at all for a novel. Picks the Discover tab and the weekly allowance. |
| **series** | Two fields on the row, `series` (a name) and `seriesNumber` (1, 2, 3 …). Books with the same name are one series. |
| **Discover rail** | A sideways row of covers on Discover. The three largest series get one automatically; an admin can also save its own rows. |
| **books host** | `https://books.inputread.site`, the public address of the `margin-words-books` bucket. |

## 1. Pick your job

| You were asked to… | Go to |
| --- | --- |
| Add a **new copyrighted book** (EPUB + word list, novel or speech) | §5 |
| Replace or improve **only the word list** of a book that is live | §6 |
| Replace the **EPUB** of a book that is live | §7 |
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
   dropping a trailing edition label (`: A Novel`, `: A Memoir`, `(A Novel)` and the like). A file
   with no `title` counts as the same book. If the titles differ, stop: the file is another book and
   needs its own id.
5. **No second id for one book.** For a new `<id>`, no row in either catalog may have the same
   title (compared the same way). If one does, the id is wrong: use that row's id.

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

Then look for the id and the title in both. Save this as `scripts/find-book.mjs` and run from staging
`node scripts/find-book.mjs the-lantern-seller "The Lantern Seller"`:

```js
// Is this book already live? The title comparison is the one the site uses (§4.4).
import { readFileSync } from "node:fs";
const EDITION = "a novel|a memoir|a biography|a true story|an autobiography|a novella|a graphic novel";
const norm = (value) => String(value)
  .replace(new RegExp(`\\s*[:：]\\s*(?:${EDITION})\\s*$`, "i"), "")
  .replace(new RegExp(`\\s*[-–—]\\s*(?:${EDITION})\\s*$`, "i"), "")
  .replace(new RegExp(`\\s*\\((?:${EDITION})\\)\\s*$`, "i"), "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "");
const [id, title] = process.argv.slice(2);
for (const file of ["word-lists-catalog.json", "public-catalog.json"]) {
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  const rows = catalog.lists ?? catalog.packs;
  const hit = rows.find((row) => row.id === id || norm(row.title) === norm(title));
  console.log(file, hit ? `TAKEN: ${hit.id} — ${hit.title}` : "free");
}
```

- Both say `free`: it is a new book. Continue.
- The id is taken and the title is the same book: it is not new. Go to §6 (word list) or §7 (EPUB).
- The title is taken under **another id**: use that id. One book, one id.
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

The row is built from the word list's own metadata (`title`, `author`, `lexile`, `isbn`, `series`,
`seriesNumber`, `category`) plus counts and exact-byte hashes, following the
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
  row.glossary = { url: `${JOB.id}/glossary.json`, bytes: bytes.length, sha256: sha };
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

The script checks ids and the other rows' hashes, but it cannot see the **other** catalog: the
title-clash check in §5.2 is the one that catches a second id for a book that is already live.

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

2. **Compare before you overwrite.** Save this as `scripts/compare.mjs` and run from staging
   `node scripts/compare.mjs live-glossary.json glossary.json`:

```js
import { readFileSync } from "node:fs";
const [live, next] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const words = (file) => file.glossary ?? {};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dropped = Object.keys(words(live)).filter((w) => !(w in words(next)));
const changed = Object.keys(words(live)).filter((w) => w in words(next) && !same(words(live)[w], words(next)[w]));
const credits = (file) => {
  const out = [];
  for (const [w, entry] of Object.entries(words(file))) {
    if (typeof entry?.credit === "string") out.push(`${w}=${entry.credit}`);
    (entry?.senses ?? []).forEach((s, i) => { if (typeof s?.credit === "string") out.push(`${w}#${i + 1}=${s.credit}`); });
  }
  return out;
};
const kept = new Set(credits(next).map((c) => c.split("=")[1]));
const lostCredits = credits(live).filter((c) => !kept.has(c.split("=")[1]));
const lostPhrases = Object.keys(live.phrases ?? {}).filter((p) => !(p in (next.phrases ?? {})));
console.log({ dropped, changed: changed.slice(0, 50), changedCount: changed.length, lostCredits, lostPhrases });
```

3. **Merge until every difference is intended.** For each dropped word, each lost credit and each
   lost phrase, copy it from the live file into yours. For a word whose entry changed, look at both:
   if the live meaning is the patrol's fix, keep the live entry; if your file is the intended new
   text, keep yours. When you cannot tell, keep the live entry and report the difference instead of
   guessing. Then run the comparison again.

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

**Public-domain book.** Put `public-books/<id>/book.epub`, then set the row's `epub` to
`{ "url": "<id>/book.epub", "bytes": <n>, "sha256": "<hex>" }` and `updated` to now, and upload the
catalog. `row.mjs` does not write `epub`; edit that one field by hand after the script, or use the
admin **Books** tab.

## 8. Job D — series

### 8.1 What a series is

A series is two fields on the row and nothing else:

```json
{ "id": "mth05", "title": "Magic Tree House 5: Night of the Ninjas",
  "series": "Magic Tree House", "seriesNumber": 5 }
```

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

Use the name exactly as it appears (for example `Magic Tree House`), then run `row.mjs` from §5.6
in mode `"series"`:

```js
const JOB = {
  mode: "series",
  kind: "lists",
  id: "mth05",
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
| `title`, `author` | From the word list's own `title` / `author`. A new book needs a title. |
| `lexile`, `isbn` | Only when the word list has them. Never guess a measure or an edition. |
| `words` | `Number(file.count) || Object.keys(file.glossary).length`, matching the admin publisher. Check the resulting count is intended; shared semantics: [versions](https://inputread.site/kit/maintenance.md#versions). |
| `paragraphs`, `sentences` | Length of the file's `paragraphs` / `sentences` array, 0 when missing. |
| `phrases` | Number of keys in the file's `phrases` object, 0 when missing. |
| `glossary` | `{ "url": "<id>/glossary.json", "bytes": <n>, "sha256": "<hex>" }`; a public book also has `"rev"` = the first 12 digits of the sha256. |
| `rev` (public only) | The same 12 digits. |
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
Never include the token or book text beyond a title.
