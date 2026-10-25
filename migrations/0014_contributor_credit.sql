-- Credit for readers whose suggested meanings are accepted into a word list.
--   npx wrangler d1 migrations apply margin-words --remote
--
-- public_id: a random 12-character id that may be shown and written into word lists. It is never
-- the email. Every account gets one here; new accounts get one when they are made.
-- word_feedback.user_id: only set on a report that carries the reader's own meaning.
-- accepted_at / accepted_rev: set by the daily patrol when that meaning went into a list.
-- avatar_rev: a version for the reader's avatar on the books host (avatars/<public_id>.webp);
-- 0 means no avatar.

ALTER TABLE users ADD COLUMN public_id TEXT;
UPDATE users SET public_id = lower(hex(randomblob(6))) WHERE public_id IS NULL;
CREATE UNIQUE INDEX idx_users_public_id ON users (public_id);
ALTER TABLE users ADD COLUMN avatar_rev INTEGER NOT NULL DEFAULT 0;

ALTER TABLE word_feedback ADD COLUMN user_id TEXT;
ALTER TABLE word_feedback ADD COLUMN accepted_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE word_feedback ADD COLUMN accepted_rev TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_word_feedback_accepted ON word_feedback (user_id, accepted_at);
