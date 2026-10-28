-- Indexes for the admin pages' counts, so they stop reading the whole table on every visit.
--
-- users(created_at): "sign-ups per day" asks for the rows after a date (WHERE created_at >= ?).
-- book_word_taps(in_glossary, status): the missing-words page counts the open taps
-- (in_glossary = 0 AND status != 'resolved'); with this index the count reads only those rows.
--
-- Each new user or tap row writes one more index row: a few dozen rows a day at today's traffic.
-- Only indexes are added; no row changes. Compatible with the code before it.
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);
CREATE INDEX IF NOT EXISTS idx_book_word_taps_open ON book_word_taps (in_glossary, status);
