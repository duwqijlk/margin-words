-- One writer at a time for each catalog file on the books host (functions/lib/catalog-lock.ts).
-- A publish reads a catalog, changes one row and writes it all back; two at once would drop a row.
-- A row here is a lock held until expires_at; a writer that died loses it by itself.
--   npx wrangler d1 migrations apply margin-words --remote

CREATE TABLE IF NOT EXISTS catalog_locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
