/** Where to reach the people who run the site. Set VITE_CONTACT_EMAIL at build time to show an email address. */
export const CONTACT_EMAIL: string = (import.meta.env.VITE_CONTACT_EMAIL ?? "").trim();

/** The public source repository. */
export const REPO_URL = "https://github.com/duwqijlk/margin-words";

/** The Telegram group. The + in the invite link is part of the address. */
export const TELEGRAM_URL = "https://t.me/+seLkV61aCx9hM2Vh";

/** Fallback when no email is set: the project page, where anyone can open an issue. */
export const CONTACT_URL = `${REPO_URL}/issues`;
