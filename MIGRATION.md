# Margin Words: migration and compatibility record

> **Public repository.** On 2026-10-04 the old pull requests were left in the private archive `duwqijlk/margin-words-archive`. This repository is the public project. See [docs/ARCHIVE.md](docs/ARCHIVE.md).

Chinese version: [docs/MIGRATION.zh-CN.md](docs/MIGRATION.zh-CN.md).

This page records historical moves and compatibility behavior. It is not the current manual for uploading books, maintaining live word lists, or deploying the site. Current operations start at [docs/MAINTENANCE.md](docs/MAINTENANCE.md), with task-specific guides for [book upload](docs/BOOK_UPLOAD.md), [glossary patrol](docs/GLOSSARY_PATROL.md), [book summaries](docs/BOOK_BLURBS.md), and [accounts](docs/ACCOUNTS.md).

> **No book files in git.** Copyrighted EPUBs live only in the private R2 bucket `margin-words-private`; public-domain EPUBs live only on `https://books.inputread.site`. `packs/` and `public-books/` in this repository are frozen snapshots, not current stores. Do not deploy them as live book data. Old pull requests in the private archive still contain book files, so that archive stays private.

## 1. Historical overview

- The project is a static reader built with Vite, React, and zustand. It has no AI calls. Optional accounts use Pages Functions and D1; the reader works without an account.
- The app's historical book-pack format is one `.zip` containing exactly `book.epub` and `glossary.json`. The format remains useful for the sample kit and compatibility checks; the app's current add flow is Discover, not a loose-file or zip import.
- Buttons and messages are bilingual; book text and meanings remain English.
- Earlier repository snapshots carried local pack catalogs and sample material. Those files remain only as frozen compatibility fixtures.

## 2. Repository and snapshot contents

| Path | Historical or compatibility role |
| --- | --- |
| `src/`, `public/`, `index.html`, `vite.config.ts` | The app |
| `scripts/` | Build, check, and test scripts; some pack builders remain for local fixtures |
| `docs/`, `examples/`, `skills/` | Specs, sample book, and helper skills |
| `glossary-src/` | Sources of hand-written word lists |
| `packs/<id>/` | Frozen word-list, cover, and metadata snapshots; not the live source |
| `public-books/<id>/` | Frozen public-domain snapshots; not the live source |
| `classics/<id>/` | Historical working notes |
| `book-pack-kit.zip` | Compatibility kit for making a sample pack |

EPUBs are not generally in git. The only tracked EPUB is `examples/sample-book/the-lantern-seller.epub`; a live book's legal EPUB may be unavailable locally, so full EPUB/glossary validation is not always possible in a checkout.

## 3. Rules that remain current

- Do not introduce layout shift when opening a card or panel. When Chrome and a matching local book are available, run `node scripts/layout-shift-test.mjs after --quick`; expect `max shift 0px` and `0 failing`.
- Every visible UI string belongs in both `src/lib/i18n-en.ts` and `src/lib/i18n-zh.ts`; `npm run check:cjk` enforces the repository's Chinese-text boundary.
- The reader makes no AI calls. That is not a ban on authorized agent-assisted glossary authoring or corrections; use [the authoring skill](skills/annotate-book-glossary/SKILL.md) and the current task playbooks, not an old publishing pipeline.
- Do not place third-party EPUBs in git or copyrighted EPUBs in the public bucket; see [storage boundaries](docs/MAINTENANCE.md#storage).

## 4. Local compatibility checks

Use Node 22 or newer as declared by `package.json`.

```bash
npm ci
npm run build:local       # local-origin book URLs for tests
npm run check:cjk
npm run check:example
npm test
npm run typecheck:functions
```

A full glossary check is conditional on having the matching legal EPUB:

```bash
node scripts/validate-glossary.mjs <book.epub> <glossary.json>
```

Without that EPUB, do not substitute a different edition or claim the live list was fully checked. `node scripts/build-packs.mjs --check` verifies frozen local fixtures only and never publishes them.

## 5. Compatibility data behavior

The following records describe behavior kept for older clients and data:

- Local words migrate from the former per-book store to one global wordbook card per lemma with `sources[]`; review schedule fields remain intact. `scripts/wordbook.test.mjs` and `scripts/wordbook-e2e.mjs` cover the migration.
- Synced data keeps the legacy `words` kind. New clients fold legacy items into `wordbook` and do not delete them; old clients ignore `wordbook`. Deploy client and Functions together when changing that contract.
- Reading positions may carry the newer `{ chapter, paragraph, quote, offset }` anchor beside the old chapter/scroll hint. Each device resolves it against its own local text; no EPUB is fetched or swapped for sync.
- A shelf that already has a book keeps it. A new shelf installs nothing automatically.

These notes preserve rollback and old-client behavior. They do not replace the current operational map or authorize direct writes.

## 6. Historical deployment boundary

The Pages project has no Git source. The site, D1 database, and R2 buckets remain separate from this repository. The production site build uses the books host; `npm run build:local` is for local checks only. Deployment ownership, cache rules, store safety, recovery, and any direct-write procedure belong in [docs/MAINTENANCE.md](docs/MAINTENANCE.md), not in this historical record.

## 7. Copyright boundary

This repository is public and its history has no third-party EPUB beyond the sample. Copyrighted EPUBs remain private; public-domain files remain on the books host. The private archive stays private because its old pull requests contain copyrighted files.
