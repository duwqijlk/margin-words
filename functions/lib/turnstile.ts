/** Login, registration, and the password-reset request check. Off unless TURNSTILE_SECRET_KEY is set. */

const ALLOWED_HOSTS = new Set(["inputread.site", "www.inputread.site", "margin-words.pages.dev"]);

export type TurnstileAction = "signup" | "login" | "reset";

export async function verifyTurnstile(
  secret: string | undefined,
  token: unknown,
  remoteIp: string,
  action: TurnstileAction,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret) return true;
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp && remoteIp !== "local") body.set("remoteip", remoteIp);
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
    return data.success === true && data.action === action && ALLOWED_HOSTS.has(data.hostname ?? "");
  } catch {
    return false;
  }
}
