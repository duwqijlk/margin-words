# Margin Words: migration guide

This repo is a full copy of the Margin Words project, moved to a **private** GitHub repo
(`duwqijlk/margin-words`). Chinese version: [docs/MIGRATION.zh-CN.md](docs/MIGRATION.zh-CN.md).

> **Private repo only.** The books in `packs/` are copyrighted. They are for private use only. This repo must
> stay **private**. Never make it public, never fork it to a public place, and never deploy `packs/` to a public site.

## 1. Overview

- A **static reader** for English novels (Vite + React 19 + Tailwind 4 + zustand). No server, no server functions,
  no AI calls. `dist/` is plain files that any static host can serve.
- Tap a word and see a simple English meaning. All meanings come from the book's `glossary.json`.
- **Pack-only import.** The app never imports a standalone EPUB. A book is a *book pack*: one `.zip` with exactly
  `book.epub` + `glossary.json` (title, author and cover come from the EPUB). Spec: `docs/book-pack-spec.md`.
- **Bilingual UI.** Buttons, menus and messages are in Simplified Chinese and English (language button in the top
  bar). The books and their meanings stay in English.
- Twelve free public-domain classics are loaded from the books host (`public-books/`). All twelve are put on the
  shelf at first run unless the user removed that book. Word lists for copyrighted titles are `word-lists/` on
  the same host (glossary only, generated covers).

## 2. What is in this repo

| Path | What it is |
| --- | --- |
| `src/`, `public/`, `index.html`, `vite.config.ts` | The app |
| `scripts/` | Build, check and test scripts (incl. `build-packs.mjs`, `layout-shift-test.mjs`) |
| `docs/`, `examples/`, `skills/` | Specs, the sample book, helper skills |
| `glossary-src/` | Sources of the hand-written word lists |
| `packs/<id>/` | The **copyrighted books** (9 with `book.epub`, plus the Narnia collection word list and no EPUB): `glossary.json`, optional `cover.jpg`, `info.json` + `packs/catalog.json`. **Private use only.** |
| `public-books/<id>/` | The **12 public-domain classics** + `catalog.json`. Uploaded with `dist-books/`, not inside `dist/`. |
| `classics/<id>/` | Working sources of 9 public-domain books (`book.epub`, `glossary.json`, `work/`) and `WRITER_BRIEF.md` |
| `book-pack-kit.zip` | The guide kit to give to an AI agent that makes a book pack |
| `screenshots/`, `artifacts/` | Small reference images and notes |

**Not in git (regenerable):** `node_modules/`, `dist/`, `dist-books/`, `site/`, `packs/*.zip` (incl. `packs/all-packs.zip`),
`public-books/*.zip`, and `classics/**/*.pack.zip`. Rebuild them with the commands below.

## 3. Rules

- **No layout shift.** Opening a word card or a panel must never move the reading text. Check it with
  `node scripts/layout-shift-test.mjs after --quick`. The summary must say `max shift 0px` and `0 failing`.
  The test needs Chrome at `/usr/bin/google-chrome`, the app served at `http://127.0.0.1:8090/` (or pass a URL as
  the 2nd argument), and it uses some of the books in `packs/`, so run it on the full `site/` folder (see below).
  Output goes to `layout-shift-out/` (git-ignored).
- **UI text is simple English** (and simple Chinese for junior-high learners in `src/lib/i18n-zh.ts`). Every visible
  string goes through `useT()` / `tr()` and exists in both `src/lib/i18n-en.ts` and `src/lib/i18n-zh.ts`.
- **Glossaries are written by hand, no AI.** Do not generate or edit `glossary.json` word lists with AI tools. Copy
  them byte for byte. `node scripts/build-packs.mjs --check` must pass.
- **Chinese only in** `src/lib/i18n-zh.ts`, `docs/`, `README.zh-CN.md`. Run `npm run check:cjk` (it fails on Chinese
  anywhere else in `src/`, `public/`, `packs/`, `examples/`, `scripts/`). This is why the Chinese migration guide is in
  `docs/`.
- No network call may depend on a server of ours.

## 4. Setup

Use Node 24 (the project was built with Node 24.11).

```
npm ci
npx vite build                                  # front end only, in dist/ (books host baked in)
npm run build:books                             # dist-books/ object keys for the books bucket
node scripts/build-packs.mjs --out public-books # rebuild the local zips + catalog of the 12 free classics
node scripts/build-packs.mjs                    # rebuild packs/catalog.json and packs/*.zip (private books)
node scripts/build-site.mjs                     # site/ = dist/ + packs/  (local use only!)
npm run dev                                     # http://localhost:8080, also serves ./packs and the book folders
```

Run `node scripts/build-packs.mjs --out public-books` **before** `npm run build:books` when a classic changed, so
`dist-books/public-books/` matches the books. `dist/` itself has no book files.

Checks: `npm run check:cjk`, `npm run typecheck`, `npm test`, `npm run check:example`, `npm run lint`.

## 5. Deploy

The public site is a Cloudflare Pages project named `margin-words`, with the domain `inputread.site`.

```
npx vite build
npx wrangler pages deploy dist --project-name margin-words --branch main
npm run build:books
# then upload dist-books/ to the R2 bucket for https://books.inputread.site (see README, "Host the app and the books")
```

`dist/` is the front end only. Book files go to the books bucket as loose objects (no zip, no `all-packs.zip`).
**NEVER deploy `packs/` (or `site/`) to a public host.** The copyrighted books are for private use only. Word lists
for those titles are glossaries in `dist-books/word-lists/`. Publisher covers in `packs/` are not uploaded.
(`vercel.json` is also in the repo for a static Vercel setup of `dist/`.)

## 6. Add a book

1. Make a pack folder with `book.epub` and `glossary.json` (`docs/book-pack-spec.md`, `docs/GLOSSARY_FORMAT.md`).
   Validate: `node scripts/validate-glossary.mjs <dir>/book.epub <dir>/glossary.json`.
2. **Public-domain book (ships with the app):** put it in `public-books/<id>/` with `book.epub`, `glossary.json`,
   optional `cover.jpg` and `info.json`, then run `node scripts/build-packs.mjs --out public-books`. See
   `public-books/README.md`.
3. **Copyrighted book (private only):** put it in `packs/<id>/`, then run `node scripts/build-packs.mjs`. It stays out
   of `dist/`. Do not deploy it.
4. Build one pack zip for a user: `node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip`.
5. Give `book-pack-kit.zip` to an AI agent if it should make a pack for you (`npm run build:kit` rebuilds it).

## 7. Copyright

The copyrighted books in `packs/` are private-use only. Keep this repository private. If you ever need to make it
public, delete `packs/` from the whole git history first.
