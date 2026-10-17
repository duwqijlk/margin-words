import { requireAdmin, roleOf } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { isTrustTerm, trustedUntil } from "../../lib/trust.ts";

type ListRow = {
  id: string;
  email: string;
  nickname: string | null;
  role: string;
  created_at: number;
  trusted_until?: number | null;
};

export const onRequestGet = (context: { request: Request; env: Env }) => handleList(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) => handleSetRole(context.request, context.env);

export async function handleList(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
    const pageSize = 20;
    // An empty query matches every row, so one WHERE shape serves both cases.
    const like = `%${query.replace(/([%_\\])/g, "\\$1")}%`;
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
       WHERE lower(users.email) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(users.nickname, '')) LIKE ?1 ESCAPE '\\'`,
    )
      .bind(like)
      .first<{ n: number }>();
    const rows = await env.DB.prepare(
      `SELECT users.id, users.email, users.nickname, users.role, users.trusted_until, users.created_at
       FROM users
       WHERE lower(users.email) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(users.nickname, '')) LIKE ?1 ESCAPE '\\'
       ORDER BY users.created_at DESC
       LIMIT ?2 OFFSET ?3`,
    )
      .bind(like, pageSize, (page - 1) * pageSize)
      .all<ListRow>();

    const now = options?.now ?? Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const daily = await env.DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch', '+8 hours') AS day, COUNT(*) AS count
       FROM users
       WHERE created_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
      .bind(thirtyDaysAgo)
      .all<{ day: string; count: number }>();

    return json({
      total: total?.n ?? 0,
      page,
      pageSize,
      daily: daily.results ?? [],
      users: rows.results.map((row) => ({
        id: row.id,
        email: row.email,
        nickname: row.nickname,
        role: roleOf(row),
        trustedUntil: typeof row.trusted_until === "number" ? row.trusted_until : null,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSetRole(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const admin = await requireAdmin(env.DB, request, options);
    const now = options?.now ?? Date.now();
    const body = (await readJson(request, 8_000)) as { id?: unknown; role?: unknown; term?: unknown };
    if (typeof body.id !== "string" || !body.id) throw new HttpError(400, "bad-request");
    const role = body.role === "trusted" ? "trusted" : "user";
    // An omitted term keeps the old grant button working: access that does not expire.
    if (role === "trusted" && body.term !== undefined && !isTrustTerm(body.term)) throw new HttpError(400, "bad-term");
    const until = role === "trusted" ? trustedUntil(isTrustTerm(body.term) ? body.term : "forever", now) : null;
    const existing = await env.DB.prepare("SELECT id, email, nickname, role FROM users WHERE id = ?")
      .bind(body.id)
      .first<ListRow>();
    if (!existing) throw new HttpError(404, "no-user");
    if (roleOf(existing) === "admin") throw new HttpError(400, "admin-locked");
    await env.DB.prepare("UPDATE users SET role = ?, trusted_until = ? WHERE id = ?").bind(role, until, existing.id).run();
    return json({
      user: {
        id: existing.id,
        email: existing.email,
        nickname: existing.nickname,
        role,
        trustedUntil: until,
      },
      by: admin.id,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
