-- When the server last wrote each sync row, by the server's clock. A device asks for the rows
-- written after its cursor (GET /api/sync?after=<ms>) instead of reading its whole account on every
-- pull. updated_at cannot be the cursor: it is the item's own time from the device that changed it,
-- and device clocks differ, so a change made on a slow-clocked device could fall behind a cursor.
--
-- Rows written before this migration keep 0: only a full pull (no `after`) returns them, and every
-- device starts with one. Adding a column with a default is compatible with the code before it.
ALTER TABLE sync_items ADD COLUMN server_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sync_user_server ON sync_items (user_id, server_at);
