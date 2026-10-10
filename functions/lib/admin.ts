import { SPONSOR_EMAIL } from "../../src/lib/sponsor.ts";
import type { Env, UserRow } from "./db.ts";
import { HttpError } from "./http.ts";
import { requireUser } from "./session.ts";
import type { HandlerOptions } from "./handlers.ts";

/**
 * "admin" is the owner account (the role, or the official email before the
 * row is marked). "trusted" may open private-library EPUBs. Everyone else is
 * a plain user.
 */
export function roleOf(row: { role?: string | null; email: string }): UserRow["role"] {
  if (row.role === "admin" || row.email.trim().toLowerCase() === SPONSOR_EMAIL) return "admin";
  return row.role === "trusted" ? "trusted" : "user";
}

export async function requireAdmin(db: Env["DB"], request: Request, options?: HandlerOptions): Promise<UserRow> {
  const user = await requireUser(db, request, options?.now ?? Date.now());
  if (roleOf(user) !== "admin") throw new HttpError(403, "forbidden");
  return user;
}

export async function requireTrusted(db: Env["DB"], request: Request, options?: HandlerOptions): Promise<UserRow> {
  const user = await requireUser(db, request, options?.now ?? Date.now());
  if (roleOf(user) === "user") throw new HttpError(403, "forbidden");
  return user;
}
