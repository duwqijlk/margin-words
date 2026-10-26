-- Which catalog book a report is about: the id in word-lists/catalog.json or public-books/catalog.json.
-- book_id is the reader's own device id for the book and says nothing across devices; this column
-- lets the patrol and the per-book credits find the book without matching titles.
-- '' for an older page, a list the reader added by hand, or a book with no catalog entry.

ALTER TABLE book_word_taps ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';
ALTER TABLE passage_feedback ADD COLUMN catalog_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS word_feedback_catalog ON word_feedback(catalog_id) WHERE catalog_id != '';
CREATE INDEX IF NOT EXISTS passage_feedback_catalog ON passage_feedback(catalog_id) WHERE catalog_id != '';
