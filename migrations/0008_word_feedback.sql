-- Reader feedback on word explanations:
-- 'too_hard': explanation vocabulary is too difficult for junior-high learners.
-- 'wrong_meaning': chosen sense does not match context or is inaccurate.
--   npx wrangler d1 migrations apply margin-words --remote

CREATE TABLE IF NOT EXISTS word_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  word TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_word_feedback_book_word
ON word_feedback (book_id, word, reason);

CREATE INDEX IF NOT EXISTS idx_word_feedback_recent
ON word_feedback (created_at DESC);
