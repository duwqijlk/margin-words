import type { Env } from "../../../lib/db.ts";
import { handlePasswordResetConfirm } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handlePasswordResetConfirm(context.request, context.env);
