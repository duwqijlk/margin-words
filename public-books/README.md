# public-books: the free classics

Only **public-domain** books go here. They are not copied into `dist/`. `npm run build:books` copies the loose
files (catalog, `book.epub`, `glossary.json`, `cover.jpg`) into `dist-books/public-books/` for the books host
(`https://books.inputread.site` by default). Copyrighted packs in `../packs/` are never copied. Their word lists
are a separate `word-lists/` tree, glossary files only, with a generated cover on the card.

Dev and `npm run build:local` serve this folder on the same origin so tests run offline.

## Add a book (no code change)

1. Make a folder `public-books/<id>/` (id: small letters, numbers, `-`, `_`) with
   - `book.epub`
   - `glossary.json` (validate: `node scripts/validate-glossary.mjs public-books/<id>/book.epub public-books/<id>/glossary.json`)
   - `cover.jpg` (optional; the cover image inside the EPUB is a good source)
   - `info.json`: `{ "title": "...", "author": "...", "order": 13, "notes": "Free classic. Public domain in the USA.", "lexile": "880L" }`
     (`"lexile"` is optional, a published measure such as `880L`; see `docs/LEXILE_SOURCES.md`.
     `"preinstall": true` puts the book on every new shelf. Leave `preinstall` out and the book stays a
     one-tap download in "Free books". The twelve classics all set `preinstall`.)
2. Rebuild the catalog and the local sideload zips: `node scripts/build-packs.mjs --out public-books`
3. `npm run build:books`, then upload `dist-books/`. The hosted catalog sets each `zip` to null and omits
   `all-packs.zip`. The app downloads the loose files.
4. First run: the app puts every pack with `"preinstall": true` on the shelf (all twelve classics).
   The app remembers a book the user deleted (`localStorage` key `cibian-removed-packs-v1`) and never
   re-adds it by itself; downloading it again from "Free books" clears that.

Offline: the service worker does **not** download books during install. After the app fetches a classic
(the first-run shelf install, or a later download), it keeps that CORS response so the book can be
opened again offline. Books already on the shelf live in IndexedDB.

`node scripts/build-packs.mjs --out public-books --check` fails when `catalog.json` or a local zip is out of date.
Those zips are for the check and for sideload. They are not uploaded.

Looking-Glass illustrations are black line art. The PNG alpha was flattened to one bit so the EPUB is about
3.4 MB instead of about 9.4 MB. The chapter text was not edited, so glossary anchors still match.
