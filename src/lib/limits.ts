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

/** Items one `POST /api/sync` may carry. */
export const SYNC_PUSH_MAX = 200;

/** Taps one `POST /api/analytics/word-taps` may carry. */
export const WORD_TAPS_MAX = 20;
