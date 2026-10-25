-- A reader may select a few words, a sentence or a short passage and ask for help with it
-- (a phrase, a figure of speech, a hard sentence). One row per report. The daily patrol reads
-- them and writes a phrase, sentence or paragraph note into the live word list.
--   npx wrangler d1 migrations apply margin-words --remote
--
-- chapter / paragraph: the reader's chapter index and the index of the one paragraph the
-- selection is in (a selection never crosses paragraphs). sel_start / sel_end: its character
-- offsets in that paragraph (-1 when unknown). span: "words" or "sentence" (holds a whole sentence).
-- selected: the exact text, at most 600 characters. before / after: a few words around it.
-- topic: id of the first open report on this paragraph that overlaps this one (its own id for the
-- first). Overlapping reports are read and answered together.
-- suggestion: the reader's own explanation, at most 600 characters.
-- user_id: set only when the report carries the reader's own explanation (for credit).

CREATE TABLE IF NOT EXISTS passage_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL DEFAULT '',
  chapter INTEGER NOT NULL DEFAULT 0,
  paragraph INTEGER NOT NULL DEFAULT 0,
  sel_start INTEGER NOT NULL DEFAULT -1,
  sel_end INTEGER NOT NULL DEFAULT -1,
  span TEXT NOT NULL DEFAULT 'words',
  selected TEXT NOT NULL,
  before TEXT NOT NULL DEFAULT '',
  after TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  suggestion TEXT NOT NULL DEFAULT '',
  glossary_rev TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  topic INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_passage_feedback_topic ON passage_feedback (topic);
CREATE INDEX IF NOT EXISTS idx_passage_feedback_accepted ON passage_feedback (user_id, accepted_at);
