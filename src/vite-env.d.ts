/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Book-file host. Empty, "." or "./" keeps same-origin paths. Unset in production uses the books domain. */
  readonly VITE_BOOKS_BASE?: string;
  /** Optional Turnstile site key. Empty or unset leaves the register check off. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** Optional contact email shown on the About page. Unset shows a link to the project's issue page. */
  readonly VITE_CONTACT_EMAIL?: string;
}
