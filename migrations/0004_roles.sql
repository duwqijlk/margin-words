-- Admin and trusted-reader roles on the account. "admin" is the site owner
-- account; "trusted" may stream copyrighted EPUBs from the private R2 bucket
-- through the authenticated /api/book/<id>/epub endpoint. Everyone else is
-- "user". The official email also stays an admin in code, so the first admin
-- does not depend on this column.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE TABLE book_downloads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_downloads_user_time ON book_downloads (user_id, created_at);
