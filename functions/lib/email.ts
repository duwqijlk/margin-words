/**
 * Password-reset delivery.
 *
 * When RESEND_API_KEY is set, handlePasswordResetRequest sends the reset mail
 * through Resend (https://api.resend.com/emails) from no-reply@inputread.site.
 * Unset keeps sending off and the app shows that email reset is not turned on.
 * Do not log the token. Return `{ sent: true }` only after the provider accepts it.
 *
 * The link shape is: `${origin}/shelf?reset=${token}`
 * The confirm endpoint is POST /api/auth/password-reset/confirm `{ token, password }`.
 */

export type PasswordResetMessage = {
  email: string;
  resetUrl: string;
  token: string;
  expiresAt: number;
};

export type PasswordResetSender = (message: PasswordResetMessage) => Promise<{ sent: boolean }>;

export const deliverPasswordReset: PasswordResetSender = async () => {
  return { sent: false };
};

const FROM = "inputread <no-reply@inputread.site>";
const SUBJECT = "Reset your inputread password";

function bodyOf(message: PasswordResetMessage): { text: string; html: string } {
  const text = [
    "Someone asked to reset the password for this email on inputread.",
    "",
    `Open this link to choose a new password: ${message.resetUrl}`,
    "",
    "The link works for one hour. If this was not you, ignore this email and your password stays the same.",
  ].join("\n");
  const html = [
    "<p>Someone asked to reset the password for this email on inputread.</p>",
    `<p><a href="${message.resetUrl}">Choose a new password</a></p>`,
    `<p>Or paste this link into your browser: <code>${message.resetUrl}</code></p>`,
    "<p>The link works for one hour. If this was not you, ignore this email and your password stays the same.</p>",
  ].join("");
  return { text, html };
}

/** One message through Resend. True only when Resend accepted it. */
async function sendWithResend(apiKey: string, to: string, subject: string, text: string, html: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    // Only the outcome is logged: never the address, the link or the code.
    if (!response.ok) console.warn(`resend: ${subject}: HTTP ${response.status}`);
    return response.ok;
  } catch {
    console.warn(`resend: ${subject}: request failed`);
    return false;
  }
}

export function resendSender(apiKey: string): PasswordResetSender {
  return async (message) => {
    const { text, html } = bodyOf(message);
    return { sent: await sendWithResend(apiKey, message.email, SUBJECT, text, html) };
  };
}

/**
 * The code that checks a new account's email. Six digits, valid for 15 minutes. Do not log it.
 */
export type EmailCodeMessage = { email: string; code: string };

export type EmailCodeSender = (message: EmailCodeMessage) => Promise<{ sent: boolean }>;

export const deliverEmailCode: EmailCodeSender = async () => ({ sent: false });

const CODE_SUBJECT = "Your inputread code";

export function resendCodeSender(apiKey: string): EmailCodeSender {
  return async ({ email, code }) => {
    const text = [
      `Your inputread code is ${code}.`,
      "",
      "Type it in the sign-up window to finish making your account. It works for 15 minutes.",
      "If you did not sign up on inputread, ignore this email.",
    ].join("\n");
    const html = [
      `<p>Your inputread code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p>`,
      "<p>Type it in the sign-up window to finish making your account. It works for 15 minutes.</p>",
      "<p>If you did not sign up on inputread, ignore this email.</p>",
    ].join("");
    return { sent: await sendWithResend(apiKey, email, CODE_SUBJECT, text, html) };
  };
}
