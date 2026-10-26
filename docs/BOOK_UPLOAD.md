# Uploading a book with wrangler (for an AI agent)

Read this whole page before you start. It is the job description for an agent that puts one book
on inputread.site, or replaces the word list or files of one book, with **wrangler** and a
Cloudflare login. It does the same job as the admin page's **Books** tab
(`functions/api/admin/word-lists.ts` and `functions/api/admin/books.ts`), so a book uploaded either
way ends up the same. You do not need a site login, a build or a deploy. The page is also in the
repository as `docs/BOOK_UPLOAD.md` and on the site at `https://inputread.site/kit/book-upload.md`.

Nothing in git changes when you upload a book: `packs/` and `public-books/` in the repository are a
frozen snapshot, and the live buckets are the only source. Do not add the book to `packs/`, do not
commit its files, and do not open a pull request for it.

Use this page for **one book at a time**. To fix readers' reports in a live list, follow
`docs/GLOSSARY_PATROL.md` instead.

## 1. What a book is on the site

Every book has a **word list** (`glossary.json`, format in `docs/GLOSSARY_FORMAT.md`) and a row in a
catalog. Discover reads only the catalogs. Two kinds:

| Kind | Who may read the EPUB | Word list | EPUB | Catalog |
| --- | --- | --- | --- | --- |
| Copyrighted (`lists`) | Trusted readers only | `margin-words-books`: `word-lists/<id>/glossary.json` | `margin-words-private`: `<id>/book.epub` | `margin-words-books`: `word-lists/catalog.json`, field `lists` |
| Public domain (`public`) | Everyone | `margin-words-books`: `public-books/<id>/glossary.json` | `margin-words-books`: `public-books/<id>/book.epub` | `margin-words-books`: `public-books/catalog.json`, field `packs` |

Both kinds also have, in `margin-words-books`:

| File | Key | Section |
| --- | --- | --- |
| Discover card cover | `covers/lists-<id>.jpg` or `covers/public-<id>.jpg` | 7 |
| Story summary (Discover's book sheet) | `word-lists/<id>/blurb.json` or `public-books/<id>/blurb.json` | 8 |

The cover and the summary are optional. Without a cover the app draws a title-and-author cover
(a speech gets its own quotation-mark look); without a summary the sheet shows none.

Every book also has a **category**: a novel (no `category` field) or a speech
(`"category": "speech"`). The category picks the Discover tab (Novels / Speeches) and the weekly
allowance it uses: a plain reader may open 7 new novels and 7 new speeches in a rolling 7 days, and
the server reads the category from these catalogs to count them. Ask the person who gave you the
book which it is when you cannot tell. A talk, address or lecture is a speech.

`<id>` is the book's id: lower-case letters, digits, `-` and `_`, starting with a letter or digit,
at most 64 characters (`^[a-z0-9][a-z0-9_-]{0,63}$`). Use the id you were given. For a new book,
make one from the title (`the-lantern-seller`).

## 2. Access

- `npx wrangler login` once, or `CLOUDFLARE_API_TOKEN` set in the environment. The token needs
  **Workers R2 Storage Edit** on account `6ece9f6dbbc73db1be2810fb39f277c3`. Never print the token,
  put it in a file, or send it anywhere but Cloudflare.
- Always pass `--remote`. Without it wrangler writes to a local copy and nothing reaches the site.
- The commands:

```
read   npx wrangler r2 object get "<bucket>/<key>" --file <local file> --remote
write  npx wrangler r2 object put "<bucket>/<key>" --file <local file> --content-type <type> --remote
```

Content types: `application/json` for `.json`, `application/epub+zip` for `.epub`,
`image/jpeg` for covers. A cover also gets `--cache-control "public, max-age=31536000, immutable"`.

Work in a new empty folder. Download every file you change, edit the local copy, and upload that
exact file.

## 3. Check the files before you upload

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

## 4. Upload a copyrighted book (`lists`)

Upload in this order. The catalog goes last, so readers only see the new files when they are all
there.

1. `margin-words-private/<id>/book.epub` (and `margin-words-private/<id>/cover.jpg` when you have a
   cover). This bucket is never public. Do not put the EPUB anywhere else.
2. `margin-words-books/word-lists/<id>/glossary.json`: the exact bytes you checked. Compute the
   `sha256` (lower-case hex) and the byte count of exactly that file.
3. Cover, when you have one: `margin-words-books/covers/lists-<id>.jpg`, exactly as section 7 says
   (the cache-control matters). Compute its `sha256` and byte count.
4. Read `margin-words-books/word-lists/catalog.json` again, just before writing. Change **only this
   book's row** (section 6), set the top-level `updated` to now, and write it back.

## 5. Upload a public-domain book (`public`)

A public book can be updated here, but a **brand-new** public book cannot: its catalog row carries
fields (`version`, `chapters`, `coined`) that come from the offline build
(`node scripts/publish-public-book.mjs <id>`). If `<id>` is not in `public-books/catalog.json`,
stop and say so.

1. `margin-words-books/public-books/<id>/book.epub`, when the EPUB changed.
2. `margin-words-books/public-books/<id>/glossary.json`: the exact bytes you checked.
3. Cover, when you have one: `margin-words-books/covers/public-<id>.jpg`, exactly as section 7 says.
4. Read `margin-words-books/public-books/catalog.json` again, change only this book's row
   (section 6), set the top-level `updated` to now, and write it back.

## 6. The catalog row

Change these fields and nothing else. Keep every other row, every other field, and the order of
rows and fields exactly as they are. Write the catalog as JSON with a one-space indent
(`JSON.stringify(catalog, null, 1)`) and a newline at the end.

| Field | Value |
| --- | --- |
| `words` | the file's `count` if it is a number above 0, else the number of keys in `glossary` |
| `paragraphs`, `sentences` | length of the file's `paragraphs` / `sentences` array, 0 when missing |
| `phrases` | number of keys in the file's `phrases` object, 0 when missing |
| `glossary` | `{ "url": "<id>/glossary.json", "bytes": <n>, "sha256": "<hex>" }`; a public book also has `"rev"` = the first 12 digits of the sha256 |
| `rev` (public only) | the same 12 digits |
| `epub` (public only, when it changed) | `{ "url": "<id>/book.epub", "bytes": <n>, "sha256": "<hex>" }` |
| `cover` (when you uploaded one) | `{ "url": "https://books.inputread.site/covers/<lists or public>-<id>.jpg", "bytes": <n>, "sha256": "<hex>" }` |
| `previousUpdated` | when the glossary sha256 changed: the row's old `updated`. Otherwise leave it as it is |
| `updated` | now, as an ISO time (`2026-10-25T08:00:00.000Z`) |
| `category` | `"speech"` for a speech. For a novel, **remove** the field |
| `isbn` | only when you were given one: set it, or remove it to clear it |

A **new** copyrighted book is a new row at the end of `lists`, made from the file's own fields:

```
{
 "id": "<id>",
 "title": "<file title>",
 "author": "<file author, or empty>",
 "lexile": "<file lexile, only if set>",
 "isbn": "<file isbn, only if set>",
 "series": "<file series, only if set>",
 "seriesNumber": <only with series>,
 "category": "speech",            <- only for a speech
 "words": ..., "paragraphs": ..., "sentences": ..., "phrases": ...,
 "updated": "<now>",
 "glossary": { "url": "<id>/glossary.json", "bytes": ..., "sha256": "..." },
 "cover": { ... },                 <- only when you uploaded one
 "added": "<now>"
}
```

`added` is when the book first came to the catalog. Set it only on a new row, and **never change**
it on an existing row: the new-books rail on Discover is ordered by it.

Before you write, check the new catalog against the one you read: the same ids plus at most your new
one, no id twice, and every other row's `glossary.sha256` unchanged. If any of that fails, do not
write.

## 7. The cover

**Where readers get it.** Every card, on Discover and on the shelf, shows the cover named by the
catalog row's `cover` field, and only that one: nothing is taken from the EPUB, and nothing is
kept on the reader's device. The page loads it from

```
https://books.inputread.site/covers/<lists or public>-<id>.jpg?v=<first 12 hex digits of cover.sha256>
```

**Why the `?v=` matters.** Covers are cached for a year: by the browser and by Cloudflare's CDN
(a cache rule on `/covers/`), because the file is stored with
`Cache-Control: public, max-age=31536000, immutable`. A cached copy is never checked again. A
replaced cover is seen only because its new `sha256` makes a new `?v=` address. So:

- To **add or replace** a cover: write the JPEG to the same key, then put its new `bytes` and
  `sha256` (of exactly the uploaded bytes) in the catalog row. The page asks for the new address
  and the old cached file is simply never asked for again. Forgetting the catalog update leaves
  every reader on the old picture for up to a year.
- To **remove** a cover: remove the row's `cover` field. Leave the file; nothing links to it.
- Never write a cover without the cache header, and never point `cover.url` anywhere but
  `https://books.inputread.site/covers/...` (not `word-lists/<id>/cover.jpg`: that old place is
  not cached as above and is no longer used).

**The file.** A JPEG, at most 400 px wide (the card is about 180 px; 400 covers sharp screens),
quality about 80, under 5 MB (a card-sized one is usually 20–60 KB). Portrait, about 2:3. Only a
picture you may use: the book's own cover from its EPUB, or one you were given. Some talks (TED)
may not use the event's picture: leave the cover out, and the speech look is drawn.

```
npx wrangler r2 object put "margin-words-books/covers/lists-<id>.jpg" --file cover.jpg \
  --content-type image/jpeg --cache-control "public, max-age=31536000, immutable" --remote
```

Then the row (section 6): `"cover": { "url": "https://books.inputread.site/covers/lists-<id>.jpg", "bytes": <n>, "sha256": "<hex>" }`.

## 8. The story summary

Discover's book sheet shows a short summary of the story. It is one file per book, next to the
word list, and it is **not** in the catalog, the word list or D1:

```
margin-words-books/word-lists/<id>/blurb.json      a word-list book
margin-words-books/public-books/<id>/blurb.json    a public-domain book

{ "format": 1, "zh": "中文简介", "en": "Simple English summary" }
```

- The sheet shows `zh` in the Chinese interface and `en` in the English one, never the other
  language instead. A missing language shows no summary there. Write both.
- Plain text, at most 600 characters each; line breaks are kept. No HTML, no Markdown
  (`**`, `#`, `[..](..)`). `zh` must contain Chinese; `en` must not.
- The `<id>` must already be in that catalog: write the summary after the catalog row exists.
- Writing the file **replaces** the book's summary: keep the other language when you change one.
- Upload with `--content-type application/json` and no special cache header (the sheet asks for it
  fresh each time, so a change shows up at once).

How to write it (the same rules as `docs/BOOK_BLURBS.md`):

- `zh` for junior-high readers; `en` in simple English (CEFR A2–B1), like the word list's meanings.
- 2–4 sentences: who the main character is, where the story starts, what the main problem is.
- In your own words. Never copy a publisher's, a shop's or a review's text: they are copyrighted.
- No ending, no twist, no praise ("a classic", "must read"). If you are not sure of a detail, leave
  it out rather than guess.
- For a speech: who speaks, to whom and when, and the one main idea.

```
npx wrangler r2 object put "margin-words-books/word-lists/<id>/blurb.json" --file blurb.json \
  --content-type application/json --remote
```

The admin page (`/admin/` → 简介) and `node scripts/publish-blurbs.mjs` write the same file with
the same checks; use them when you have the repository or an admin login.

## 9. After the upload

1. If `margin-words-books/word-lists/glossary-work.json` lists this book (`{"kind": "lists" or
   "public", "id": "<id>"}` in `items`), remove that item, set `updated` to now, and write the file
   back. It marks books an admin is still working on. A missing file is fine.
2. Check the result from outside:
   - `https://books.inputread.site/word-lists/catalog.json` (or `public-books/catalog.json`) shows
     the new row values. The catalog may take a minute to refresh.
   - The cover opens at `<cover.url>?v=<first 12 of cover.sha256>` and answers with
     `Cache-Control: public, max-age=31536000, immutable`. Check the header:
     `curl -sI "<that address>" | grep -i cache-control`.
   - `https://books.inputread.site/<word-lists or public-books>/<id>/blurb.json` shows the summary,
     when you wrote one.
   - `https://books.inputread.site/<word-lists or public-books>/<id>/glossary.json` answers **403**.
     That is right: readers get word lists only through the site's account API, which counts the
     weekly allowance.
3. Readers who already have the book see **Update** on its card. New readers find it on Discover
   under its category.

## 10. Do not

- Do not upload a whole `dist-books/` folder, or a catalog made by `npm run build:books` or
  `build-packs`: they are rebuilt from git and would point other books at files that are not on
  the host.
- Do not put a copyrighted EPUB in `margin-words-books`, and do not upload any EPUB that you were
  not given for this job.
- Do not touch other books' rows, `contributors.json`, `avatars/`, other books' `covers/` or
  `blurb.json`, or D1.
- Do not write a cover without `--cache-control "public, max-age=31536000, immutable"`, and never
  change a cover file without updating `cover.sha256` in the row (readers would keep the old one).
- Do not overwrite a live word list that the daily patrol has edited without bringing those edits
  over first: compare your file with the live `glossary.json`, and keep words, phrases, senses and
  `credit` fields that the live file has and yours lacks, unless you were told to drop them.

## 11. Report

End with a short report: the book id and title, the kind and category, every key you wrote, the new
glossary sha256 (first 12 digits), the cover sha256 (first 12) or "no cover", whether you wrote a
summary (zh, en), and anything you skipped or that failed. Never include the token
or book text beyond a title.
