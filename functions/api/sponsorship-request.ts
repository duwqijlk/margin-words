import type { Env } from "../lib/db.ts";
import { handleMySponsorship } from "../lib/sponsorship.ts";

export const onRequestGet = (context: { request: Request; env: Env }) =>
  handleMySponsorship(context.request, context.env);
