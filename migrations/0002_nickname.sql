-- Optional display name. Not unique: two accounts may use the same nickname.
-- Apply this before deploying functions that read users.nickname:
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE users ADD COLUMN nickname TEXT;
