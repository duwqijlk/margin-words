-- How long a trusted reader keeps library access, and which word lists a
-- plain reader has opened. trusted_until is null for a grant that does not
-- expire. A plain reader may open 5 distinct word lists in 7 days.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE users ADD COLUMN trusted_until INTEGER;

CREATE TABLE glossary_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_glossary_reads_user_time ON glossary_reads (user_id, created_at);
