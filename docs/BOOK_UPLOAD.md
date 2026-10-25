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
3. Cover, when you have one: `margin-words-books/covers/lists-<id>.jpg`, with the cache-control
   above. Compute its `sha256` and byte count.
4. Read `margin-words-books/word-lists/catalog.json` again, just before writing. Change **only this
   book's row** (section 6), set the top-level `updated` to now, and write it back.

## 5. Upload a public-domain book (`public`)

A public book can be updated here, but a **brand-new** public book cannot: its catalog row carries
fields (`version`, `chapters`, `coined`) that come from the offline build
(`node scripts/publish-public-book.mjs <id>`). If `<id>` is not in `public-books/catalog.json`,
stop and say so.

1. `margin-words-books/public-books/<id>/book.epub`, when the EPUB changed.
2. `margin-words-books/public-books/<id>/glossary.json`: the exact bytes you checked.
3. Cover, when you have one: `margin-words-books/covers/public-<id>.jpg`, with the cache-control
   above.
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

## 7. After the upload

1. If `margin-words-books/word-lists/glossary-work.json` lists this book (`{"kind": "lists" or
   "public", "id": "<id>"}` in `items`), remove that item, set `updated` to now, and write the file
   back. It marks books an admin is still working on. A missing file is fine.
2. Check the result from outside:
   - `https://books.inputread.site/word-lists/catalog.json` (or `public-books/catalog.json`) shows
     the new row values. The catalog may take a minute to refresh.
   - The cover address in the row opens.
   - `https://books.inputread.site/<word-lists or public-books>/<id>/glossary.json` answers **403**.
     That is right: readers get word lists only through the site's account API, which counts the
     weekly allowance.
3. Readers who already have the book see **Update** on its card. New readers find it on Discover
   under its category.

## 8. Do not

- Do not upload a whole `dist-books/` folder, or a catalog made by `npm run build:books` or
  `build-packs`: they are rebuilt from git and would point other books at files that are not on
  the host.
- Do not put a copyrighted EPUB in `margin-words-books`, and do not upload any EPUB that you were
  not given for this job.
- Do not touch other books' rows, `contributors.json`, `avatars/`, `covers/` of other books, or D1.
- Do not overwrite a live word list that the daily patrol has edited without bringing those edits
  over first: compare your file with the live `glossary.json`, and keep words, phrases, senses and
  `credit` fields that the live file has and yours lacks, unless you were told to drop them.

## 9. Report

End with a short report: the book id and title, the kind and category, every key you wrote, the new
glossary sha256 (first 12 digits), and anything you skipped or that failed. Never include the token
or book text beyond a title.
