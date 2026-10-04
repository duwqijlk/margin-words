import { mergeItem, normalizeItem, type SyncItem } from "../../src/lib/sync-merge.ts";
import type { Env, SyncRow, UserRow } from "./db.ts";
import { deliverPasswordReset, type PasswordResetSender } from "./email.ts";
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
import { assertRateLimit, recordFailedLogin } from "./rate-limit.ts";
import { createSession, destroySession, logoutCookie, requireUser, userFromRequest } from "./session.ts";
import { verifyTurnstile } from "./turnstile.ts";

export type HandlerOptions = {
  now?: number;
  fetch?: typeof fetch;
  sendReset?: PasswordResetSender;
};

function nowOf(options?: HandlerOptions): number {
  return options?.now ?? Date.now();
}

function withCookie(body: unknown, status: number, cookie: string): Response {
  const headers = new Headers();
  headers.append("set-cookie", cookie);
  return json(body, status, headers);
}

async function publicUser(row: UserRow) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

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
    const hashed = await hashPassword(password);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, password_iters, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(id, email, hashed.hash, hashed.salt, hashed.iterations, now)
        .run();
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new HttpError(409, "email-taken");
      throw error;
    }
    const cookie = await createSession(env.DB, id, request, now);
    return withCookie({ user: { id, email, createdAt: now } }, 201, cookie);
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
    const human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, clientIp(request), "login", options?.fetch);
    if (!human) throw new HttpError(403, "turnstile");
    await assertRateLimit(env.DB, "login", clientIp(request), email, now, { countEmail: false });
    const user = await env.DB.prepare(
      "SELECT id, email, password_hash, password_salt, password_iters, created_at FROM users WHERE email = ?",
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
    if (user.password_iters < PBKDF2_ITERATIONS) {
      const next = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ? WHERE id = ?")
        .bind(next.hash, next.salt, next.iterations, user.id)
        .run();
    }
    const cookie = await createSession(env.DB, user.id, request, now);
    return withCookie({ user: await publicUser(user) }, 200, cookie);
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

export async function handleMe(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await userFromRequest(env.DB, request, nowOf(options));
    // 200 so a signed-out page load is not a failed request in the browser console.
    // Other routes still use requireUser and answer 401.
    if (!user) return json({ user: null });
    return json({ user: await publicUser(user) });
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
      account: { email: user.email, createdAt: user.created_at },
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
      const send = options?.sendReset ?? deliverPasswordReset;
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

export async function handleSyncPull(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await requireUser(env.DB, request, nowOf(options));
    const url = new URL(request.url);
    const since = Number(url.searchParams.get("since") ?? "0");
    const hasSince = Number.isFinite(since) && since > 0;
    const query = hasSince
      ? "SELECT kind, item_id, data, updated_at, deleted FROM sync_items WHERE user_id = ? AND updated_at > ? ORDER BY kind, item_id"
      : "SELECT kind, item_id, data, updated_at, deleted FROM sync_items WHERE user_id = ? ORDER BY kind, item_id";
    const statement = env.DB.prepare(query);
    const items = hasSince
      ? await statement.bind(user.id, since).all<SyncRow>()
      : await statement.bind(user.id).all<SyncRow>();
    return json({ items: items.results.map(rowToItem) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSyncPush(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    const body = (await readJson(request)) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) throw new HttpError(400, "bad-request");
    if (body.items.length > 500) throw new HttpError(413, "too-large");
    const saved: SyncItem[] = [];
    for (const raw of body.items) {
      const incoming = normalizeItem(raw, now);
      if (!incoming) throw new HttpError(400, "bad-item");
      const existing = await env.DB.prepare(
        "SELECT kind, item_id, data, updated_at, deleted FROM sync_items WHERE user_id = ? AND kind = ? AND item_id = ?",
      )
        .bind(user.id, incoming.kind, incoming.itemId)
        .first<SyncRow>();
      const merged = mergeItem(existing ? rowToItem(existing) : undefined, incoming) ?? incoming;
      await env.DB.prepare(
        `INSERT INTO sync_items (user_id, kind, item_id, data, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, kind, item_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
      )
        .bind(user.id, merged.kind, merged.itemId, JSON.stringify(merged.data), merged.updatedAt, merged.deleted ? 1 : 0)
        .run();
      saved.push(merged);
    }
    return json({ items: saved });
  } catch (error) {
    return errorResponse(error);
  }
}
