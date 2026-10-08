import { SPONSOR_EMAIL, isSponsorAdmin, isSponsorMethod, parseUsdToCents, sponsorBoards, sponsorName } from "../../src/lib/sponsor.ts";
import type { Env } from "./db.ts";
import { clientIp, errorResponse, HttpError, json, readJson } from "./http.ts";
import { assertRateLimit } from "./rate-limit.ts";
import { requireUser } from "./session.ts";
import type { HandlerOptions } from "./handlers.ts";

function nowOf(options?: HandlerOptions): number {
  return options?.now ?? Date.now();
}

type GiftRow = {
  user_id: string;
  display_name: string;
  amount_cents: number;
  listed_at: number;
};

type AdminRow = {
  id: string;
  email: string;
  display_name: string;
  method: string;
  created_at: number;
  email_sent_at: number | null;
  amount_cents: number | null;
  listed_at: number | null;
  closed_at: number | null;
};

function adminView(row: AdminRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    method: row.method,
    createdAt: row.created_at,
    emailSentAt: row.email_sent_at,
    amountCents: row.amount_cents,
    listedAt: row.listed_at,
    closedAt: row.closed_at,
  };
}

export async function handlePublicSponsorships(_request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `SELECT user_id, display_name, amount_cents, listed_at
       FROM sponsorships
       WHERE listed_at IS NOT NULL AND amount_cents > 0 AND closed_at IS NULL`,
    ).all<GiftRow>();
    const boards = sponsorBoards(
      rows.results.map((row) => ({
        userId: row.user_id,
        name: row.display_name,
        cents: row.amount_cents,
        listedAt: row.listed_at,
      })),
      nowOf(options),
    );
    return json(boards);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCreateSponsorship(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    const user = await requireUser(env.DB, request, now);
    await assertRateLimit(env.DB, "sponsor", clientIp(request), user.email, now);
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    if (!isSponsorMethod(body.method)) throw new HttpError(400, "method");
    const name = sponsorName(body.displayName ?? user.nickname);
    if (!name) throw new HttpError(400, "name");
    const open = await env.DB.prepare(
      "SELECT id FROM sponsorships WHERE user_id = ? AND listed_at IS NULL AND closed_at IS NULL",
    )
      .bind(user.id)
      .first<{ id: string }>();
    if (open) throw new HttpError(409, "open");
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO sponsorships (id, user_id, method, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, user.id, body.method, name, now)
      .run();
    return json({ id, displayName: name, method: body.method, officialEmail: SPONSOR_EMAIL }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMySponsorship(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await requireUser(env.DB, request, nowOf(options));
    const row = await env.DB.prepare(
      `SELECT id, method, display_name, created_at, email_sent_at
       FROM sponsorships
       WHERE user_id = ? AND listed_at IS NULL AND closed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(user.id)
      .first<{ id: string; method: string; display_name: string; created_at: number; email_sent_at: number | null }>();
    return json({
      officialEmail: SPONSOR_EMAIL,
      open: row
        ? {
            id: row.id,
            method: row.method,
            displayName: row.display_name,
            createdAt: row.created_at,
            emailSent: row.email_sent_at != null,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireAdmin(env: Env, request: Request, now: number) {
  const user = await requireUser(env.DB, request, now);
  if (!isSponsorAdmin(user.email)) throw new HttpError(403, "forbidden");
  return user;
}

export async function handleAdminSponsorshipsGet(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env, request, nowOf(options));
    const rows = await env.DB.prepare(
      `SELECT sponsorships.id, users.email, sponsorships.display_name, sponsorships.method,
              sponsorships.created_at, sponsorships.email_sent_at, sponsorships.amount_cents,
              sponsorships.listed_at, sponsorships.closed_at
       FROM sponsorships JOIN users ON users.id = sponsorships.user_id
       ORDER BY sponsorships.created_at DESC
       LIMIT 200`,
    ).all<AdminRow>();
    return json({ requests: rows.results.map(adminView) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAdminSponsorshipsPost(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = nowOf(options);
    await requireAdmin(env, request, now);
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "id");
    const row = await env.DB.prepare(
      `SELECT sponsorships.id, users.email, sponsorships.display_name, sponsorships.method,
              sponsorships.created_at, sponsorships.email_sent_at, sponsorships.amount_cents,
              sponsorships.listed_at, sponsorships.closed_at
       FROM sponsorships JOIN users ON users.id = sponsorships.user_id
       WHERE sponsorships.id = ?`,
    )
      .bind(id)
      .first<AdminRow>();
    if (!row) throw new HttpError(404, "missing");
    if (body.action === "email") {
      if (row.email_sent_at == null && row.closed_at == null) {
        await env.DB.prepare("UPDATE sponsorships SET email_sent_at = ? WHERE id = ?").bind(now, id).run();
        row.email_sent_at = now;
      }
      return json({ request: adminView(row) });
    }
    if (body.action === "close") {
      if (row.listed_at == null && row.closed_at == null) {
        await env.DB.prepare("UPDATE sponsorships SET closed_at = ? WHERE id = ?").bind(now, id).run();
        row.closed_at = now;
      }
      return json({ request: adminView(row) });
    }
    if (body.action === "list") {
      if (row.listed_at != null) throw new HttpError(409, "listed");
      if (row.closed_at != null) throw new HttpError(409, "closed");
      const cents = parseUsdToCents(body.amount);
      if (cents == null) throw new HttpError(400, "amount");
      const emailed = row.email_sent_at ?? now;
      await env.DB.prepare(
        "UPDATE sponsorships SET amount_cents = ?, listed_at = ?, email_sent_at = ? WHERE id = ?",
      )
        .bind(cents, now, emailed, id)
        .run();
      row.amount_cents = cents;
      row.listed_at = now;
      row.email_sent_at = emailed;
      return json({ request: adminView(row) });
    }
    throw new HttpError(400, "action");
  } catch (error) {
    return errorResponse(error);
  }
}
