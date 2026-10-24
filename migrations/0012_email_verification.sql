-- Email check for new accounts. A new account gets a 6-digit code by email and
-- may open word lists only after entering it. Accounts made before this check
-- count as checked, so no current reader is locked out.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One open code per account. Only a hash of the code is stored.
CREATE TABLE email_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
