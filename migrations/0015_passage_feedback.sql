-- A reader may select a few words, a sentence or a short passage and ask for help with it
-- (a phrase, a figure of speech, a hard sentence). One row per report. The daily patrol reads
-- them and writes a phrase, sentence or paragraph note into the live word list.
--   npx wrangler d1 migrations apply margin-words --remote
--
-- chapter / paragraph: the reader's chapter index and the index of the one paragraph the
-- selection is in (a selection never crosses paragraphs). selected: the exact text, at most 300
-- characters. before / after: a few words around it, so the place can be found again.
-- user_id: set only when the report carries the reader's own explanation (for credit).

CREATE TABLE IF NOT EXISTS passage_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL DEFAULT '',
  chapter INTEGER NOT NULL DEFAULT 0,
  paragraph INTEGER NOT NULL DEFAULT 0,
  selected TEXT NOT NULL,
  before TEXT NOT NULL DEFAULT '',
  after TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  suggestion TEXT NOT NULL DEFAULT '',
  glossary_rev TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at INTEGER NOT NULL DEFAULT 0,
  resolved_rev TEXT NOT NULL DEFAULT '',
  accepted_at INTEGER NOT NULL DEFAULT 0,
  accepted_rev TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passage_feedback_open ON passage_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_passage_feedback_place ON passage_feedback (book_id, chapter, paragraph);
CREATE INDEX IF NOT EXISTS idx_passage_feedback_accepted ON passage_feedback (user_id, accepted_at);
