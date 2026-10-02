# Book pack format (version 1)

> The short, complete spec for AI agents is [book-pack-spec.md](book-pack-spec.md) (also in the downloadable book-pack-kit.zip). Sample: `examples/sample-book/`.

A **book pack** is one book plus its word list. The reader app contains twelve free public-domain classics (in `public-books/`, same pack format; each is marked `preinstall` and is installed on first run unless the user removed that book). It downloads other packs
from a **catalog** (a `catalog.json` on any static web host), or imports a pack `.zip` the user picks (Add book).

## Folder layout (what you host)

```
packs/
  catalog.json            the list of books
  all-packs.zip           every pack folder + a catalog.json (one download, for sideloading)
  twits/                  one folder per book; the folder name is the pack id
    book.epub             the book (unchanged)
    glossary.json         the word list (docs/GLOSSARY_FORMAT.md; copied unchanged)
    cover.jpg             optional cover
    info.json             optional input for build-packs (title, author, order, lexile, isbn, series, preinstall)
  twits.zip               the same pack as ONE file: book.epub, glossary.json, cover.jpg, pack.json
```

The folder `packs/` lives at the top of the project, **outside `public/`**, so the built app (`dist/`)
never contains books. `node scripts/build-site.mjs` can copy `dist/` and `packs/` into one `site/`
folder to host.

## catalog.json

```json
{
  "format": 1,
  "name": "Margin Words book packs",
  "updated": "2026-10-01",
  "allPacks": { "url": "all-packs.zip", "bytes": 34665075, "sha256": "..." },
  "packs": [
    {
      "id": "twits",
      "title": "The Twits",
      "author": "Roald Dahl",
      "level": "Middle-school level. ...",
      "notes": "",
      "lexile": "750L",
      "rev": "84d89aa4e275",
      "version": 2,
      "chapters": 29, "words": 172, "paragraphs": 12, "sentences": 15, "phrases": 22, "coined": 12,
      "epub":     { "url": "twits/book.epub",     "bytes": 2867199, "sha256": "..." },
      "glossary": { "url": "twits/glossary.json", "bytes": 118682,  "sha256": "...", "rev": "e037af75f48e" },
      "cover":    { "url": "twits/cover.jpg",     "bytes": 48595 },
      "zip":      { "url": "twits.zip",           "bytes": 2938403,  "sha256": "..." }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `1`. |
| `id` | Letters, digits, `-` and `_`. Same as the folder name. Never change it for a book. |
| `title`, `author`, `level`, `notes` | Shown on the card in "Add book" -> "Free books". |
| `lexile` | Optional. A Lexile measure for this edition, such as `750L` or `HL1070L`. The shelf and the free-books list show it and can sort or filter by it. Leave it out when you do not have a published measure; the card then says unrated. See [LEXILE_SOURCES.md](LEXILE_SOURCES.md). |
| `isbn` | Optional. ISBN-13 of the edition this list was written for. Leave it out when the EPUB has no ISBN you can confirm. See [ISBN_SOURCES.md](ISBN_SOURCES.md). |
| `series` | Optional series title. A name alone is enough. The shelf can group and filter by it. |
| `seriesNumber` | Optional 1-based place in `series`. Kept only when `series` is set. With a number, the shelf lists the series in that order. |
| `rev` | Changes when the book or its word list changes (first 12 letters of the sha256 of the epub + list). When it differs from the installed copy the card shows **Update available**. |
| `version` | The word list format version (1 or 2). |
| `chapters`, `words`, `paragraphs`, `sentences`, `phrases`, `coined` | Counts, from the list. |
| `epub`, `glossary` | The two files the reader downloads. `sha256` is checked after the download. |
| `zip` | The same pack as one file (for people who want to share or sideload it). |
| `cover` | Optional. |
| `url` | **Relative to the catalog file**, or a full `https://` address. |

The reader needs only `id`, `title`, `rev`, `epub` and `glossary`. The other fields are optional.

## Pack zip (what a reader can import)

**Only a book pack can be added. A standalone EPUB is not supported.** A pack is ONE `.zip` with exactly these files
(full rules: [book-pack-spec.md](book-pack-spec.md), section 3, "Required files"):

| File | Required | Notes |
| --- | --- | --- |
| `book.epub` | yes, exactly one | The book. Any single `*.epub` name works. Up to 40 MB. |
| `glossary.json` | yes, exactly one | The word list ([GLOSSARY_FORMAT.md](GLOSSARY_FORMAT.md)). `<name>.glossary.json` also works. |
| `cover.jpg` (`.png`, `.webp`) | no | Used only when the EPUB has no cover. |
| `pack.json` | no | `{ "id", "title", "author", "rev", "lexile", "isbn", "series", "seriesNumber" }`. `lexile`, `isbn`, `series` and `seriesNumber` are optional. `series` may stand alone. |

Title, author and cover come from the EPUB. At import the reader checks that the zip has one book and one list, that the
list is valid, that the EPUB opens, and that the list belongs to the book (`sha256` equals the EPUB's sha256, or `title`
and `author` match). Any problem is shown in plain words and nothing is added. A zip may also hold several sub-folders,
each with its own `book.epub` + `glossary.json`; each is imported as one book. The catalog's `packs/<id>.zip` files
are packs of this kind; so is `the-lantern-seller.pack.zip` in the kit.

## Making packs

```
node scripts/build-packs.mjs                    # packs/<id>/... -> catalog.json, <id>.zip, all-packs.zip
node scripts/build-packs.mjs --from DIR         # first create packs/<id>/ from DIR/<id>.epub + DIR/<id>.glossary.json
node scripts/build-packs.mjs --check            # exit 1 if catalog or zips are out of date
node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip   # one pack zip, checked like the app does
```

It checks each word list (same checks as `scripts/validate-glossary.mjs`, with the epub) and that the list
was made for that epub (sha256). Output is deterministic: building twice gives the same files.
