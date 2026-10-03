import type { Env } from "../../../lib/db.ts";
import { handlePasswordResetRequest } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handlePasswordResetRequest(context.request, context.env);
