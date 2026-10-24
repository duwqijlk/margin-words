import type { Env } from "../../../lib/db.ts";
import { handleEmailCodeConfirm } from "../../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleEmailCodeConfirm(context.request, context.env);
