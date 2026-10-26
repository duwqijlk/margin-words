import type { Env } from "../../../lib/db.ts";
import { handleRegisterConfirm } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleRegisterConfirm(context.request, context.env);
