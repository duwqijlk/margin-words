import type { Env } from "../../lib/db.ts";
import { handleLogin } from "../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) => handleLogin(context.request, context.env);
