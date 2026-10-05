/**
 * Addresses of the app. Every top-menu page has its own path, so back/forward, refresh and
 * a link to a page all work:
 *
 *   /shelf            Bookshelf        /discover         Discover
 *   /dashboard        How many books, marked words, and paragraph notes
 *   /guide            Guide (how to use the app, and about the site)
 *   /thanks           Thank-you page for supporters
 *   /words            Word book (all books)
 *   /words/<bookId>   Word book of one book
 *   /review[/<id>]    Review           /read/<bookId>    the reader
 *
 * `/` and unknown paths go to /shelf. `/add` (the old add-book page) reads as Discover, the only
 * place that adds books. `/about` (the old About page) reads as the Guide. A small hand-made
 * router: the app has no server and a handful of addresses, so a library would add more code
 * than it saves.
 */
import { useSyncExternalStore } from "react";

export type Route =
  | { kind: "shelf" }
  | { kind: "discover" }
  | { kind: "dashboard" }
  | { kind: "guide" }
  | { kind: "thanks" }
  | { kind: "words"; bookId: string | null }
  | { kind: "review"; bookId: string | null }
  | { kind: "read"; bookId: string };

export const DEFAULT_ROUTE: Route = { kind: "shelf" };

/** Book ids are UUIDs or pack ids. Anything else in a path is refused. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/** The route of a path, or null when the path is not an address of the app. */
export function parsePath(pathname: string): Route | null {
  const parts = pathname.split("/").filter(Boolean);
  const [head, rest, extra] = parts;
  if (extra !== undefined) return null;
  const decoded = rest === undefined ? "" : safeDecode(rest);
  const id = rest !== undefined && ID.test(decoded) ? decoded : null;
  if (rest !== undefined && id === null) return null;
  switch (head) {
    case "shelf":
      return rest === undefined ? { kind: "shelf" } : null;
    case "add":
      // The old add-book page: books are added on Discover now.
      return rest === undefined ? { kind: "discover" } : null;
    case "discover":
      return rest === undefined ? { kind: "discover" } : null;
    case "dashboard":
      return rest === undefined ? { kind: "dashboard" } : null;
    case "guide":
      return rest === undefined ? { kind: "guide" } : null;
    case "thanks":
      return rest === undefined ? { kind: "thanks" } : null;
    case "about":
      // The old About page is the Guide now. The app replaces this address with /guide.
      return rest === undefined ? { kind: "guide" } : null;
    case "words":
      return { kind: "words", bookId: id };
    case "review":
      return { kind: "review", bookId: id };
    case "read":
      return id === null ? null : { kind: "read", bookId: id };
    default:
      return null;
  }
}

export function pathFor(route: Route): string {
  switch (route.kind) {
    case "words":
      return route.bookId ? `/words/${encodeURIComponent(route.bookId)}` : "/words";
    case "review":
      return route.bookId ? `/review/${encodeURIComponent(route.bookId)}` : "/review";
    case "read":
      return `/read/${encodeURIComponent(route.bookId)}`;
    default:
      return `/${route.kind}`;
  }
}

/** Which top-menu page a route belongs to. */
export function menuOf(route: Route): "shelf" | "discover" | "dashboard" | "guide" | "words" | "thanks" {
  switch (route.kind) {
    case "discover":
      return "discover";
    case "dashboard":
      return "dashboard";
    case "guide":
      return "guide";
    case "thanks":
      return "thanks";
    case "words":
    case "review":
      return "words";
    default:
      return "shelf";
  }
}

const CHANGED = "cibian-route";

function currentPath(): string {
  return typeof window === "undefined" ? "/shelf" : window.location.pathname;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * Go to a page. `replace` swaps the current history entry (used for redirects).
 * `state` stays on that entry. Starting a review stores `{ review: "due" }` so a refresh
 * of that visit opens the cards again. Every other visit clears the state.
 */
export function navigate(route: Route, options: { replace?: boolean; state?: unknown } = {}): void {
  const path = pathFor(route);
  const state = options.state === undefined ? null : options.state;
  if (window.location.pathname !== path) {
    if (options.replace) window.history.replaceState(state, "", path);
    else window.history.pushState(state, "", path);
  } else if (options.state !== undefined) {
    window.history.replaceState(state, "", path);
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** True when this history entry was opened by "Start review" and should show the cards. */
export function reviewDueIntent(): boolean {
  const state = window.history.state as { review?: unknown } | null;
  return Boolean(state && typeof state === "object" && state.review === "due");
}

/** The route of the address bar. An address that is not a page of the app reads as the shelf. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, currentPath, () => "/shelf");
  return parsePath(path) ?? DEFAULT_ROUTE;
}

/** True when the address bar is not a page of the app ("/" or a typo): the caller redirects. */
export function pathNeedsRedirect(): boolean {
  return parsePath(currentPath()) === null;
}
