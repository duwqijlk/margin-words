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
} as const;

export type RateAction = "login" | "register" | "reset";

async function prune(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("DELETE FROM rate_limits WHERE window_start < ?")
    .bind(now - RATE_WINDOW_MS * 4)
    .run();
}

function windowStartOf(now: number): number {
  return Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
}

async function addHit(db: D1Database, bucket: string, windowStart: number, limit: number): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + 1
       RETURNING hits`,
    )
    .bind(bucket, windowStart)
    .first<{ hits: number }>();
  if ((row?.hits ?? 1) > limit) throw new HttpError(429, "rate");
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

/** Count one failed login toward the per-email limit. The per-IP limit is already counted. */
export async function recordFailedLogin(db: D1Database, email: string, now: number): Promise<void> {
  const windowStart = windowStartOf(now);
  await addHit(db, `login:email:${email}`, windowStart, RATE_LIMITS["login:email"]);
}
