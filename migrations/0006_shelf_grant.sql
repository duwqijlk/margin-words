-- Snapshot the shelf cards that already exist, so those books can be downloaded
-- again on another device without using a weekly word-list place.
-- A card synced after this migration keeps the snapshot columns empty.
--   npx wrangler d1 migrations apply margin-words --remote

ALTER TABLE sync_items ADD COLUMN grant_title TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_items ADD COLUMN grant_author TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_items ADD COLUMN grant_isbn TEXT NOT NULL DEFAULT '';

UPDATE sync_items
SET grant_title = COALESCE(json_extract(data, '$.title'), ''),
    grant_author = COALESCE(json_extract(data, '$.author'), ''),
    grant_isbn = COALESCE(json_extract(data, '$.isbn'), '')
WHERE kind = 'shelf' AND deleted = 0;
