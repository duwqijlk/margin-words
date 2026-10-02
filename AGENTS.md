# Margin Words: project notes

A static reader for English novels, for Chinese junior-high learners. It is a plain Vite + React 19 +
Tailwind 4 + zustand single-page app. It has no server, no server functions and no AI calls. Books and
word lists come from **book packs** (see README.md, "Reader and book packs"). **A standalone EPUB is never imported**: the only import is a pack `.zip` with exactly `book.epub` + `glossary.json` (docs/book-pack-spec.md, section 3; code in `src/lib/pack-check.ts` and `importPackZip` in `src/lib/packs.ts`).

## Rules

- The UI has two languages, `en` and `zh`. Every visible string (labels, aria-labels, toasts, errors) goes
  through `useT()` / `tr()` from `src/lib/i18n.ts` and lives in BOTH `src/lib/i18n-en.ts` (plain, simple English)
  and `src/lib/i18n-zh.ts` (simple Simplified Chinese for junior-high students). Both must have the same keys (tsc
  and `npm test` check this). Book content (meanings, paragraph/sentence help, phrases, titles) is English and is
  never translated.
- Chinese text is allowed ONLY in `src/lib/i18n-zh.ts`, `docs/` and `README.zh-CN.md`. No Chinese in other
  files of `src/`, `public/`, `packs/`, `examples/` or `scripts/`. `npm run check:cjk` must pass. (The Chinese
  text of the guide page in the app is in `docs/guide-chrome.json` and built into `dist/kit/`, never stored in `public/`.)
- Never change the reading layout when a panel opens. Panels are overlays. Test with a layout-shift run.
- The pack word lists (`packs/<id>/glossary.json`) are book content. Do not edit them by hand; copy them
  byte for byte. `node scripts/build-packs.mjs --check` must pass.
- No network call may depend on a server of ours. The reader may only fetch the catalog and pack files
  the user chose.

## Commands

- `npm run dev` : dev server (also serves `/packs/*`, `/public-books/*` and `/word-lists/*` from the repo; book URLs stay on this origin)
- `npx vite build` (or `npm run build`) : static front end in `dist/` only (HTML, JS, CSS, fonts, guide). Book files are not in `dist/`. The build bakes `https://books.inputread.site` unless `VITE_BOOKS_BASE` is set. `npm run build:local` sets it empty so a preview server can serve the repo copies (used by e2e).
- `npm run build:books` : write `dist-books/`, the object keys to upload to the books bucket (loose `public-books/` epub, glossary, cover, catalog; loose `word-lists/` glossaries, card-sized `cover.jpg` when `packs/<id>/cover.jpg` exists, and catalog). No zip, no `all-packs.zip`, no copyrighted EPUB. A word-list book with no cover keeps the generated cover in the app.
- `npm run build:private` : write `dist-private/`, every copyrighted pack's EPUB (when it has one) plus its glossary and cover. Upload that folder to the private R2 bucket `margin-words-private`. That bucket has no public access. The app never fetches it. Never put `dist-private/` inside `dist/` or `dist-books/`.
- Upload (set `BUCKET` to the bucket for `https://books.inputread.site`): `cd dist-books && find . -type f | sed 's|^\./||' | while read -r key; do npx wrangler r2 object put "$BUCKET/$key" --file "$key" --remote; done`. The same keys work with the S3 API. The bucket must allow cross-origin reads from `https://inputread.site`, `https://www.inputread.site`, `https://margin-words.pages.dev` and localhost, or the service worker cannot keep a book after it is opened.
- `node scripts/build-packs.mjs` : rebuild `packs/catalog.json` and the local sideload zips (not uploaded)
- `node scripts/build-packs.mjs --out public-books` : rebuild the catalog and local zips of the free classics. The hosted catalog drops the zip entries.
- `node scripts/build-site.mjs` : `site/` = `dist/` + `packs/` (private local folder, not the public books host)
- `node scripts/validate-glossary.mjs packs/<id>/book.epub packs/<id>/glossary.json`
- `npx tsc --noEmit`, `npm run check:cjk`, `npm run check:example`, `npm test`
- `node scripts/build-guide.mjs --check` : the tiny in-app page (`/kit/`: title, 2-3 lines, one Download button) is made from `docs/guide-chrome.json` at build time. It serves `/kit/book-pack-kit.zip`.
- `npm run build:kit` : writes `book-pack-kit.zip` = `docs/book-pack-spec.md` + `examples/sample-book/` (EPUB + glossary.json) + `the-lantern-seller.pack.zip` (a ready-to-import pack).
- `node scripts/make-pack.mjs book.epub glossary.json out.pack.zip` : build and check one pack zip. `vite build` builds the same zip into `dist/kit/`.
- `npm run make:sample` : rewrite `examples/sample-book/the-lantern-seller.epub`
- Glossary entries may carry `senseOnly: true` (optional boolean; docs/GLOSSARY_FORMAT.md 7.5, docs/book-pack-spec.md 4.7). Such an entry holds only position-based senses, and the reader underlines/opens the word ONLY at the places its senses name (`readingHtml`, `entryAppliesAt` in `src/lib/glossary-format.ts`). The flag must survive every copy of the list: validator (`validateGlossary`), `applyGlossary`, `applyPackGlossary`, and the stored `Gloss` in IndexedDB (`gloss:<bookId>`). `node scripts/sense-only-e2e.mjs` checks this end to end (needs the e2e preview server, see `scripts/e2e-ui.mjs`).
- For anyone (or any AI) who makes packs: `docs/book-pack-spec.md`. Keep it in step with `src/lib/glossary-format.ts`; `npm run check:example` validates its JSON example.

## App structure notes

- Routes: `/shelf`, `/discover`, `/guide`, `/words`, `/read/<bookId>` (`src/lib/router.ts`, History API; `/` redirects to `/shelf`). Pages are lazy chunks. `public/_redirects` is the SPA fallback; `public/_headers` sets `no-cache` for the shell and `immutable` for `/assets/*`. The service worker stays and is network-first for navigations; `_headers`/`_redirects` are never precached. The static kit page is `/kit/`.
- The reader always reserves a right gutter at `md+` (word panel or a placeholder), and the panel is a fixed bottom sheet on phones, so opening a panel never shifts the text.
- One book = one shelf card: identity matching is in `src/lib/shelf-identity.ts`. `repairShelf()` (merge duplicates) and `refreshCovers()` (re-derive covers, catalog cover cache-busted by `cover.sha256`) run on load (`src/lib/shelf-repair.ts`).
- Series stacks: `src/lib/shelf-stacks.ts`, `src/components/series-stack.tsx`.
- Text extraction treats `<br>`, `<hr>` and block boundaries as one space (`src/lib/flow-text.ts`); stored HTML and token indexes are unchanged, and example matching tolerates words glued at a `<br>`.
- Tests: `npm test` (unit), `node scripts/e2e-ui.mjs`, `npm run test:routes`, `npm run test:sense-only` (the e2e ones need `npm run build:local` plus a preview server).
