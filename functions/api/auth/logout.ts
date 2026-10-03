import type { Env } from "../../lib/db.ts";
import { handleLogout } from "../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) => handleLogout(context.request, context.env);
