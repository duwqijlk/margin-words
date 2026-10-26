-- How many chapters the reporting reader's own copy of the book has.
-- The word list records its own `chapters` count; when the two differ, the reported
-- chapter number is only that edition's index, and the place must be found by context.
-- 0 means an older client that did not send the count.

ALTER TABLE book_word_taps ADD COLUMN chapters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE word_feedback ADD COLUMN chapters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE passage_feedback ADD COLUMN chapters INTEGER NOT NULL DEFAULT 0;
