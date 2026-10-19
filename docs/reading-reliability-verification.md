# Reading reliability regression coverage

## Scope

This change fixes the local test baseline and narrow reading-position / EPUB-path defects. It does not change the storage schema, default segmentation rules, chapter limit, sync protocol, or book content.

## Automated checks

- `scripts/glossary-date.test.mjs`: canonical UTC commit timestamps; numeric timezone offsets; absent history.
- `scripts/position.test.mjs`: nearest occurrence of an exact repeated quote; deterministic ties; bounded fallback after a real text edit; existing chapter and extra restoration rules.
- `scripts/epub-extract.test.mjs`: encoded OPF directories, nested UTF-8 paths, literal percent signs, encoded filename delimiters, NAV and NCX fragment decoding, malformed percent references, local embedded images, and unchanged chapter/extra ordering.
- Existing extraction tests retain coverage for missing/sparse contents, split continuations, body/html anchors, default and opt-in segmentation, and sanitized structural boundaries.
- `scripts/reader-position-e2e.mjs`: current chapter/extra reselection without remount; paragraphs-only books (including short/empty stored paragraphs); repeated quotes in tall paragraphs; matched and unmatched source jumps; pre-frame pagehide, pre/post-debounce route exits, and immediate exit after backward chapter navigation. `VIEWPORT=390x844` runs the same scenarios on a narrow viewport.
- Existing `reader-layout-e2e.mjs` and `paging-e2e.mjs` remain regression gates for overlays, mobile typography, page overlap, and chapter boundaries.

Legacy paragraphs-only books still render plain text, without word buttons or note bulbs; this change repairs their position recovery, not their feature set. An unmatched source jump still opens a nearest chapter/paragraph as a fallback, but no longer flashes it as though the original sentence was found.

Run browser checks against a local production build, with isolated browser contexts and synthetic books. No account or hosted book download is required for the new reader tests.

## Verification results (2026-10-19)

- Full unit suite: 480 tests, 466 passed, 14 skipped, zero failures; the additional 4 SRS tests also passed.
- Production build and TypeScript checks passed, including Functions types.
- New position E2E: all 10 scenarios passed at both 1280×800 and 390×844.
- Layout E2E passed at 390px and 1280px, including no article shift when a card opens.
- Paging E2E passed with defaults, and at 390×844 with 21px font / 37.8px line height.
- Existing old-API and legacy-bundle browser checks passed on current Chrome.
- A native-browser EPUB parser check opened an encoded OPF directory, an encoded `#` filename and a `%2520` fragment; both chapters rendered and the next-chapter button opened the correct second text.
- `check:example` passed (the validator reports 6 existing sample warnings and 3 specification-example warnings); CJK and patch-whitespace checks passed.

## Environment limitations

The public checkout does not include third-party EPUBs. The bundled-classics hash regression is skipped when those files are absent. `build-packs.mjs --check` cannot complete without local `packs/*/book.epub` files; this is not a reason to change glossary content or regenerate catalogs. The original sample book remains available for `check:example`.

API-removal and legacy-bundle tests on current Chromium are useful compatibility checks, but are not equivalent to executing on an actual Chrome 69 / e-ink device.

## Follow-up work, outside this change

These require separate reproduction and compatibility design before implementation:

- Persisting extra-page scope in word sources and jumps.
- Preserving explicit anchor-clearing semantics through sync normalization and merging.
- Recovering content before the first TOC anchor or heading without shifting existing indexes.
- Deeply nested quote/list segmentation without changing old paragraph numbers.
- Explicit handling of the chapter limit and selection of a usable NCX when NAV is unusable.

Do not automatically re-import existing user books or rewrite their saved chapter/paragraph indexes as part of these follow-ups.
