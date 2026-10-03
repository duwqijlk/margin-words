# public-books: the public-domain books

Only **public-domain** books go here. They are not copied into `dist/`. `npm run build:books` copies the loose
files (catalog, `book.epub`, `glossary.json`, `cover.jpg`) into `dist-books/public-books/` for the books host
(`https://books.inputread.site` by default). Copyrighted packs in `../packs/` are never copied here. Their
word lists are a separate `word-lists/` tree (glossary, plus a card-sized cover when `packs/<id>/cover.jpg`
exists). A list with no cover uses the generated title-and-author cover. The copyrighted EPUBs are
`npm run build:private` (`dist-private/`), for the private bucket only.

Dev and `npm run build:local` serve this folder on the same origin so tests run offline.

## Add a book (no code change)

1. Make a folder `public-books/<id>/` (id: small letters, numbers, `-`, `_`) with
   - `book.epub`
   - `glossary.json` (validate: `node scripts/validate-glossary.mjs public-books/<id>/book.epub public-books/<id>/glossary.json`)
   - `cover.jpg` (optional; the cover image inside the EPUB is a good source)
   - `info.json`: `{ "title": "...", "author": "...", "order": 13, "notes": "Public domain in the USA.", "lexile": "880L" }`
     (`"lexile"` is optional, a published measure such as `880L`; see `docs/LEXILE_SOURCES.md`.
     No book is put on a new shelf by itself: every classic stays on Discover until the reader adds it.
     (An old `"preinstall"` key is ignored.)
     `"oldFashioned": true` plus an optional `"oldFashionedReason"` marks English that is too old for a
     beginner. Do not flag a book only because it was published long ago. The rule used here: the book is
     from 1911 or earlier (every book in this folder is) AND either the glossary is at least 1.5% archaic
     lemmas with at least 5 of them (`thou`, `thee`, `hath`, `quoth`, `anon`, and the like), OR the Lexile
     is 1050L or higher and there are at least 5 archaic lemmas. That flags The Jungle Book, Through the
     Looking-Glass, Peter and Wendy, and The Wind in the Willows. Alice is not flagged.)
2. Rebuild the catalog and the local sideload zips: `node scripts/build-packs.mjs --out public-books`
3. `npm run build:books`, then upload `dist-books/`. The hosted catalog sets each `zip` to null and omits
   `all-packs.zip`. The app downloads the loose files when the reader adds the book.
4. First run: the shelf is empty. The empty shelf suggests Alice with a one-tap add, and Discover lists every
   classic. Books already on a device stay there. A book the user deleted stays off the shelf until it is
   added again (`localStorage` key `cibian-removed-packs-v1` is still written for compatibility).

Offline: the service worker does **not** download books during install. After the app fetches a classic
(Alice on a new shelf, or a later download from Discover), it keeps that CORS response so the book can be
opened again offline. Books already on the shelf live in IndexedDB.

`node scripts/build-packs.mjs --out public-books --check` fails when `catalog.json` or a local zip is out of date.
Those zips are for the check and for sideload. They are not uploaded.

Looking-Glass illustrations are black line art. The PNG alpha was flattened to one bit so the EPUB is about
3.4 MB instead of about 9.4 MB. The chapter text was not edited, so glossary anchors still match.
