/**
 * What a search engine, or a chat app making a link preview, reads before the app starts.
 *
 * The app is a single page: index.html has an empty #root, so a crawler that does not run
 * JavaScript (Baidu, Sogou, 360, often Bing) and every link preview (X, Telegram, WeChat, QQ) saw a
 * page titled "inputread" with one English line. This plugin builds the copy in docs/seo.json
 * (Chinese lives only in docs/, AGENTS.md) into the build:
 *
 *   - dist/index.html: title, description, keywords, Open Graph / Twitter card with an image
 *     (public/social/og.png), JSON-LD, and a plain-HTML introduction inside #root. React replaces
 *     everything in #root when it mounts, and index.html's first script marks the page `data-js`,
 *     so a browser that runs scripts never paints the introduction: readers see the app exactly as
 *     before, a crawler without JavaScript sees the text.
 *   - one static page per Discover category and per catalog book (scripts/seo-pages.mjs): the same
 *     app, with that page's own title, description, preview image (the book's cover), canonical
 *     address and introduction. Cloudflare applies a _redirects rule even when a file exists, so
 *     these addresses have no rewrite rule: the file itself answers.
 *   - dist/sitemap.xml with all of them.
 *
 * index.html has no canonical tag: it answers many addresses (_redirects), and a fixed one would
 * tell Google that /guide/ is the home page. The app sets the canonical address of each screen
 * (src/lib/page-meta.ts). The static pages answer one address each, so they carry their own.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bookPages, categoryPages, DEFAULT_BOOKS_BASE, loadCatalogBooks } from "./seo-pages.mjs";

const SEO_FILE = fileURLToPath(new URL("../docs/seo.json", import.meta.url));
export const INTRO_ID = "seo-intro";
/** The site title, for the app: a static page lands with its own title, and the shelf must get the site's back. */
export const HOME_TITLE_META = "mw-home-title";

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`docs/seo.json: ${name} must be a non-empty string`);
  return value.trim();
}

function list(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`docs/seo.json: ${name} must be a non-empty list`);
  return value;
}

function strings(raw, name, keys) {
  const out = {};
  for (const key of keys) out[key] = text(raw?.[key], `${name}.${key}`);
  return out;
}

/** Read and check docs/seo.json. */
export function readSeo(file = SEO_FILE) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const site = text(raw.site, "site").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) throw new Error("docs/seo.json: site must be an https origin");
  const intro = raw.intro ?? {};
  const ogImage = text(raw.ogImage, "ogImage");
  if (!/^\/[a-z0-9/_-]+\.png$/.test(ogImage)) throw new Error("docs/seo.json: ogImage must be a .png path on the site");
  const pageKeys = ["title", "description", "h1", "lead", "listHeading"];
  return {
    site,
    lang: text(raw.lang, "lang"),
    title: text(raw.title, "title"),
    description: text(raw.description, "description"),
    keywords: list(raw.keywords, "keywords").map((item, i) => text(item, `keywords[${i}]`)),
    ogTitle: text(raw.ogTitle, "ogTitle"),
    ogDescription: text(raw.ogDescription, "ogDescription"),
    ogImage,
    ogImageText: strings(raw.ogImageText, "ogImageText", ["headline", "sub", "line", "sentence", "word", "ipa", "meaning"]),
    englishName: text(raw.englishName, "englishName"),
    englishDescription: text(raw.englishDescription, "englishDescription"),
    alternateNames: list(raw.alternateNames, "alternateNames").map((item, i) => text(item, `alternateNames[${i}]`)),
    intro: {
      h1: text(intro.h1, "intro.h1"),
      lead: text(intro.lead, "intro.lead"),
      sections: list(intro.sections, "intro.sections").map((section, i) => ({
        h2: text(section?.h2, `intro.sections[${i}].h2`),
        p: text(section?.p, `intro.sections[${i}].p`),
      })),
      links: list(intro.links, "intro.links").map((link, i) => {
        const href = text(link?.href, `intro.links[${i}].href`);
        if (!/^\/[a-z/]*$/.test(href)) throw new Error(`docs/seo.json: intro.links[${i}].href must be a site path`);
        return { href, text: text(link?.text, `intro.links[${i}].text`) };
      }),
    },
    sitemap: list(raw.sitemap, "sitemap").map((path, i) => {
      const value = text(path, `sitemap[${i}]`);
      if (!/^\/([a-z]+\/)*$/.test(value)) throw new Error(`docs/seo.json: sitemap[${i}] must be "/" or "/<page>/"`);
      return value;
    }),
    pages: {
      discover: strings(raw.pages?.discover, "pages.discover", pageKeys),
      novels: strings(raw.pages?.novels, "pages.novels", pageKeys),
      speeches: strings(raw.pages?.speeches, "pages.speeches", pageKeys),
    },
    book: strings(raw.book, "book", [
      "titleClassic", "titleList", "titleSpeech", "descClassic", "descList", "descSpeech", "lexile", "facts",
      "blurbHeading", "noteClassic", "noteList", "more",
    ]),
  };
}

/** JSON for a <script> element: no "</script>" can close it early. */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const meta = (attr, key, content) => `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;

/**
 * The <head> tags of one page. `page` is the home page when it is omitted.
 * page: { title, description, url, canonical, image, imageAlt, largeImage, ogType, jsonLd }
 */
export function headTags(seo, page = null) {
  const home = page === null;
  const description = home ? seo.description : page.description;
  const ogTitle = home ? seo.ogTitle : page.title;
  const ogDescription = home ? seo.ogDescription : page.description;
  const url = home ? `${seo.site}/` : page.url;
  const image = home || !page.image ? `${seo.site}${seo.ogImage}` : page.image;
  const largeImage = home || !page.image || page.largeImage;
  const ld = home
    ? {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            "@id": `${seo.site}/#website`,
            url: `${seo.site}/`,
            name: "inputread",
            alternateName: seo.alternateNames,
            description: seo.description,
            inLanguage: [seo.lang, "en"],
          },
          {
            "@type": "WebApplication",
            "@id": `${seo.site}/#app`,
            url: `${seo.site}/`,
            name: "inputread",
            alternateName: seo.alternateNames,
            description: seo.englishDescription,
            applicationCategory: "EducationalApplication",
            operatingSystem: "Web",
            browserRequirements: "Requires JavaScript",
            inLanguage: [seo.lang, "en"],
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
          },
        ],
      }
    : page.jsonLd;
  return [
    meta("name", "description", description),
    ...(home ? [meta("name", "keywords", seo.keywords.join(","))] : []),
    ...(home ? [] : [`<link rel="canonical" href="${escapeHtml(page.canonical ?? page.url)}" />`]),
    meta("name", HOME_TITLE_META, seo.title),
    meta("property", "og:type", home ? "website" : page.ogType ?? "website"),
    meta("property", "og:site_name", "inputread"),
    meta("property", "og:title", ogTitle),
    meta("property", "og:description", ogDescription),
    meta("property", "og:url", url),
    meta("property", "og:image", image),
    ...(largeImage ? [meta("property", "og:image:width", "1200"), meta("property", "og:image:height", "630")] : []),
    meta("property", "og:image:alt", home ? seo.ogTitle : page.imageAlt ?? page.title),
    meta("property", "og:locale", seo.lang.replace("-", "_")),
    meta("name", "twitter:card", largeImage ? "summary_large_image" : "summary"),
    meta("name", "twitter:title", ogTitle),
    meta("name", "twitter:description", ogDescription),
    meta("name", "twitter:image", image),
    ...(ld ? [`<script type="application/ld+json">${scriptJson(ld)}</script>`] : []),
    // A browser that runs scripts never paints the introduction (index.html sets data-js first).
    `<style>html[data-js] #${INTRO_ID}{display:none}</style>`,
  ].join("\n    ");
}

const FONT = "font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";

/** The plain-HTML introduction: `body` is already-escaped HTML. */
export function introWrap(body) {
  return `<div id="${INTRO_ID}" style="max-width:40rem;margin:0 auto;padding:10vh 20px 48px;${FONT};font-size:16px;line-height:1.7">${body}</div>`;
}

export function introHtml(seo) {
  const { intro } = seo;
  const sections = intro.sections
    .map((section) => `<h2 style="margin:28px 0 6px;font-size:18px">${escapeHtml(section.h2)}</h2><p style="margin:0">${escapeHtml(section.p)}</p>`)
    .join("");
  const links = intro.links
    .map((link) => `<a href="${escapeHtml(link.href)}" style="margin-right:16px">${escapeHtml(link.text)}</a>`)
    .join("");
  return introWrap(
    `<h1 style="margin:0 0 12px;font-size:26px">${escapeHtml(intro.h1)}</h1>` +
      `<p style="margin:0">${escapeHtml(intro.lead)}</p>` +
      sections +
      `<nav style="margin-top:28px">${links}</nav>`,
  );
}

export function sitemapXml(seo, day, extra = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("sitemap: day must be YYYY-MM-DD");
  const paths = [...new Set([...seo.sitemap, ...extra])];
  const urls = paths.map((path) => `  <url><loc>${seo.site}${path}</loc><lastmod>${day}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const HEAD_START = "<!--seo:head-->";
const HEAD_END = "<!--/seo:head-->";

/** index.html with the SEO head and introduction. Throws when the page no longer has the expected shape. */
export function applySeo(html, seo) {
  const steps = [
    [/<html lang="en"/, `<html lang="${escapeHtml(seo.lang)}"`, "<html lang=\"en\">"],
    [/<title>[^<]*<\/title>/, `<title>${escapeHtml(seo.title)}</title>`, "<title>"],
    [/<meta\s+name="description"[\s\S]*?\/>/, `${HEAD_START}\n    ${headTags(seo)}\n    ${HEAD_END}`, "the description meta"],
    [/<div id="root"><\/div>/, `<div id="root">${introHtml(seo)}</div>`, "<div id=\"root\"></div>"],
  ];
  let out = html;
  for (const [pattern, replacement, name] of steps) {
    if (!pattern.test(out)) throw new Error(`seo: index.html has no ${name}`);
    out = out.replace(pattern, () => replacement);
  }
  return out;
}

/**
 * A static page made from the finished index.html: its own title, head tags and introduction.
 * page: as headTags, plus `intro` (the HTML from introWrap).
 */
export function pageHtml(builtIndex, seo, page) {
  const head = new RegExp(`${HEAD_START}[\\s\\S]*?${HEAD_END}`);
  const intro = new RegExp(`<div id="${INTRO_ID}"[\\s\\S]*?</div>(?=</div>)`);
  if (!head.test(builtIndex)) throw new Error("seo: the built index.html lost its SEO head markers");
  if (!intro.test(builtIndex)) throw new Error("seo: the built index.html lost its introduction");
  return builtIndex
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`)
    .replace(head, () => `${HEAD_START}\n    ${headTags(seo, page)}\n    ${HEAD_END}`)
    .replace(intro, () => page.intro);
}

export function seoPages({
  file = SEO_FILE,
  today = () => new Date().toISOString().slice(0, 10),
  loadBooks = loadCatalogBooks,
} = {}) {
  let seo = null;
  let outDir = "dist";
  let books = [];
  let loading = null;
  let mode = "production";
  let local = false;
  let root = ".";
  let base = DEFAULT_BOOKS_BASE;
  const load = () => (seo ??= readSeo(file));
  return {
    name: "margin-words:seo",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
      root = config.root;
      mode = config.mode;
      // The same rule as src/lib/books-base.ts: `npm run build:local` (VITE_BOOKS_BASE empty) serves
      // the books itself, so the pages come from its folders and the build needs no network.
      const raw = config.env?.VITE_BOOKS_BASE;
      local = raw === "" || raw === "." || raw === "./";
      base = typeof raw === "string" && raw.trim() && !local ? raw.trim().replace(/\/+$/, "") : DEFAULT_BOOKS_BASE;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return applySeo(html, load());
      },
    },
    async buildStart() {
      if (mode === "development") return;
      // The legacy build runs this hook a second time: read the catalogs once.
      loading ??= loadBooks({ local, root, base });
      books = await loading;
    },
    closeBundle() {
      if (mode === "development") return;
      const site = load();
      const built = readFileSync(join(outDir, "index.html"), "utf8");
      const pages = [...categoryPages(site, books), ...bookPages(site, books)];
      for (const page of pages) {
        const dir = join(outDir, ...page.path.split("/").filter(Boolean));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "index.html"), pageHtml(built, site, page));
      }
      writeFileSync(join(outDir, "sitemap.xml"), sitemapXml(site, today(), pages.map((page) => page.path)));
    },
  };
}
