import type { D1Database, UserRow } from "./db.ts";
import { clearSessionCookie, HttpError, sessionCookie, sessionTokenHash } from "./http.ts";
import { randomToken, sha256Hex } from "./password.ts";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(
  db: D1Database,
  userId: string,
  request: Request,
  now: number,
): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?")
    .bind(userId, now)
    .run();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, now, now + SESSION_MS)
    .run();
  return sessionCookie(token, request);
}

export async function userFromRequest(db: D1Database, request: Request, now: number): Promise<UserRow | null> {
  const tokenHash = await sessionTokenHash(request);
  if (!tokenHash) return null;
  const row = await db
    .prepare(
      `SELECT users.id, users.email, users.password_hash, users.password_salt, users.password_iters, users.created_at,
              sessions.expires_at AS session_expires
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<UserRow & { session_expires: number }>();
  if (!row) return null;
  if (row.session_expires <= now) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return row;
}

export async function requireUser(db: D1Database, request: Request, now: number): Promise<UserRow> {
  const user = await userFromRequest(db, request, now);
  if (!user) throw new HttpError(401, "unauthorized");
  return user;
}

export async function destroySession(db: D1Database, request: Request): Promise<void> {
  const tokenHash = await sessionTokenHash(request);
  if (!tokenHash) return;
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export function logoutCookie(request: Request): string {
  return clearSessionCookie(request);
}
