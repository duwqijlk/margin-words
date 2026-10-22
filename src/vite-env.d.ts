/// <reference types="vite/client" />

declare module "virtual:local-ipa-data" {
  export const version: string;
  export const loaders: Record<string, () => Promise<unknown>>;
}

interface ImportMetaEnv {
  /** Book-file host. Empty, "." or "./" keeps same-origin paths. Unset in production uses the books domain. */
  readonly VITE_BOOKS_BASE?: string;
  /** Optional Turnstile site key. Empty or unset leaves the register check off. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** Optional contact email shown on the Guide page. Unset shows a link to the project's issue page. */
  readonly VITE_CONTACT_EMAIL?: string;
}
