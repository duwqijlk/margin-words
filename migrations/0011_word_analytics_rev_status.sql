-- Add glossary revision and resolution status tracking to book_word_taps and word_feedback,
-- preventing old dictionary versions from re-triggering alerts and enabling AI agents / admins
-- to mark items as resolved and track regressions.

ALTER TABLE book_word_taps ADD COLUMN glossary_rev TEXT NOT NULL DEFAULT '';
ALTER TABLE book_word_taps ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE book_word_taps ADD COLUMN resolved_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_word_taps ADD COLUMN resolved_rev TEXT NOT NULL DEFAULT '';

ALTER TABLE word_feedback ADD COLUMN glossary_rev TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE word_feedback ADD COLUMN resolved_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE word_feedback ADD COLUMN resolved_rev TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_word_feedback_status
ON word_feedback (book_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_status
ON book_word_taps (book_id, status, tap_count DESC);
