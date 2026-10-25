-- A reader may add their own meaning to a word report (missing, too hard, or wrong).
-- The daily patrol reviews it; a good one goes into the word list. Plain text, at most
-- 200 characters, empty when the reader wrote nothing.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE word_feedback ADD COLUMN suggestion TEXT NOT NULL DEFAULT '';
