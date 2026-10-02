# public-books: the free classics that ship with the app

Only **public-domain** books go here. This folder is copied into `dist/public-books/` by the build and is the
ONLY book folder that is deployed. The copyrighted packs in `../packs/` are never copied into `dist`.

## Add a book (no code change)

1. Make a folder `public-books/<id>/` (id: small letters, numbers, `-`, `_`) with
   - `book.epub`
   - `glossary.json` (validate: `node scripts/validate-glossary.mjs public-books/<id>/book.epub public-books/<id>/glossary.json`)
   - `cover.jpg` (optional; the cover image inside the EPUB is a good source)
   - `info.json`: `{ "title": "...", "author": "...", "order": 13, "notes": "Free classic. Public domain in the USA." }`
     (add `"preinstall": true` only if the book must be on every new shelf; leave it out and the book is a
     one-tap download in "Free books")
2. Rebuild the catalog and the zips: `node scripts/build-packs.mjs --out public-books`
3. `npx vite build`. A new book appears in the "Free books" list (with its cover) for a one-tap download.
   First run: the app puts only the packs with `"preinstall": true` on the shelf (alice, treasure-island,
   anne), so the first load stays light. Everything else waits in "Free books". The app remembers a book the
   user deleted (`localStorage` key `cibian-removed-packs-v1`) and never re-adds it by itself;
   downloading it again from "Free books" clears that.
4. Offline: the service worker precaches only `catalog.json`, every cover and the `preinstall` books. Any other
   classic is saved by the service worker the first time the app downloads it. Books already on the shelf live
   in IndexedDB and always work offline.

Limits: Cloudflare Pages allows at most 25 MiB per file. If an EPUB is bigger, shrink its images first and put the
new `sha256` into `glossary.json` (looking-glass was shrunk this way: its Tenniel illustrations are alpha PNGs
that were re-quantized and the `-2x` ones downscaled; the text did not change, so every anchor still matches).

`node scripts/build-packs.mjs --out public-books --check` fails when `catalog.json` or a zip is out of date.
