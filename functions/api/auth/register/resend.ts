import type { Env } from "../../../lib/db.ts";
import { handleRegisterResend } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleRegisterResend(context.request, context.env);
