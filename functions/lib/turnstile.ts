/** Registration check. Off unless TURNSTILE_SECRET_KEY is set. */

const SIGNUP_ACTION = "signup";
const SIGNUP_HOSTS = new Set(["inputread.site", "www.inputread.site", "margin-words.pages.dev"]);

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
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
    return data.success === true && data.action === SIGNUP_ACTION && SIGNUP_HOSTS.has(data.hostname ?? "");
  } catch {
    return false;
  }
}
