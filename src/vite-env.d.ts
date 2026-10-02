/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Book-file host. Empty, "." or "./" keeps same-origin paths. Unset in production uses the books domain. */
  readonly VITE_BOOKS_BASE?: string;
}
