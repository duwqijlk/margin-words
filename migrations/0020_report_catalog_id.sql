-- Which catalog book a report is about, as '<catalog>:<id>': 'word-lists:wonder' or
-- 'public-books:alice' (src/lib/catalog-id.ts). The two catalogs give out ids on their own, so the
-- prefix is what makes one value name one book. book_id is the reader's own device id for the book
-- and says nothing across devices; this column lets the patrol and the per-book credits find the
-- book without matching titles. '' for an older page, a list the reader added by hand, a pack from
-- another catalog address, or a book installed before its catalog was recorded.

ALTER TABLE book_word_taps ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';
ALTER TABLE passage_feedback ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS word_feedback_catalog ON word_feedback(catalog_id) WHERE catalog_id != '';
CREATE INDEX IF NOT EXISTS passage_feedback_catalog ON passage_feedback(catalog_id) WHERE catalog_id != '';
CREATE INDEX IF NOT EXISTS book_word_taps_catalog ON book_word_taps(catalog_id) WHERE catalog_id != '';
