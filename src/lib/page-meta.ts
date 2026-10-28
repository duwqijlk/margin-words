/**
 * The title, canonical address and index rule of each screen, for the browser tab and for search
 * engines that run the app (Google renders it; the rest read index.html, see scripts/seo-plugin.mjs).
 *
 *   - The home page (the shelf, at `/`) keeps the title index.html ships with: it carries the
 *     search keywords, and Google's renderer runs in English, so a translated title would replace
 *     them there.
 *   - Discover, the Guide and the Overview are public: a title of their own and a canonical address
 *     on https://inputread.site, so preview deployments (*.pages.dev) and `/shelf/` are not indexed
 *     as copies.
 *   - The word book, review, reader and admin belong to one reader: `noindex`, no canonical.
 */
import type { Key } from "./i18n-en.ts";
import { pathFor, type Route } from "./router.ts";

export const SITE = "https://inputread.site";

export type PageMeta = {
  /** Dictionary key of the title; null keeps the home title. */
  titleKey: Key | null;
  canonical: string | null;
  index: boolean;
};

export function pageMeta(route: Route, hasBookTitle = false): PageMeta {
  switch (route.kind) {
    case "shelf":
      return { titleKey: null, canonical: `${SITE}/`, index: true };
    case "discover":
    case "guide":
    case "dashboard":
      return { titleKey: `seo.title.${route.kind}`, canonical: `${SITE}${pathFor(route)}`, index: true };
    case "words":
    case "review":
    case "admin":
      return { titleKey: `seo.title.${route.kind}`, canonical: null, index: false };
    case "read":
      return { titleKey: hasBookTitle ? "seo.title.read" : "seo.title.reading", canonical: null, index: false };
  }
}

/** The title index.html shipped with, read before anything changes it. */
const HOME_TITLE = typeof document === "undefined" ? "inputread" : document.title;

function headElement<T extends HTMLElement>(selector: string, make: () => T): T {
  const found = document.head.querySelector<T>(selector);
  if (found) return found;
  const element = make();
  document.head.appendChild(element);
  return element;
}

/** Write a screen's meta into the document. `title` is the translated title, or null for the home title. */
export function applyPageMeta(meta: PageMeta, title: string | null): void {
  if (typeof document === "undefined") return;
  document.title = title ?? HOME_TITLE;
  if (meta.canonical) {
    const link = headElement('link[rel="canonical"]', () => {
      const element = document.createElement("link");
      element.rel = "canonical";
      return element;
    });
    link.href = meta.canonical;
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }
  if (meta.index) {
    document.head.querySelector('meta[name="robots"]')?.remove();
  } else {
    const tag = headElement('meta[name="robots"]', () => {
      const element = document.createElement("meta");
      element.name = "robots";
      return element;
    });
    tag.content = "noindex";
  }
}
