/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Book-file host. Empty, "." or "./" keeps same-origin paths. Unset in production uses the books domain. */
  readonly VITE_BOOKS_BASE?: string;
  /** Optional Turnstile site key. Empty or unset leaves the register check off. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
