import { sha256Hex } from "./password.ts";

export const SESSION_COOKIE = "mw_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200, headers?: Headers): Response {
  const next = headers ?? new Headers();
  next.set("content-type", "application/json; charset=utf-8");
  next.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: next });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code }, error.status);
  return json({ error: "server" }, 500);
}

export async function readJson(request: Request, max = 1_500_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "too-large");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "bad-json");
  }
}

export function clientIp(request: Request): string {
  const header =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "local";
  return header.trim().slice(0, 80) || "local";
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Eight lowercase groups, or null when the text is not an IPv6 address. */
function expandIpv6(value: string): string[] | null {
  if (value.includes(".")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const padded: string[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    padded.push(group.padStart(4, "0"));
  }
  return padded;
}

/**
 * Key used for per-IP rate limits. IPv4 is unchanged. IPv6 is the /64 prefix,
 * so a household or school prefix shares one bucket instead of a new one per address.
 */
export function rateLimitIp(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!raw) return "local";
  const mapped = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped && isIpv4(mapped[1] ?? "")) return mapped[1] ?? raw;
  if (raw.includes(":")) {
    const groups = expandIpv6(raw);
    if (groups) return `${groups.slice(0, 4).join(":")}::/64`;
  }
  if (isIpv4(raw)) return raw;
  return raw.slice(0, 80);
}

/** Secure only on https. Wrangler pages dev is http on localhost, where a Secure cookie is dropped. */
export function sessionCookie(token: string, request: Request, maxAge = SESSION_SECONDS): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
  return sessionCookie("", request, 0);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return rest.join("=") || "";
  }
  return null;
}

export async function sessionTokenHash(request: Request): Promise<string | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  return sha256Hex(token);
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!EMAIL.test(email)) return null;
  return email;
}

export function passwordProblem(value: unknown): "password" | null {
  if (typeof value !== "string") return "password";
  if (value.length < 8 || value.length > 128) return "password";
  if (value.includes("\0")) return "password";
  return null;
}
