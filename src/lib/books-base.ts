/**
 * Where book files live. The front end (dist/) does not contain them.
 *
 * Production builds use https://books.inputread.site unless VITE_BOOKS_BASE is set.
 * Dev, and any build with VITE_BOOKS_BASE empty, "." or "./", use same-origin
 * paths (/public-books/..., /word-lists/...) so tests can run with no network.
 */
export const DEFAULT_BOOKS_BASE = "https://books.inputread.site";

export function booksBase(): string {
  const raw = import.meta.env.VITE_BOOKS_BASE;
  if (raw === "" || raw === "." || raw === "./") return "";
  if (typeof raw === "string" && raw.trim()) return raw.trim().replace(/\/+$/, "");
  return import.meta.env.PROD ? DEFAULT_BOOKS_BASE : "";
}

/** Address of a book file. `path` is like `public-books/catalog.json` (no leading slash). */
export function booksUrl(path: string): string {
  const rel = path.replace(/^\/+/, "");
  const base = booksBase();
  if (!base) return `/${rel}`;
  return `${base}/${rel}`;
}
