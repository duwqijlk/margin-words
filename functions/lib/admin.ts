import { SPONSOR_EMAIL } from "../../src/lib/sponsor.ts";
import type { Env, UserRow } from "./db.ts";
import { HttpError } from "./http.ts";
import { requireUser } from "./session.ts";
import type { HandlerOptions } from "./handlers.ts";

/**
 * "admin" is the owner account (the role, or the official email before the
 * row is marked). "trusted" may open private-library EPUBs. Everyone else is
 * a plain user. This is the stored role. An expired grant stays "trusted"
 * here so the admin list can show that it ended.
 */
export function roleOf(row: { role?: string | null; email: string }): UserRow["role"] {
  if (row.role === "admin" || row.email.trim().toLowerCase() === SPONSOR_EMAIL) return "admin";
  return row.role === "trusted" ? "trusted" : "user";
}

/** The role that gates downloads. A trusted grant past trusted_until is a plain user. */
export function effectiveRole(
  row: { role?: string | null; email: string; trusted_until?: number | null },
  now: number,
): UserRow["role"] {
  const role = roleOf(row);
  if (role !== "trusted") return role;
  if (row.trusted_until == null) return "trusted";
  return row.trusted_until > now ? "trusted" : "user";
}

export async function requireAdmin(db: Env["DB"], request: Request, options?: HandlerOptions): Promise<UserRow> {
  const user = await requireUser(db, request, options?.now ?? Date.now());
  if (roleOf(user) !== "admin") throw new HttpError(403, "forbidden");
  return user;
}

export async function requireTrusted(db: Env["DB"], request: Request, options?: HandlerOptions): Promise<UserRow> {
  const now = options?.now ?? Date.now();
  const user = await requireUser(db, request, now);
  if (effectiveRole(user, now) === "user") throw new HttpError(403, "forbidden");
  return user;
}
