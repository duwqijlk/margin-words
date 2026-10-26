-- The browser that starts a sign-up gets a random ticket (only its hash is kept). Send again and
-- the code step need it, so nobody else can resend or finish that sign-up.
-- A pending sign-up made before this has no ticket and cannot be finished; it ends in 15 minutes.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE pending_signups ADD COLUMN ticket_hash TEXT NOT NULL DEFAULT '';
