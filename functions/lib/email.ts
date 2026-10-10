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

export function resendSender(apiKey: string): PasswordResetSender {
  return async (message) => {
    try {
      const { text, html } = bodyOf(message);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: [message.email],
          subject: SUBJECT,
          text,
          html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return { sent: response.ok };
    } catch {
      return { sent: false };
    }
  };
}
