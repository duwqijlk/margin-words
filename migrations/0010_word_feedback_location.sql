-- Add location context and sense identification to word_feedback,
-- enabling AI agents to pinpoint the exact sense and text occurrence reported.

ALTER TABLE word_feedback ADD COLUMN form TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN chapter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE word_feedback ADD COLUMN occurrence INTEGER NOT NULL DEFAULT 1;
ALTER TABLE word_feedback ADD COLUMN paragraph INTEGER NOT NULL DEFAULT 0;
ALTER TABLE word_feedback ADD COLUMN context TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN sentence TEXT NOT NULL DEFAULT '';
ALTER TABLE word_feedback ADD COLUMN sense_index INTEGER NOT NULL DEFAULT -1;
ALTER TABLE word_feedback ADD COLUMN sense_meaning TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_word_feedback_location
ON word_feedback (book_id, word, chapter, occurrence, reason);
