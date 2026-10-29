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
 *   - A Discover tab (/discover/novels/) and a catalog book (/book/<id>/) land on a static page
 *     with its own title (scripts/seo-pages.mjs). The book keeps that landing title; leaving it for
 *     the shelf brings the site title back (the `mw-home-title` meta every page carries).
 *   - The word book, review, reader and admin belong to one reader: `noindex`, no canonical.
 */
import type { Key } from "./i18n-en.ts";
import { pathFor, type Route } from "./router.ts";

export const SITE = "https://inputread.site";

export type PageMeta = {
  /** Dictionary key of the title; null keeps the title the page landed with (a book) or the site's. */
  titleKey: Key | null;
  canonical: string | null;
  index: boolean;
};

export function pageMeta(route: Route, hasBookTitle = false): PageMeta {
  switch (route.kind) {
    case "shelf":
      return { titleKey: null, canonical: `${SITE}/`, index: true };
    case "discover":
      return {
        titleKey: route.category === "speech" ? "seo.title.discoverSpeeches" : route.category === "novel" ? "seo.title.discoverNovels" : "seo.title.discover",
        canonical: `${SITE}${pathFor(route)}`,
        index: true,
      };
    case "book":
      return { titleKey: null, canonical: `${SITE}${pathFor(route)}`, index: true };
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

/** The page this tab landed on and its title, read before anything changes them. */
const LANDING_PATH = typeof location === "undefined" ? "/" : location.pathname.replace(/\/?$/, "/");
const LANDING_TITLE = typeof document === "undefined" ? "inputread" : document.title;
/** The site title: every built page names it, so a tab that landed on a book can go back to it. */
const HOME_TITLE =
  (typeof document === "undefined" ? null : document.querySelector<HTMLMetaElement>('meta[name="mw-home-title"]')?.content) ||
  LANDING_TITLE;

/** The title kept when a screen has none of its own: the landing page's, on the landing address. */
export function keptTitle(path: string, landingPath: string, landingTitle: string, homeTitle: string): string {
  return path.replace(/\/?$/, "/") === landingPath ? landingTitle : homeTitle;
}

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
  document.title = title ?? keptTitle(location.pathname, LANDING_PATH, LANDING_TITLE, HOME_TITLE);
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
