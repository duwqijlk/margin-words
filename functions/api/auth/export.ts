import type { Env } from "../../lib/db.ts";
import { handleExport } from "../../lib/handlers.ts";

export const onRequestGet = (context: { request: Request; env: Env }) => handleExport(context.request, context.env);
