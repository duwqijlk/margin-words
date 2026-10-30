/**
 * How soon an edit is uploaded, and when a sync may skip its pull.
 *
 * Every answer in a review session changes the word book, and every change used to start a sync
 * 1.5 s later: a pull (GET) and a push (POST) of the whole word-book shard and the settings. A
 * 20-card session made about 40 requests and wrote about 140 D1 rows. Now:
 *
 *   - While a review session is open (holdSyncPushes in sync-engine.ts), edits wait until the
 *     reader has been idle for HOLD_DELAY_MS, or until HOLD_MAX_CHANGES edits have piled up.
 *     Leaving the session, hiding the tab and closing the page still upload at once. The answers
 *     are saved on the device the moment they are made; only the upload waits.
 *   - A sync right after another one skips its pull: within PULL_FRESH_MS of the last pull, and
 *     only when the device has a cursor record (so the upload is decided against the signatures
 *     the server last returned, not against a full pull). The server merges each pushed item with
 *     what it holds and returns the result, so nothing is lost; edits other devices made to other
 *     items arrive with the next pull (at most PULL_FRESH_MS later, or on returning to the tab).
 *
 *   - While a book is open (holdSyncPushes({ reading: true }) in the reader), every scroll moves the
 *     reading place, and each pause of 1.5 s used to upload it: 12 scrolls made 12 POSTs, each a
 *     Function call and D1 writes, so reading for half an hour, or opening and leaving a book again
 *     and again, spent the free daily allowance for nothing. Now an edit made while reading starts
 *     one wait of READING_DELAY_MS that later edits do not restart: at most one upload a minute.
 *     Leaving the book, hiding the tab and closing the page still upload at once.
 *
 * Pure functions: the engine keeps the state.
 */
import { pullAfter, type SyncView } from "./sync-view.ts";

/** The usual wait after an edit. */
export const PUSH_DELAY_MS = 1500;
/** The wait after an edit while a review session holds uploads. */
export const HOLD_DELAY_MS = 15_000;
/** While held, upload anyway once this many edits are waiting. */
export const HOLD_MAX_CHANGES = 10;
/** While a book is open: the longest an edit waits, counted from the first edit (not restarted). */
export const READING_DELAY_MS = 60_000;
/** A pull younger than this is not repeated before a push. */
export const PULL_FRESH_MS = 30_000;

/**
 * The wait before uploading, given whether uploads are held and how many edits are waiting. Each
 * edit restarts the wait, so a full batch uploads at once: a reader answering faster than the
 * usual wait would otherwise keep pushing it back.
 */
export function pushDelay(held: boolean, waiting: number): number {
  if (!held) return PUSH_DELAY_MS;
  return waiting >= HOLD_MAX_CHANGES ? 0 : HOLD_DELAY_MS;
}

export type LastPull = { email: string; at: number } | null;

/** True when this sync can push without pulling first. */
export function canSkipPull(view: SyncView | null, email: string | null, last: LastPull, now: number): boolean {
  if (!view || !email || !last || last.email !== email) return false;
  // A full pull is due (first sync, stale record, another account): never skip it.
  if (pullAfter(view, email, now) === null) return false;
  return now >= last.at && now - last.at < PULL_FRESH_MS;
}
