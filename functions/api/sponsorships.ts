import type { Env } from "../lib/db.ts";
import { handleCreateSponsorship, handlePublicSponsorships } from "../lib/sponsorship.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handlePublicSponsorships(context.request, context.env);

export const onRequestPost = (context: { request: Request; env: Env }) =>
  handleCreateSponsorship(context.request, context.env);
