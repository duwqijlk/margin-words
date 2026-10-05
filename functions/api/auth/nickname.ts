import type { Env } from "../../lib/db.ts";
import { handleNickname } from "../../lib/handlers.ts";

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleNickname(context.request, context.env);
