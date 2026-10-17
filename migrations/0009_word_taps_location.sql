-- Upgrade word taps tracking to record exact location within the book,
-- matching the dictionary Anchor specification (chapter, occurrence, form, context)
-- and natural sentence context, enabling AI agents to autonomously add missing words.

DROP TABLE IF EXISTS book_word_taps;

CREATE TABLE IF NOT EXISTS book_word_taps (
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL DEFAULT '',
  word TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT '',
  chapter INTEGER NOT NULL DEFAULT 0,
  occurrence INTEGER NOT NULL DEFAULT 1,
  paragraph INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '',
  sentence TEXT NOT NULL DEFAULT '',
  tap_count INTEGER NOT NULL DEFAULT 1,
  in_glossary INTEGER NOT NULL DEFAULT 0,
  last_tapped_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, word, chapter, occurrence)
);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_missing
ON book_word_taps (book_id, in_glossary, tap_count DESC);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_recent
ON book_word_taps (last_tapped_at DESC);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_lookup
ON book_word_taps (word, in_glossary, tap_count DESC);

-- Also add book_title to word_feedback for reader friendly book display
ALTER TABLE word_feedback ADD COLUMN book_title TEXT NOT NULL DEFAULT '';
