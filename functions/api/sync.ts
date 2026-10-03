import type { Env } from "../lib/db.ts";
import { handleSyncPull, handleSyncPush } from "../lib/handlers.ts";

export const onRequestGet = (context: { request: Request; env: Env }) => handleSyncPull(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) => handleSyncPush(context.request, context.env);
