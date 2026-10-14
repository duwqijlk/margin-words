import { requireAdmin } from "../../lib/admin.ts";
import type { Env } from "../../lib/db.ts";
import type { HandlerOptions } from "../../lib/handlers.ts";
import { readGlossaryWork, writeGlossaryWork } from "../../lib/glossary-work-file.ts";
import { errorResponse, HttpError, json, readJson } from "../../lib/http.ts";
import { applyGlossaryWork, glossaryWorkFile, readWorkToggle } from "../../../src/lib/glossary-work.ts";

/**
 * Mark a book whose glossary is being made, or clear that mark.
 *   GET /api/admin/glossary-work
 *   PUT /api/admin/glossary-work   { kind: "lists" | "public", id, making }
 * Stored at word-lists/glossary-work.json. It does not touch catalog.json.
 */
export const onRequestGet = (context: { request: Request; env: Env }) => handleGet(context.request, context.env);
export const onRequestPut = (context: { request: Request; env: Env }) => handlePut(context.request, context.env);

/** The admin page reads this. It is not the public books host, so a cached copy cannot hide a new mark. */
export async function handleGet(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const items = await readGlossaryWork(bucket);
    return json(glossaryWorkFile(items, new Date().toISOString()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePut(request: Request, env: Env, options?: HandlerOptions): Promise<Response> {
  try {
    await requireAdmin(env.DB, request, options);
    const bucket = env.BOOKS;
    if (!bucket) throw new HttpError(500, "no-books-bucket");
    const toggle = readWorkToggle(await readJson(request, 10_000));
    if (!toggle) throw new HttpError(400, "bad-work");
    const items = await readGlossaryWork(bucket);
    const now = new Date().toISOString();
    const next = applyGlossaryWork(items, toggle.kind, toggle.id, toggle.making, now);
    if (!next) throw new HttpError(400, "bad-work");
    await writeGlossaryWork(bucket, next, now);
    return json(glossaryWorkFile(next, now));
  } catch (error) {
    return errorResponse(error);
  }
}
