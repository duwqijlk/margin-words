/**
 * How much one request may carry, shared by the client that sends and the Function that checks.
 *
 * Pages Functions on the Free plan get 10ms of CPU per request, and a batch is where that budget
 * goes: every item is validated, merged and written inside the same request. The client cuts its
 * upload into batches of this size and calls again for the rest, so a big library still syncs
 * while no single request grows with it.
 *
 * Kept in one place because the number must match on both sides: too high on the client and the
 * server answers 413, too low and the client needlessly splits.
 */

/**
 * Items one `POST /api/sync` may carry. The server writes them in ONE D1 batch (one transaction),
 * and a batch holds at most 100 statements, so a push is all-or-nothing.
 */
export const SYNC_PUSH_MAX = 100;

/**
 * Characters one `POST /api/sync` body may hold. The Function refuses a larger body (413). A big
 * word book is several hundred KB per shard, so the client also splits by size, keeping well under.
 */
export const SYNC_BODY_MAX = 1_500_000;
/** The client's own target per request, leaving room under SYNC_BODY_MAX. */
export const SYNC_BODY_TARGET = 900_000;

/** Longest meaning a reader may suggest with a word report, in characters. */
export const SUGGESTION_MAX = 200;

/**
 * Longest passage a reader may select for help, in characters: a phrase, a sentence, or the hard
 * part of one paragraph, never a page of the book. The page stops a longer selection; the server
 * refuses one.
 */
export const PASSAGE_MAX = 600;

/**
 * Longest explanation a reader may write for a passage. A word meaning is one line
 * (SUGGESTION_MAX); a sentence or a paragraph needs room for what it means and why.
 */
export const PASSAGE_NOTE_MAX = 600;

/** Taps one `POST /api/analytics/word-taps` may carry. */
export const WORD_TAPS_MAX = 20;
