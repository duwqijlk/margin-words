# public-books: frozen public-domain snapshots

This directory is a **frozen repository snapshot** of public-domain book metadata and local test material. It is not the current live book store and it is not a live new-book publishing path. The books host and its catalog are authoritative; current operations are in [../docs/MAINTENANCE.md](../docs/MAINTENANCE.md) and [../docs/BOOK_UPLOAD.md](../docs/BOOK_UPLOAD.md).

Do not add a new live book here, update a live word list here, rebuild a live catalog from this directory, commit book content, or open a book-content pull request. Do not upload this directory or a catalog generated from it to the books host. The snapshot remains so local checks and historical pack-format references have stable fixtures.

The app's current reader flow is Discover. Readers add books there; a book already on a device remains readable. Copyrighted EPUBs are never put in this directory or in the public bucket.

## Snapshot contents

A snapshot book folder may contain:

- `glossary.json`: the frozen study list;
- `cover.jpg`: an optional local cover;
- `info.json`: frozen display metadata; and
- `book.epub`: only when a legal local test copy is intentionally available and ignored by git.

The old pack builder can check a local snapshot when its matching EPUB exists:

```bash
node scripts/build-packs.mjs --out public-books --check
```

A full glossary check also needs that exact local EPUB:

```bash
node scripts/validate-glossary.mjs public-books/<id>/book.epub public-books/<id>/glossary.json
```

If the EPUB is unavailable, the test is unavailable; do not substitute another edition or infer that the live book was checked. These commands are local compatibility checks only. They do not publish, deploy, or update the live catalog.

For a current task, use the task guide rather than this snapshot:

- [Maintenance map](../docs/MAINTENANCE.md) for stores, cache/version safety, recovery, and deployment boundaries;
- [Book upload](../docs/BOOK_UPLOAD.md) for current per-book files, catalog rows, covers, and series;
- [Glossary patrol](../docs/GLOSSARY_PATROL.md) for reader-driven live list fixes.
