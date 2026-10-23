import { requireAdmin } from "../../lib/admin.ts";
import type { Env, R2BucketLike } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import {
  BLURB_ID,
  blurbFile,
  blurbKey,
  blurbProblems,
  parseBlurbFile,
  type BlurbKind,
} from "../../../src/lib/book-blurb-file.ts";

/**
 * A book's story summary, for the Discover sheet.
 *   GET /api/admin/blurb?kind=lists|public&id=<book id>     read it back
 *   PUT /api/admin/blurb?kind=lists|public&id=<book id>     { zh?, en? }  replace it
 * The file is word-lists/<id>/blurb.json or public-books/<id>/blurb.json. Only a book that is in
 * that catalog can have one, so a mistyped id never leaves a stray file. It does not touch catalog.json.
 */
export const onRequestGet = (context: { request: Request; env: Env }) => handleGet(context.request, context.env);
export const onRequestPut = (context: { request: Request; env: Env }) => handlePut(context.request, context.env);

function target(request: Request): { kind: BlurbKind; id: string } {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "public" ? "public" : "lists";
  const id = url.searchParams.get("id") ?? "";
  if (!BLURB_ID.test(id)) throw new HttpError(400, "bad-id");
  return { kind, id };
}

async function inCatalog(bucket: R2BucketLike, kind: BlurbKind, id: string): Promise<boolean> {
  const object = await bucket.get(kind === "public" ? "public-books/catalog.json" : "word-lists/catalog.json");
  if (!object) return false;
  try {
    const catalog = JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as {
      lists?: { id?: unknown }[];
      packs?: { id?: unknown }[];
    };
    const rows = (kind === "public" ? catalog.packs : catalog.lists) ?? [];
    return rows.some((row) => row?.id === id);
  } catch {
    return false;
  }
}

export async function handleGet(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const { kind, id } = target(request);
    const object = await bucket.get(blurbKey(kind, id));
    if (!object) return json({ kind, id, zh: "", en: "" });
    let value: unknown = null;
    try {
      value = JSON.parse(new TextDecoder().decode(await object.arrayBuffer()));
    } catch {
      value = null;
    }
    return json({ kind, id, ...parseBlurbFile(value) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePut(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const { kind, id } = target(request);
    const body = (await readJson(request, 20_000)) as { zh?: unknown; en?: unknown };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad-request");
    const problems = blurbProblems(body);
    if (problems.length) return json({ error: "bad-blurb", problems }, 400);
    if (!(await inCatalog(bucket, kind, id))) throw new HttpError(404, "no-book");
    const file = blurbFile(body);
    await bucket.put(blurbKey(kind, id), new TextEncoder().encode(`${JSON.stringify(file, null, 1)}\n`));
    return json({ kind, id, zh: file.zh ?? "", en: file.en ?? "" });
  } catch (error) {
    return errorResponse(error);
  }
}
