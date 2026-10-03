/** Where to reach the people who run the site. Set VITE_CONTACT_EMAIL at build time to show an email address. */
export const CONTACT_EMAIL: string = (import.meta.env.VITE_CONTACT_EMAIL ?? "").trim();

/** Fallback when no email is set: the project page, where anyone can open an issue. */
export const CONTACT_URL = "https://github.com/duwqijlk/margin-words/issues";
