import { isContributor, publishContributors } from "../../lib/contributors.ts";
import type { Env } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { errorResponse, HttpError, json } from "../../lib/http.ts";
import { AvatarDailyError, takeAvatarChange } from "../../lib/rate-limit.ts";
import { requireUser } from "../../lib/session.ts";

/** Largest avatar accepted, in bytes. The page sends a 128x128 WebP, usually 5 to 15 KB. */
export const AVATAR_MAX = 64 * 1024;

/**
 * Set the signed-in reader's avatar: PUT a WebP image as the raw body. It is stored on the public
 * books host as avatars/<public_id>.webp, so pages show it from the CDN with no Function call.
 * DELETE removes it from the profile (the file stays until it is replaced; nothing links to it).
 * Only a reader with a checked email may set one, once a day (`AVATAR_PER_DAY`). Removing is free.
 */

/**
 * Pages load avatars/<id>.webp?v=<rev>. A new picture gets a new rev, so the address never shows an
 * old picture and the file can be kept for a year by the browser and the CDN, like a cover.
 */
export const AVATAR_HTTP = { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" };
export const onRequestPut = (context: { request: Request; env: Env }) => handleAvatarPut(context.request, context.env);
export const onRequestDelete = (context: { request: Request; env: Env }) => handleAvatarDelete(context.request, context.env);

/** RIFF....WEBP: the first 12 bytes of every WebP file. */
export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  return tag(0) === "RIFF" && tag(8) === "WEBP";
}

export async function handleAvatarPut(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = options?.now ?? Date.now();
    const user = await requireUser(env.DB, request, now);
    if (!user.email_verified_at) throw new HttpError(403, "email-unverified");
    if (!user.public_id) throw new HttpError(500, "no-public-id");
    if (!env.BOOKS) throw new HttpError(500, "no-books-bucket");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > AVATAR_MAX) throw new HttpError(413, "too-large");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > AVATAR_MAX) throw new HttpError(413, "too-large");
    if (!isWebp(bytes)) throw new HttpError(415, "avatar-type");
    await takeAvatarChange(env.DB, user.id, now);
    await env.BOOKS.put(`avatars/${user.public_id}.webp`, bytes, { httpMetadata: AVATAR_HTTP });
    // A new version number makes every page fetch the new picture instead of a cached one.
    const rev = Math.max(1, Math.floor(now / 1000));
    await env.DB.prepare("UPDATE users SET avatar_rev = ? WHERE id = ?").bind(rev, user.id).run();
    if (await isContributor(env.DB, user.id)) await publishContributors(env.DB, env.BOOKS, now);
    return json({ ok: true, avatar: rev });
  } catch (error) {
    // The page says when the next change is allowed.
    if (error instanceof AvatarDailyError) return json({ error: error.code, nextAt: error.nextAt }, 429);
    return errorResponse(error);
  }
}

export async function handleAvatarDelete(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = options?.now ?? Date.now();
    const user = await requireUser(env.DB, request, now);
    await env.DB.prepare("UPDATE users SET avatar_rev = 0 WHERE id = ?").bind(user.id).run();
    if (env.BOOKS && (await isContributor(env.DB, user.id))) await publishContributors(env.DB, env.BOOKS, now);
    return json({ ok: true, avatar: 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
