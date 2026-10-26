import { isContributor, publishContributors } from "../../lib/contributors.ts";
import { avatarPath } from "../../../src/lib/contributors-file.ts";
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
 * DELETE removes it from the profile and deletes the file, so a removed picture is gone from the
 * public host too (its address holds the public id, which is printed in word lists).
 * Only a reader with a checked email may set one, once a day (`AVATAR_PER_DAY`). Removing is free.
 */

/**
 * Each picture has its own key, avatars/<public id>-<rev>.webp, and is never written again: a
 * cached copy of an address is always the picture that address named, so the file can be kept for
 * a year by the browser and the CDN, like a cover. A new picture gets a new rev and the old file
 * is deleted.
 */
export function avatarKey(publicId: string, rev: number): string {
  return avatarPath(publicId, rev);
}

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
    const old = await env.DB.prepare("SELECT avatar_rev FROM users WHERE id = ?").bind(user.id).first<{ avatar_rev: number }>();
    // A new version number is a new key: the new picture never overwrites an address a page cached.
    const rev = Math.max(1, Math.floor(now / 1000), (old?.avatar_rev ?? 0) + 1);
    await env.BOOKS.put(avatarKey(user.public_id, rev), bytes, { httpMetadata: AVATAR_HTTP });
    await env.DB.prepare("UPDATE users SET avatar_rev = ? WHERE id = ?").bind(rev, user.id).run();
    await removeAvatarFiles(env.BOOKS, user.public_id, old?.avatar_rev ?? 0);
    if (await isContributor(env.DB, user.id)) await publishContributors(env.DB, env.BOOKS, now);
    return json({ ok: true, avatar: rev });
  } catch (error) {
    // The page says when the next change is allowed.
    if (error instanceof AvatarDailyError) return json({ error: error.code, nextAt: error.nextAt }, 429);
    return errorResponse(error);
  }
}

/** Delete a reader's old picture: the versioned key, and the one key every picture used before. */
async function removeAvatarFiles(bucket: NonNullable<Env["BOOKS"]>, publicId: string, rev: number): Promise<void> {
  if (!bucket.delete) return;
  const keys = [`avatars/${publicId}.webp`, ...(rev > 0 ? [avatarKey(publicId, rev)] : [])];
  for (const key of keys) await bucket.delete(key).catch(() => undefined);
}

export async function handleAvatarDelete(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    const now = options?.now ?? Date.now();
    const user = await requireUser(env.DB, request, now);
    const old = await env.DB.prepare("SELECT avatar_rev FROM users WHERE id = ?").bind(user.id).first<{ avatar_rev: number }>();
    await env.DB.prepare("UPDATE users SET avatar_rev = 0 WHERE id = ?").bind(user.id).run();
    if (env.BOOKS && user.public_id) await removeAvatarFiles(env.BOOKS, user.public_id, old?.avatar_rev ?? 0);
    if (env.BOOKS && (await isContributor(env.DB, user.id))) await publishContributors(env.DB, env.BOOKS, now);
    return json({ ok: true, avatar: 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
