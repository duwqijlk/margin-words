import { requireTrusted } from "../../../lib/admin.ts";
import type { Env } from "../../../lib/db.ts";
import { errorResponse, HttpError } from "../../../lib/http.ts";
import type { HandlerOptions } from "../../../lib/handlers.ts";

const DAILY_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stream one copyrighted EPUB from the private bucket to a trusted reader.
 * The bucket itself has no public access; every byte goes through this check:
 * signed in, trusted (or admin), under a daily download cap, and logged.
 */
export const onRequestGet = async (context: { request: Request; env: Env; params: { id: string } }) =>
  handleEpub(context.request, context.env, context.params.id);

export async function handleEpub(request: Request, env: Env, id: string, options?: HandlerOptions): Promise<Response> {
  try {
    const user = await requireTrusted(env.DB, request, options);
    const bucket = env.PRIVATE;
    if (!bucket) throw new HttpError(500, "no-private-bucket");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new HttpError(400, "bad-id");
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM book_downloads WHERE user_id = ? AND created_at > ?")
      .bind(user.id, Date.now() - DAY_MS)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= DAILY_LIMIT) throw new HttpError(429, "rate");
    const object = await bucket.get(`${id}/book.epub`);
    if (!object) throw new HttpError(404, "no-book");
    await env.DB.prepare("INSERT INTO book_downloads (user_id, book_id, created_at) VALUES (?, ?, ?)")
      .bind(user.id, id, Date.now())
      .run();
    return new Response(object.body, {
      headers: {
        "content-type": "application/epub+zip",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${id}.epub"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
