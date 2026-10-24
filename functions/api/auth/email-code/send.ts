import type { Env } from "../../../lib/db.ts";
import { handleEmailCodeSend } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleEmailCodeSend(context.request, context.env);
