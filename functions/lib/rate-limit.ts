import type { D1Database } from "./db.ts";
import { HttpError, rateLimitIp } from "./http.ts";

/** 15-minute fixed window. Login and register are limited per IP and per email. */
export const RATE_WINDOW_MS = 15 * 60 * 1000;

export const RATE_LIMITS = {
  "login:ip": 20,
  "login:email": 10,
  "register:ip": 10,
  "register:email": 5,
  "reset:ip": 10,
  "reset:email": 5,
  // Typing the sign-up code. The code itself ends after 5 wrong tries; this only stops a flood.
  "signup-code:ip": 30,
  "signup-code:email": 20,
  "sponsor:ip": 10,
  "sponsor:email": 5,
  "taps:ip": 60,
  "feedback:ip": 30,
  // Emailed codes: each send is a message from our Resend account, each check a guess at 6 digits.
  "code-send:user": 5,
  "code-check:user": 20,
  // Per signed-in account. Any free account can call these in a loop, and each call is a D1 read
  // plus an R2 get of a word list or a sync body - a cheap way to spend someone else's quota.
  "glossary:user": 120,
  "sync:user": 300,
} as const;

export type RateAction = "login" | "register" | "reset" | "sponsor" | "signup-code";
export type IpRateAction = RateAction | "taps" | "feedback";
export type UserRateAction = "glossary" | "sync" | "code-send" | "code-check";

/**
 * Buckets that live a day rather than a window. They are kept out of the short prune: today's row
 * must not be deleted an hour after it was written, or the ceiling would reset every hour.
 */
const DAILY_PREFIX = "budget:";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A hard daily ceiling on the rows anyone can make the database write.
 *
 * `word-taps` is anonymous telemetry: every request writes up to `WORD_TAPS_MAX` rows, and the
 * per-IP limit does not bound the total because addresses are cheap. This is the fuse that caps
 * the bill whatever the traffic - when the day's rows are gone the endpoint answers 429 and
 * writes nothing. A reader loses a day of anonymous statistics at worst.
 *
 * It must stay well under D1's daily write allowance (100,000 rows on the Free plan, shared by
 * the whole site): above it, a flood of taps would spend the allowance and stop sign-in and sync
 * until the next day. 20,000 rows, plus the index writes they cause, leaves most of it for them.
 */
export const DAILY_WRITE_BUDGET = {
  taps: 20_000,
} as const;

/**
 * Clearing out old rows is housekeeping, not part of counting: a row only counts for its own
 * (bucket, window_start), so an expired row left a little longer changes no limit. It used to run
 * on EVERY limited request, two DELETEs that scan the whole table, and it was the largest D1 reader
 * of the site (about 1.5 million rows read a week, more than half of all reads). A per-instance
 * PRUNE_EVERY_MS alone was not enough: Cloudflare runs many short-lived instances, and each one
 * cleared on its first request (about 4,000 clears a day). Now a limited request clears with a
 * chance of 1 in PRUNE_ONE_IN, and still at most once per PRUNE_EVERY_MS per instance.
 */
export const PRUNE_EVERY_MS = 5 * 60 * 1000;
export const PRUNE_ONE_IN = 50;
/** Per running instance (module scope), not per binding object, which need not be reused. */
let lastPrune = Number.NEGATIVE_INFINITY;
let pruneRoll: () => number = Math.random;

/** Tests only: make the 1-in-PRUNE_ONE_IN draw predictable. Returns the previous draw. */
export function setPruneRoll(roll: () => number): () => number {
  const before = pruneRoll;
  pruneRoll = roll;
  return before;
}

async function prune(db: D1Database, now: number): Promise<void> {
  // A clock that went back (or a test time earlier than the last one) prunes again.
  if (now >= lastPrune && now - lastPrune < PRUNE_EVERY_MS) return;
  if (pruneRoll() * PRUNE_ONE_IN >= 1) return;
  lastPrune = now;
  await db
    .prepare(`DELETE FROM rate_limits WHERE bucket NOT LIKE '${DAILY_PREFIX}%' AND window_start < ?`)
    .bind(now - RATE_WINDOW_MS * 4)
    .run();
  // Daily rows from before yesterday count nothing any more.
  await db
    .prepare(`DELETE FROM rate_limits WHERE bucket LIKE '${DAILY_PREFIX}%' AND window_start < ?`)
    .bind(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS)
    .run();
}

function windowStartOf(now: number): number {
  return Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
}

async function addHit(
  db: D1Database,
  bucket: string,
  windowStart: number,
  limit: number,
  by = 1,
): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES (?, ?, ?)
       ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + excluded.hits
       RETURNING hits`,
    )
    .bind(bucket, windowStart, by)
    .first<{ hits: number }>();
  if ((row?.hits ?? by) > limit) throw new HttpError(429, "rate");
}

async function hitsOf(db: D1Database, bucket: string, windowStart: number): Promise<number> {
  const row = await db
    .prepare("SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?")
    .bind(bucket, windowStart)
    .first<{ hits: number }>();
  return row?.hits ?? 0;
}

export async function assertRateLimit(
  db: D1Database,
  action: RateAction,
  ip: string,
  email: string,
  now: number,
  options?: { countEmail?: boolean },
): Promise<void> {
  const windowStart = windowStartOf(now);
  await prune(db, now);
  await addHit(db, `${action}:ip:${rateLimitIp(ip)}`, windowStart, RATE_LIMITS[`${action}:ip`]);
  const emailBucket = `${action}:email:${email}`;
  const emailLimit = RATE_LIMITS[`${action}:email`];
  // A successful login must not add to the per-email bucket. The caller checks
  // the current count here, then records a hit only after a wrong password.
  if (options?.countEmail === false) {
    if ((await hitsOf(db, emailBucket, windowStart)) >= emailLimit) throw new HttpError(429, "rate");
    return;
  }
  await addHit(db, emailBucket, windowStart, emailLimit);
}

export async function assertIpRateLimit(
  db: D1Database,
  action: IpRateAction,
  ip: string,
  now: number,
): Promise<void> {
  const windowStart = windowStartOf(now);
  await prune(db, now);
  await addHit(db, `${action}:ip:${rateLimitIp(ip)}`, windowStart, RATE_LIMITS[`${action}:ip`]);
}

/** Count one failed login toward the per-email limit. The per-IP limit is already counted. */
export async function recordFailedLogin(db: D1Database, email: string, now: number): Promise<void> {
  const windowStart = windowStartOf(now);
  await addHit(db, `login:email:${email}`, windowStart, RATE_LIMITS["login:email"]);
}

/**
 * Count `rows` against today's ceiling before a write that anyone can trigger.
 * Throws 429 once the day's budget is gone; the caller writes nothing.
 */
export async function assertDailyWriteBudget(
  db: D1Database,
  kind: keyof typeof DAILY_WRITE_BUDGET,
  now: number,
  rows: number,
): Promise<void> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  await addHit(db, `${DAILY_PREFIX}${kind}:${dayStart}`, dayStart, DAILY_WRITE_BUDGET[kind], Math.max(1, rows));
}

/**
 * Changes a reader may make to their avatar in one UTC day. Each change writes the picture to R2,
 * can rebuild contributors.json, and gives the picture a new address that every reader downloads
 * again, so once a day is plenty for a real reader and stops a script from spending the writes.
 */
export const AVATAR_PER_DAY = 1;

/** Refused because today's avatar change is used. `nextAt` is the start of the next UTC day. */
export class AvatarDailyError extends HttpError {
  readonly nextAt: number;
  constructor(nextAt: number) {
    super(429, "avatar-daily");
    this.nextAt = nextAt;
  }
}

/**
 * Take today's avatar change (UTC day) for this reader, or throw AvatarDailyError when it is used.
 * One atomic upsert, so two uploads at the same moment cannot both pass. Call it after the file
 * was checked: a refused file must not use the change.
 */
export async function takeAvatarChange(db: D1Database, userId: string, now: number): Promise<void> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  await prune(db, now);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + 1
       RETURNING hits`,
    )
    .bind(`${DAILY_PREFIX}avatar:${userId}:${dayStart}`, dayStart)
    .first<{ hits: number }>();
  if ((row?.hits ?? 1) > AVATAR_PER_DAY) throw new AvatarDailyError(dayStart + DAY_MS);
}

/**
 * Actions counted in batches: frequent, cheap to repeat, and limited only so one account cannot
 * loop them to spend the site's quota. Writing one D1 row per sync was about a third of all D1
 * writes. An instance keeps a local count and adds it to D1 every USER_BATCH requests; the first
 * request of an account in an instance reads the shared count instead of writing. The limit is
 * then approximate: each running instance may let through up to USER_BATCH - 1 requests that D1
 * has not seen yet, and a count lost with a stopped instance is never added. Sign-in, codes,
 * sponsorship, feedback and taps are still counted on every request.
 */
const BATCHED: ReadonlySet<UserRateAction> = new Set(["sync", "glossary"]);
export const USER_BATCH = 10;
type Tally = { windowStart: number; known: number; pending: number };
/** Per running instance: bucket -> what this instance knows and has not written yet. */
const tallies = new Map<string, Tally>();

/** Tests only: forget the counts this instance holds. */
export function resetUserTallies(): void {
  tallies.clear();
}

/** Limit an endpoint that needs a signed-in account, per account rather than per address. */
export async function assertUserRateLimit(
  db: D1Database,
  action: UserRateAction,
  userId: string,
  now: number,
): Promise<void> {
  const windowStart = windowStartOf(now);
  const bucket = `${action}:user:${userId}`;
  const limit = RATE_LIMITS[`${action}:user`];
  await prune(db, now);
  if (!BATCHED.has(action)) {
    await addHit(db, bucket, windowStart, limit);
    return;
  }
  let tally = tallies.get(bucket);
  if (!tally || tally.windowStart !== windowStart) {
    if (tallies.size > 2000) {
      for (const [key, value] of tallies) if (value.windowStart !== windowStart) tallies.delete(key);
    }
    // First request of this account in this window here: one read, no write.
    tally = { windowStart, known: await hitsOf(db, bucket, windowStart), pending: 0 };
    tallies.set(bucket, tally);
  }
  tally.pending += 1;
  if (tally.pending >= USER_BATCH) {
    const by = tally.pending;
    tally.pending = 0;
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (bucket, window_start, hits)
         VALUES (?, ?, ?)
         ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + excluded.hits
         RETURNING hits`,
      )
      .bind(bucket, windowStart, by)
      .first<{ hits: number }>();
    tally.known = row?.hits ?? tally.known + by;
  }
  if (tally.known + tally.pending > limit) throw new HttpError(429, "rate");
}
