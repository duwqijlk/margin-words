import type { Env } from "../../lib/db.ts";
import { handleDelete } from "../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) => handleDelete(context.request, context.env);
