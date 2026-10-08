-- Public-interest sponsorship requests. The site does not take payment and does not
-- store a WeChat id, an Alipay account, or a wallet address. The admin emails those
-- details from the official address, then records the USD amount here.
-- Apply before deploying the sponsorship functions:
--   npx wrangler d1 migrations apply margin-words --remote

CREATE TABLE sponsorships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  email_sent_at INTEGER,
  amount_cents INTEGER,
  listed_at INTEGER,
  closed_at INTEGER
);

CREATE INDEX idx_sponsorships_user ON sponsorships (user_id, created_at);
CREATE INDEX idx_sponsorships_listed ON sponsorships (listed_at);
