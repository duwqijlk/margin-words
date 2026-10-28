import { cleanNickname } from "../../src/lib/nickname.ts";
import { SYNC_BODY_MAX, SYNC_CURSOR_OVERLAP_MS, SYNC_PUSH_MAX } from "../../src/lib/limits.ts";
import { mergeItem, normalizeItem, type SyncItem } from "../../src/lib/sync-merge.ts";
import { effectiveRole } from "./admin.ts";
import { isContributor, publishContributors } from "./contributors.ts";
import { speechIds } from "./book-category.ts";
import { glossaryWeekUsed, GLOSSARY_WEEK_BOOKS, GLOSSARY_WEEK_SPEECHES } from "./trust.ts";
import type { D1Result, Env, SyncRow, UserRow } from "./db.ts";
import {
  deliverEmailCode,
  deliverPasswordReset,
  resendCodeSender,
  resendSender,
  type EmailCodeSender,
  type PasswordResetSender,
} from "./email.ts";
import {
  clientIp,
  errorResponse,
  HttpError,
  json,
  normalizeEmail,
  passwordProblem,
  readJson,
} from "./http.ts";
import { hashPassword, PBKDF2_ITERATIONS, randomToken, sha256Hex, verifyPassword } from "./password.ts";
import { assertRateLimit, assertUserRateLimit, recordFailedLogin } from "./rate-limit.ts";
import { createSession, destroySession, logoutCookie, requireUser, userFromRequest } from "./session.ts";
import { verifyTurnstile } from "./turnstile.ts";

export type HandlerOptions = {
  now?: number;
  fetch?: typeof fetch;
  sendReset?: PasswordResetSender;
  sendCode?: EmailCodeSender;
};

function nowOf(options?: HandlerOptions): number {
  return options?.now ?? Date.now();
}

function withCookie(body: unknown, status: number, cookie: string): Response {
  const headers = new Headers();
  headers.append("set-cookie", cookie);
  return json(body, status, headers);
}

function publicUser(
  row: Pick<UserRow, "id" | "email" | "created_at" | "nickname" | "role"> & {
    trusted_until?: number | null;
    email_verified_at?: number | null;
    public_id?: string | null;
    avatar_rev?: number | null;
  },
  now: number,
) {
  const nickname = typeof row.nickname === "string" && row.nickname ? row.nickname : null;
  const emailVerified = typeof row.email_verified_at === "number" && row.email_verified_at > 0;
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    nickname,
    role: effectiveRole(row, now),
    emailVerified,
    publicId: row.public_id ?? null,
    avatar: row.avatar_rev ?? 0,
  };
}

/** A reader's public id: 12 lowercase hex characters, shown and written into word lists instead of the email. */
export function newPublicId(): string {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CODE_MS = 15 * 60 * 1000;
const CODE_ATTEMPTS = 5;

/** A fresh 6-digit code for this account, replacing any open one. Returns false when it could not be sent. */
async function sendEmailCode(env: Env, userId: string, email: string, now: number, options?: HandlerOptions): Promise<boolean> {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(digits).padStart(6, "0");
  // The code is bound to the account, so its hash cannot be reused for another one.
  const codeHash = await sha256Hex(`${userId}:${code}`);
  await env.DB.prepare(
    `INSERT INTO email_codes (user_id, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
       expires_at = excluded.expires_at, attempts = 0`,
  )
    .bind(userId, codeHash, now, now + CODE_MS)
    .run();
  const send = options?.sendCode ?? (env.RESEND_API_KEY ? resendCodeSender(env.RESEND_API_KEY) : deliverEmailCode);
  return (await send({ email, code })).sent;
}

/** True when `ticket` is the one this pending sign-up was given. */
async function ticketMatches(ticket: unknown, ticketHash: string): Promise<boolean> {
  if (typeof ticket !== "string" || ticket.length < 20 || ticket.length > 100 || !ticketHash) return false;
  return (await sha256Hex(ticket)) === ticketHash;
}

/**
 * Start a sign-up: check the form, keep it as a pending sign-up, and email a 6-digit code.
 * No account exists yet and nothing is signed in. The account is made only when the code comes
 * back (handleRegisterConfirm), so a mistyped address (gamil.com) leaves no account behind.
 * Registering the same address again replaces the pending sign-up (new password, new code), at
 * most once a minute, and always passes the human check again: so a stranger cannot keep
 * replacing a reader's sign-up without solving it each time.
 *
 * The answer carries a ticket (random, only its hash is kept). Send again and the code step need
 * it, so only the browser that started this sign-up can resend or finish it.
 *
 *   POST /api/auth/register   { email, password, turnstileToken }   -> { pending, email, codeSent, ticket }
 */
export async function handleRegister(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "email");
    if (passwordProblem(body.password)) throw new HttpError(400, "password");
    const password = body.password as string;
    await assertRateLimit(env.DB, "register", clientIp(request), email, now);
    const human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, clientIp(request), "signup", options?.fetch);
    if (!human) throw new HttpError(403, "turnstile");
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) throw new HttpError(409, "email-taken");
    // Pending sign-ups whose code ran out are gone; the address is free again.
    await env.DB.prepare("DELETE FROM pending_signups WHERE expires_at <= ?").bind(now).run();
    const last = await env.DB.prepare("SELECT created_at FROM pending_signups WHERE email = ?")
      .bind(email)
      .first<{ created_at: number }>();
    if (last && now - last.created_at < 60_000) throw new HttpError(429, "code-wait");
    const hashed = await hashPassword(password);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    // The code is bound to the address, so its hash says nothing about another one.
    const codeHash = await sha256Hex(`signup:${email}:${code}`);
    const ticket = randomToken();
    await env.DB.prepare(
      `INSERT INTO pending_signups (email, password_hash, password_salt, password_iters, code_hash, attempts, created_at, expires_at, ticket_hash)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt,
         password_iters = excluded.password_iters, code_hash = excluded.code_hash, attempts = 0,
         created_at = excluded.created_at, expires_at = excluded.expires_at, ticket_hash = excluded.ticket_hash`,
    )
      .bind(email, hashed.hash, hashed.salt, hashed.iterations, codeHash, now, now + CODE_MS, await sha256Hex(ticket))
      .run();
    const send = options?.sendCode ?? (env.RESEND_API_KEY ? resendCodeSender(env.RESEND_API_KEY) : deliverEmailCode);
    const codeSent = (await send({ email, code })).sent;
    if (!codeSent) {
      // A code that never left cannot finish the sign-up: drop it, so trying again is not blocked.
      await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?").bind(email).run();
      throw new HttpError(502, "code-send");
    }
    return json({ pending: true, email, codeSent, ticket }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * A new code for a sign-up in progress ("Send again"). No human check, but it needs the ticket
 * from registering: only the browser that started this sign-up can ask. At most once a minute,
 * within the register limit; the old code stops working and the attempts start over only then.
 * The password stays the one typed at the start.
 *
 *   POST /api/auth/register/resend   { email, ticket }   -> { pending: true, email, codeSent }
 */
export async function handleRegisterResend(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "email");
    await assertRateLimit(env.DB, "register", clientIp(request), email, now);
    const row = await env.DB.prepare("SELECT created_at, expires_at, ticket_hash FROM pending_signups WHERE email = ?")
      .bind(email)
      .first<{ created_at: number; expires_at: number; ticket_hash: string }>();
    // Nothing to resend: the reader starts the sign-up again (a 15-minute-old one is gone too).
    if (!row || row.expires_at <= now) throw new HttpError(400, "code-expired");
    if (!(await ticketMatches(body.ticket, row.ticket_hash))) throw new HttpError(400, "code-expired");
    if (now - row.created_at < 60_000) throw new HttpError(429, "code-wait");
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    await env.DB.prepare(
      "UPDATE pending_signups SET code_hash = ?, attempts = 0, created_at = ?, expires_at = ? WHERE email = ?",
    )
      .bind(await sha256Hex(`signup:${email}:${code}`), now, now + CODE_MS, email)
      .run();
    const send = options?.sendCode ?? (env.RESEND_API_KEY ? resendCodeSender(env.RESEND_API_KEY) : deliverEmailCode);
    if (!(await send({ email, code })).sent) throw new HttpError(502, "code-send");
    return json({ pending: true, email, codeSent: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Finish a sign-up with the emailed code: make the account (its email already checked) and sign in.
 * Five wrong codes end the pending sign-up; the reader registers again for a new code.
 *
 *   POST /api/auth/register/confirm   { email, code, ticket }   -> 201 { user }, with the session cookie
 */
export async function handleRegisterConfirm(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "email");
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, "code");
    // Its own limit: a reader who mistypes the code must not run into the sign-up limit. The code
    // itself ends after CODE_ATTEMPTS wrong tries, so guessing six digits is not possible.
    await assertRateLimit(env.DB, "signup-code", clientIp(request), email, now);
    const row = await env.DB.prepare(
      "SELECT password_hash, password_salt, password_iters, code_hash, attempts, expires_at, ticket_hash FROM pending_signups WHERE email = ?",
    )
      .bind(email)
      .first<{ password_hash: string; password_salt: string; password_iters: number; code_hash: string; attempts: number; expires_at: number; ticket_hash: string }>();
    if (!row || row.expires_at <= now || row.attempts >= CODE_ATTEMPTS) throw new HttpError(400, "code-expired");
    // The code alone is not enough: the ticket shows this is the browser that started the sign-up.
    if (!(await ticketMatches(body.ticket, row.ticket_hash))) throw new HttpError(400, "code-expired");
    if ((await sha256Hex(`signup:${email}:${code}`)) !== row.code_hash) {
      await env.DB.prepare("UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
      throw new HttpError(400, "code");
    }
    const id = crypto.randomUUID();
    const publicId = newPublicId();
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, password_iters, created_at, email_verified_at, public_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(id, email, row.password_hash, row.password_salt, row.password_iters, now, now, publicId)
        .run();
    } catch (error) {
      // Someone finished the same address a moment earlier.
      if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new HttpError(409, "email-taken");
      throw error;
    }
    await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?").bind(email).run();
    const cookie = await createSession(env.DB, id, request, now);
    return withCookie(
      { user: publicUser({ id, email, created_at: now, nickname: null, role: "user", email_verified_at: now, public_id: publicId }, now) },
      201,
      cookie,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogin(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "email");
    if (passwordProblem(body.password)) throw new HttpError(401, "credentials");
    const password = body.password as string;
    // No human check on login. Turnstile's challenge host does not finish on some networks in
    // mainland China (docs/ACCOUNTS.md), and a reader who already has an account must still be
    // able to sign in. Registration and the reset request keep the check; this route is covered
    // by the per-IP and per-email limits below, plus recordFailedLogin.
    await assertRateLimit(env.DB, "login", clientIp(request), email, now, { countEmail: false });
    const user = await env.DB.prepare(
      "SELECT id, email, nickname, role, trusted_until, password_hash, password_salt, password_iters, created_at FROM users WHERE email = ?",
    )
      .bind(email)
      .first<UserRow>();
    // Hash even when the email is unknown so the response time is similar.
    const ok = user
      ? await verifyPassword(password, user.password_hash, user.password_salt, user.password_iters)
      : await verifyPassword(password, "nope", "AAAAAAAAAAAAAAAAAAAAAA==", PBKDF2_ITERATIONS).then(() => false);
    if (!user || !ok) {
      await recordFailedLogin(env.DB, email, now);
      throw new HttpError(401, "credentials");
    }
    // A hash minted under an older count (the 100k era) is rewritten at the current one, so the
    // next sign-in is cheap. `!==` rather than `<`: the count went DOWN to fit the Free plan's
    // 10ms CPU budget, and an old 100k hash would otherwise stay expensive for ever.
    if (user.password_iters !== PBKDF2_ITERATIONS) {
      const next = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ? WHERE id = ?")
        .bind(next.hash, next.salt, next.iterations, user.id)
        .run();
    }
    const cookie = await createSession(env.DB, user.id, request, now);
    return withCookie({ user: publicUser(user, now) }, 200, cookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  try {
    await destroySession(env.DB, request);
    return withCookie({ ok: true }, 200, logoutCookie(request));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Send (again) the code that checks the signed-in account's email. */
export async function handleEmailCodeSend(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    if (user.email_verified_at) return json({ ok: true, verified: true });
    await assertUserRateLimit(env.DB, "code-send", user.id, now);
    // At most one code a minute: a click on Send again right after sign-up does not spend a message.
    const last = await env.DB.prepare("SELECT created_at FROM email_codes WHERE user_id = ?")
      .bind(user.id)
      .first<{ created_at: number }>();
    if (last && now - last.created_at < 60_000) throw new HttpError(429, "code-wait");
    const sent = await sendEmailCode(env, user.id, user.email, now, options);
    if (!sent) throw new HttpError(502, "code-send");
    return json({ ok: true, sent: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Check the emailed code. A right code marks the email checked; five wrong ones end that code. */
export async function handleEmailCodeConfirm(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    if (user.email_verified_at) return json({ user: publicUser(user, now) });
    await assertUserRateLimit(env.DB, "code-check", user.id, now);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, "code");
    const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM email_codes WHERE user_id = ?")
      .bind(user.id)
      .first<{ code_hash: string; expires_at: number; attempts: number }>();
    if (!row || row.expires_at <= now || row.attempts >= CODE_ATTEMPTS) throw new HttpError(400, "code-expired");
    if ((await sha256Hex(`${user.id}:${code}`)) !== row.code_hash) {
      await env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ?").bind(user.id).run();
      throw new HttpError(400, "code");
    }
    await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(now, user.id).run();
    await env.DB.prepare("DELETE FROM email_codes WHERE user_id = ?").bind(user.id).run();
    return json({ user: publicUser({ ...user, email_verified_at: now }, now) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMe(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await userFromRequest(env.DB, request, now);
    const resetEmail = Boolean(env.RESEND_API_KEY);
    // 200 so a signed-out page load is not a failed request in the browser console.
    // Other routes still use requireUser and answer 401.
    if (!user) return json({ user: null, resetEmail });
    const unlimited = effectiveRole(user, now) !== "user";
    const week = unlimited
      ? { novels: { used: 0, resetAt: 0 }, speeches: { used: 0, resetAt: 0 } }
      : await glossaryWeekUsed(env.DB, user.id, now, await speechIds(env.BOOKS));
    return json({
      user: publicUser(user, now),
      resetEmail,
      // used/limit stay the novel count, so an older client still reads them.
      glossary: {
        used: week.novels.used,
        limit: GLOSSARY_WEEK_BOOKS,
        resetAt: week.novels.resetAt,
        unlimited,
        speech: { used: week.speeches.used, limit: GLOSSARY_WEEK_SPEECHES, resetAt: week.speeches.resetAt },
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleNickname(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await requireUser(env.DB, request, nowOf(options));
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const nickname = cleanNickname(body.nickname);
    if (!nickname) throw new HttpError(400, "nickname");
    await env.DB.prepare("UPDATE users SET nickname = ? WHERE id = ?").bind(nickname, user.id).run();
    // A credited reader's new name shows on their meanings and in the rank.
    if (env.BOOKS && (await isContributor(env.DB, user.id))) await publishContributors(env.DB, env.BOOKS, nowOf(options));
    return json({ user: publicUser({ ...user, nickname }, nowOf(options)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleDelete(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;
    if (typeof body.password !== "string" || passwordProblem(body.password)) throw new HttpError(401, "credentials");
    const ok = await verifyPassword(body.password, user.password_hash, user.password_salt, user.password_iters);
    if (!ok) throw new HttpError(401, "credentials");
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    return withCookie({ ok: true }, 200, logoutCookie(request));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleExport(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await requireUser(env.DB, request, nowOf(options));
    const items = await env.DB.prepare(
      "SELECT kind, item_id, data, updated_at, deleted FROM sync_items WHERE user_id = ? ORDER BY kind, item_id",
    )
      .bind(user.id)
      .all<SyncRow>();
    return json({
      exportedAt: nowOf(options),
      account: { email: user.email, createdAt: user.created_at, nickname: user.nickname ?? null },
      items: items.results.map(rowToItem),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePasswordResetRequest(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "email");
    await assertRateLimit(env.DB, "reset", clientIp(request), email, now);
    const human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, clientIp(request), "reset", options?.fetch);
    if (!human) throw new HttpError(403, "turnstile");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    // Always the same response. The hook decides whether a message is actually sent.
    if (user) {
      const token = randomToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = now + 60 * 60 * 1000;
      await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id).run();
      await env.DB.prepare(
        "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
      )
        .bind(tokenHash, user.id, now, expiresAt)
        .run();
      const origin = new URL(request.url).origin;
      // A test may pass its own sender; otherwise use Resend when the key is set.
      const send = options?.sendReset ?? (env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY) : deliverPasswordReset);
      await send({
        email,
        token,
        resetUrl: `${origin}/shelf?reset=${encodeURIComponent(token)}`,
        expiresAt,
      });
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePasswordResetConfirm(
  request: Request,
  env: Env,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const now = nowOf(options);
    const body = (await readJson(request, 20_000)) as Record<string, unknown>;
    if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 200) {
      throw new HttpError(400, "token");
    }
    if (passwordProblem(body.password)) throw new HttpError(400, "password");
    const tokenHash = await sha256Hex(body.token);
    const row = await env.DB.prepare(
      "SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
    )
      .bind(tokenHash)
      .first<{ user_id: string; expires_at: number; used_at: number | null }>();
    if (!row || row.used_at || row.expires_at <= now) throw new HttpError(400, "token");
    const hashed = await hashPassword(body.password as string);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ? WHERE id = ?")
      .bind(hashed.hash, hashed.salt, hashed.iterations, row.user_id)
      .run();
    await env.DB.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function rowToItem(row: SyncRow): SyncItem {
  let data: unknown = {};
  try {
    data = JSON.parse(row.data) as unknown;
  } catch {
    data = {};
  }
  const item = normalizeItem(
    {
      kind: row.kind,
      itemId: row.item_id,
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
      data,
    },
    Number.MAX_SAFE_INTEGER,
  );
  return (
    item ?? {
      kind: "settings",
      itemId: row.item_id,
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
      data,
    }
  );
}

/**
 * GET /api/sync                 every row of the account (a device's first pull, or a periodic check)
 * GET /api/sync?after=<cursor>  only rows the server wrote after the cursor: the usual pull
 * GET /api/sync?since=<ms>      rows whose item time is newer (older clients; kept as it was)
 *
 * Every answer carries `cursor` for the next `after`. A full pull of a large word book is several
 * MB of JSON to parse and write again, which is what ran past the Free plan's 10ms of CPU; a pull
 * with `after` reads only what changed.
 */
export async function handleSyncPull(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    await assertUserRateLimit(env.DB, "sync", user.id, now);
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? "");
    const since = Number(url.searchParams.get("since") ?? "0");
    const hasAfter = url.searchParams.has("after") && Number.isFinite(after) && after >= 0;
    const hasSince = !hasAfter && Number.isFinite(since) && since > 0;
    const columns = "SELECT kind, item_id, data, updated_at, deleted FROM sync_items";
    const items = hasAfter
      ? await env.DB.prepare(`${columns} WHERE user_id = ? AND server_at > ? ORDER BY kind, item_id`).bind(user.id, after).all<SyncRow>()
      : hasSince
        ? await env.DB.prepare(`${columns} WHERE user_id = ? AND updated_at > ? ORDER BY kind, item_id`).bind(user.id, since).all<SyncRow>()
        : await env.DB.prepare(`${columns} WHERE user_id = ? ORDER BY kind, item_id`).bind(user.id).all<SyncRow>();
    // Read before the rows: a write stamped later is in the next pull; the overlap covers one
    // stamped a moment earlier that was still committing (see SYNC_CURSOR_OVERLAP_MS).
    const cursor = Math.max(0, now - SYNC_CURSOR_OVERLAP_MS);
    return json({ items: items.results.map(rowToItem), cursor, full: !hasAfter && !hasSince });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSyncPush(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    await assertUserRateLimit(env.DB, "sync", user.id, now);
    const body = (await readJson(request, SYNC_BODY_MAX)) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) throw new HttpError(400, "bad-request");
    // 200, not 500. Every item costs a read, a merge and a JSON round trip in the same request,
    // and 500 of them is a solid slice of the 10ms CPU the Free plan allows. The client sends at
    // most this many per request and calls again for the rest.
    if (body.items.length > SYNC_PUSH_MAX) throw new HttpError(413, "too-large");
    const incoming: SyncItem[] = [];
    for (const raw of body.items) {
      const item = normalizeItem(raw, now);
      if (!item) throw new HttpError(400, "bad-item");
      incoming.push(item);
    }
    // Phase 1: read the existing rows for every item in one round trip.
    const readBatch = incoming.map((item) =>
      env.DB.prepare("SELECT kind, item_id, data, updated_at, deleted FROM sync_items WHERE user_id = ? AND kind = ? AND item_id = ?")
        .bind(user.id, item.kind, item.itemId),
    );
    const readResults = (await env.DB.batch(readBatch)) as D1Result<SyncRow>[];
    // Phase 2: merge, then write everything as one atomic transaction (SYNC_PUSH_MAX is the size
    // of one D1 batch). A failure mid-push rolls back instead of leaving half the items saved.
    const saved: SyncItem[] = [];
    const writeBatch = incoming.map((item, index) => {
      const rows = readResults[index]?.results ?? [];
      const existing = rows.length > 0 ? rowToItem(rows[0] as SyncRow) : undefined;
      const merged = mergeItem(existing, item) ?? item;
      saved.push(merged);
      return env.DB.prepare(
        `INSERT INTO sync_items (user_id, kind, item_id, data, updated_at, deleted, server_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, kind, item_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted,
           server_at = excluded.server_at`,
      )
        // server_at is this server's clock, the cursor other devices pull from (migration 0021).
        .bind(user.id, merged.kind, merged.itemId, JSON.stringify(merged.data), merged.updatedAt, merged.deleted ? 1 : 0, now);
    });
    if (writeBatch.length > 0) await env.DB.batch(writeBatch);
    return json({ items: saved });
  } catch (error) {
    return errorResponse(error);
  }
}
