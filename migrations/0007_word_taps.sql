-- Frequency of words tapped while reading, grouped per book.
-- Helps locate frequently clicked words that are missing from book glossaries.
-- in_glossary: 1 if covered in book's glossary, 0 if missing.
--   npx wrangler d1 migrations apply margin-words --remote

CREATE TABLE IF NOT EXISTS book_word_taps (
  book_id TEXT NOT NULL,
  word TEXT NOT NULL,
  tap_count INTEGER NOT NULL DEFAULT 1,
  in_glossary INTEGER NOT NULL DEFAULT 0,
  last_tapped_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, word)
);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_missing
ON book_word_taps (book_id, in_glossary, tap_count DESC);

CREATE INDEX IF NOT EXISTS idx_book_word_taps_recent
ON book_word_taps (last_tapped_at DESC);
