/** Optional Cloudflare Turnstile. Off unless TURNSTILE_SECRET_KEY is set. */

export async function verifyTurnstile(
  secret: string | undefined,
  token: unknown,
  remoteIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret) return true;
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp && remoteIp !== "local") body.set("remoteip", remoteIp);
  const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}
