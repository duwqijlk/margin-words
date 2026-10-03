import type { Env } from "../../lib/db.ts";
import { handleRegister } from "../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleRegister(context.request, context.env);
