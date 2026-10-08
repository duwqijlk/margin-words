import type { Env } from "../../lib/db.ts";
import { handleAdminSponsorshipsGet, handleAdminSponsorshipsPost } from "../../lib/sponsorship.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleAdminSponsorshipsGet(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleAdminSponsorshipsPost(context.request, context.env);
