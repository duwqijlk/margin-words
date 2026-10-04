# Margin Words

> **Private archive.** This copy is renamed to `duwqijlk/margin-words-archive`, kept private, and archived. Do not push code here. Development continues in the public repository [duwqijlk/margin-words](https://github.com/duwqijlk/margin-words). Record: [docs/ARCHIVE.md](docs/ARCHIVE.md).

A reader for English novels. Tap a word to see a simple English meaning. Made for Chinese junior-high
learners. The app (buttons, menus, messages) comes in **Simplified Chinese and English**: use the
**中文 / English** button in the top bar, or Settings. The books and their meanings stay in English.

中文简介：[README.zh-CN.md](README.zh-CN.md)

Moving the project to a new machine or repo: see [MIGRATION.md](MIGRATION.md).

## Make your own book pack

**The app does not accept a standalone EPUB.** Only a processed book, a **book pack**, can be added: ONE `.zip` with
exactly `book.epub` + `glossary.json` (title, author and cover come from the EPUB). The exact rules ("Required files")
are in [docs/book-pack-spec.md](docs/book-pack-spec.md), section 3.

Give **`book-pack-kit.zip`** to an AI agent. It holds `book-pack-spec.md` (the full format and workflow, written for
an AI), a sample book (*The Lantern Seller*, EPUB), its sample word list (`glossary.json`), and
`the-lantern-seller.pack.zip`, a ready-to-add sample pack (`book.epub` + `glossary.json`).
Download it in the app: the Guide and Settings link to "How to make a book pack" (page `/kit/`).
Make a pack from your own files: `node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip`.
Build it yourself: `npm run build:kit` (sources: `docs/book-pack-spec.md` and `examples/sample-book/`).
Check the sample and the spec: `npm run check:example`.

## Run it

```
npm install
npm run dev          # http://localhost:8080 (also serves ./packs)
npx vite build       # static app in dist/
```

## Reader and book packs

**The reader is a static app.** `dist/` is plain files (HTML, JS, CSS, fonts). It has no AI. Open it from
any static host (Vercel, GitHub Pages, S3, nginx, `python3 -m http.server`). Reading needs no account:
books already on a device stay readable. Adding new books asks for a sign-in.
Optional sign-in (sync across devices) is a Cloudflare Pages Function next to the static files. See
[docs/ACCOUNTS.md](docs/ACCOUNTS.md). Without those functions the rest of the app is unchanged.
The reader loads **twelve free public-domain classics** from the books host (`public-books/`). A new shelf starts **empty**: it points to Discover and suggests Alice as a first book (the suggestion card links to Discover), and Alice is added, removed and kept like any other book. A shelf that already has Alice keeps it. Every book is on **Discover** and download when you tap the heart on the cover. A book you delete is not added again; adding it from Discover clears that. Books already on a device stay there. To add a classic, drop a folder in `public-books/` and rebuild (see `public-books/README.md`). Copyrighted titles are **word lists** on the same host (`word-lists/<id>/glossary.json`, plus a card-sized `cover.jpg` taken from `packs/<id>/cover.jpg` when that file exists). A list with no cover uses the generated title-and-author cover. Adding one downloads the word list only and asks for your own e-book of that ISBN. The copyrighted EPUBs are not on the public host.

All meanings, simple versions, sentence explanations, phrases and examples come from the word list
(`glossary.json`) of the book. A word that is not in the list shows "No meaning for this word in this book yet."

### Where the books are

The copyrighted books are in the top-level folder **`packs/`** (not in `public/`, so they are not in the app bundle). Nine of them include `book.epub`. The Narnia collection is a word list only (`packs/narnia/glossary.json`, no EPUB):

```
packs/catalog.json         list of books (id, title, author, level/notes, sizes, sha256, rev, file URLs)
packs/<id>/book.epub       the book
packs/<id>/glossary.json   its word list
packs/<id>.zip             the same pack as one file
packs/all-packs.zip        all packs in one zip
```

Full format: [docs/PACKS_FORMAT.md](docs/PACKS_FORMAT.md). Word list format: [docs/GLOSSARY_FORMAT.md](docs/GLOSSARY_FORMAT.md).
Rebuild the folder after you change a book or list: `node scripts/build-packs.mjs`.

### Host the app and the books

1. Build the front end: `npx vite build` (output: `dist/`, a few MB, no book files). Deploy that to Cloudflare Pages.
   The production build fetches books from `https://books.inputread.site`. Set `VITE_BOOKS_BASE` to use another host.
   `npm run build:local` leaves book URLs on the same origin for offline tests.
2. Build the book objects: `npm run build:books` (output: `dist-books/`). Upload every file, using its path as the
   object key (`public-books/...`, `word-lists/...`). There is no per-book zip and no `all-packs.zip` in this folder.
   The app downloads a classic's loose EPUB, word list and cover only after the heart on its cover is tapped. Word-list covers in
   this folder are the resized JPEGs.

   ```
   cd dist-books && find . -type f | sed 's|^\./||' | while read -r key; do
     npx wrangler r2 object put "$BUCKET/$key" --file "$key" --remote
   done
   ```

   The bucket (the one behind `https://books.inputread.site`) must allow cross-origin reads from the app
   (`Access-Control-Allow-Origin` for `https://inputread.site`, `https://www.inputread.site`,
   `https://margin-words.pages.dev`, and localhost). The service worker stores a book only after that
   CORS response, and only after the reader opens or downloads it. The first visit does not precache the books.
3. **Private packs** stay off the public host. Copyrighted EPUBs are not in git; they belong in the private R2
   bucket `margin-words-private`. `npm run build:private` writes `dist-private/` from a local `packs/<id>/book.epub`
   (each copyrighted EPUB, its glossary, and its cover). That bucket has no public access and is never fetched
   by the app. Do not put it in `dist/` or `dist-books/`. Public-domain EPUBs are not in git either; they live
   on `https://books.inputread.site`. `node scripts/build-site.mjs` writes `site/` = `dist/` + `packs/` for a
   machine of your own. Do not deploy `packs/`, `site/`, or `dist-private/`.
4. **Another catalog:** each reader can set a catalog address in **Settings**. That host must allow cross-site reads.

File addresses in `catalog.json` are relative to the catalog file, so the folder can be moved anywhere.

### How a reader uses it, also offline

1. Open the app. A new shelf is empty and points to Discover (it suggests Alice's Adventures in Wonderland).
   **Discover is the only place to add books**, and adding needs a signed-in account: a signed-out visitor can
   browse everything, and the add button says **Sign in to add**. Discover lists every book (the public-domain
   books and the word lists), with search and the difficulty, author, and series filters.
2. Tap the heart on a cover. A filled red heart means the book is on the shelf; tap it again to remove it.
   A fresh book can be undone. A book you have started reading, or one with your own e-book, asks first.
   A public-domain book downloads when the heart is tapped. A word-list book downloads its word list and asks
   for your own e-book of the ISBN on the card. A match under 80% is shown before it is saved. The book and
   its word list are stored in the browser (IndexedDB). Books already stored on a device stay readable,
   signed in or not.
3. After that the book works with **no internet**. The app itself also works offline after the first visit
   (a small service worker keeps the app files; it needs `https://` or `localhost`).
4. When a word list changes (new `rev`), the new list is fetched quietly in the background on the next load:
   the book file, reading place, saved words and settings are kept, and a small notice says how many books
   were updated. A list the reader added or edited by hand is never replaced. A word-list book whose new list
   does not match the reader's own EPUB (under 80%) keeps the old list, and its Discover card shows a manual
   **Update** button with the reason. The same button appears when an automatic update fails.

A book's menu on the shelf has **Add word list** (a `.json` for a book that is already there).
Books that older versions saved in the browser still work and are marked "On your shelf".

### Checks

```
npx tsc --noEmit
npm run check:cjk          # Chinese text only in src/lib/i18n-zh.ts, docs/ and README.zh-CN.md
npm run check:example      # the sample in examples/, the JSON example in the spec, the kit and the in-app page
node scripts/validate-glossary.mjs packs/twits/book.epub packs/twits/glossary.json
node scripts/build-packs.mjs --check
npm test
```

### Languages (UI)

All visible text of the app is in two dictionaries with the same keys: `src/lib/i18n-en.ts` and
`src/lib/i18n-zh.ts` (`src/lib/i18n.ts` is the tiny switch; no library). A missing key fails `npx tsc --noEmit`, and
`npm test` checks that both dictionaries have the same keys and placeholders. The first visit uses the browser language
(Chinese -> Chinese, anything else -> English); the choice is saved in the browser. Book content (meanings, paragraph and
sentence help, phrases, titles) is never translated.

## Credit

The idea for this reader comes from [English Read](https://github.com/bitbw/english-read)
(Copyright (c) 2026 English Read contributors, [MIT License](https://github.com/bitbw/english-read/blob/main/LICENSE)).
Margin Words is a separate app. The Guide page in the app says the same thing.
