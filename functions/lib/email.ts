/**
 * Password-reset delivery hook.
 *
 * The account system can create a one-time reset token and a link. It does not
 * send email: users are in mainland China, and no mail provider is configured.
 * To turn sending on, replace `deliverPasswordReset` with a call to your mailer.
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
