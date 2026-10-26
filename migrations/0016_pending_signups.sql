-- An account is made only after its email is checked. Registering stores a pending sign-up here
-- and emails a 6-digit code; typing the code creates the user (already checked) and signs in.
-- A mistyped address (gamil.com) therefore leaves no account and does not hold the address.
--   npx wrangler d1 migrations apply margin-words --remote
--
-- One row per address: registering again replaces it (new password, new code). Only hashes are
-- stored: the password as for a user, the code bound to the address. A row lives 15 minutes for
-- its code; an expired row is removed the next time anyone registers.

CREATE TABLE IF NOT EXISTS pending_signups (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iters INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups (expires_at);
