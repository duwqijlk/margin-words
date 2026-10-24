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
  "sponsor:ip": 10,
  "sponsor:email": 5,
  "taps:ip": 60,
  "feedback:ip": 30,
  // Per signed-in account. Any free account can call these in a loop, and each call is a D1 read
  // plus an R2 get of a word list or a sync body - a cheap way to spend someone else's quota.
  "glossary:user": 120,
  "sync:user": 300,
} as const;

export type RateAction = "login" | "register" | "reset" | "sponsor";
export type IpRateAction = RateAction | "taps" | "feedback";
export type UserRateAction = "glossary" | "sync";

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

async function prune(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(`DELETE FROM rate_limits WHERE bucket NOT LIKE '${DAILY_PREFIX}%' AND window_start < ?`)
    .bind(now - RATE_WINDOW_MS * 4)
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

/** Limit an endpoint that needs a signed-in account, per account rather than per address. */
export async function assertUserRateLimit(
  db: D1Database,
  action: UserRateAction,
  userId: string,
  now: number,
): Promise<void> {
  const windowStart = windowStartOf(now);
  await prune(db, now);
  await addHit(db, `${action}:user:${userId}`, windowStart, RATE_LIMITS[`${action}:user`]);
}
