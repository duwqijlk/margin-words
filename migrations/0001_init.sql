-- Margin Words accounts. Apply with:
--   npx wrangler d1 migrations apply margin-words --local
--   npx wrangler d1 migrations apply margin-words --remote
-- User rows hold only an email and a password hash. Synced reading state is JSON
-- per item (one bookshelf card, one book's progress, one book's saved words, or
-- the settings blob), merged last-write-wins by updated_at.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iters INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Fixed-window counters. bucket is "login:ip:..." or "register:email:...".
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE sync_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, item_id)
);

CREATE INDEX idx_sync_user_updated ON sync_items (user_id, updated_at);

-- Tokens for the password-reset hook. The app does not send email; see functions/lib/email.ts.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
