import type { Env } from "../../lib/db.ts";
import { handleMe } from "../../lib/handlers.ts";

export const onRequestGet = (context: { request: Request; env: Env }) => handleMe(context.request, context.env);
