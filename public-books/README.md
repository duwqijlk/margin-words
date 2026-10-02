# public-books: the free classics that ship with the app

Only **public-domain** books go here. This folder is copied into `dist/public-books/` by the build and is the
ONLY book folder that is deployed. The copyrighted packs in `../packs/` are never copied into `dist`.

## Add a book (no code change)

1. Make a folder `public-books/<id>/` (id: small letters, numbers, `-`, `_`) with
   - `book.epub`
   - `glossary.json` (validate: `node scripts/validate-glossary.mjs public-books/<id>/book.epub public-books/<id>/glossary.json`)
   - `cover.jpg` (optional; the cover image inside the EPUB is a good source)
   - `info.json`: `{ "title": "...", "author": "...", "order": 13, "notes": "Free classic. Public domain in the USA.", "lexile": "880L" }`
     (`"lexile"` is optional, a published measure such as `880L`; see `docs/LEXILE_SOURCES.md`.
     `"preinstall": true` puts the book on every new shelf. Leave `preinstall` out and the book stays a
     one-tap download in "Free books". The twelve classics all set `preinstall`.)
2. Rebuild the catalog and the zips: `node scripts/build-packs.mjs --out public-books`
3. `npx vite build`. A new book appears in the "Free books" list (with its cover).
   First run: the app puts every pack with `"preinstall": true` on the shelf (all twelve classics).
   The app remembers a book the user deleted (`localStorage` key `cibian-removed-packs-v1`) and never
   re-adds it by itself; downloading it again from "Free books" clears that. A book that was never
   installed is not in that list, so an existing shelf receives a newly preinstalled book once.
4. Offline: the service worker precaches `catalog.json`, every cover, and preinstall books whose EPUB is
   at most 400 KiB (Alice, Treasure Island, Anne). Larger classics are copied into IndexedDB on first start
   when the app is online, and the service worker keeps a copy the first time that fetch happens.
   Books already on the shelf live in IndexedDB and always work offline.

Limits: Cloudflare Pages allows at most 25 MiB per file. If an EPUB is bigger, shrink its images first and put the
new `sha256` into `glossary.json` (looking-glass was shrunk this way: its Tenniel illustrations are alpha PNGs
that were re-quantized and the `-2x` ones downscaled; the text did not change, so every anchor still matches).

`node scripts/build-packs.mjs --out public-books --check` fails when `catalog.json` or a zip is out of date.
