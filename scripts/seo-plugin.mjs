/**
 * What a search engine reads before the app starts.
 *
 * The app is a single page: index.html has an empty #root, so a crawler that does not run
 * JavaScript (Baidu, Sogou, 360, often Bing) saw a page titled "inputread" with one English line
 * and nothing else. This plugin builds the copy in docs/seo.json (Chinese lives only in docs/,
 * AGENTS.md) into dist/index.html:
 *
 *   - <title>, description, keywords, Open Graph and JSON-LD (WebSite + WebApplication);
 *   - a plain-HTML introduction inside #root with headings and links to the main pages. React
 *     replaces everything in #root when it mounts, and index.html's first script marks the page
 *     `data-js` so a browser that runs scripts never paints the introduction: readers see the app
 *     exactly as before, a crawler without JavaScript sees the text;
 *   - dist/sitemap.xml.
 *
 * The page title and canonical address of each screen are set by the app (src/lib/page-meta.ts).
 * There is no canonical tag here: every address is answered with this same file, and a fixed one
 * would tell Google that /discover/ is the home page.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEO_FILE = fileURLToPath(new URL("../docs/seo.json", import.meta.url));
export const INTRO_ID = "seo-intro";

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

/** Read and check docs/seo.json. */
export function readSeo(file = SEO_FILE) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const site = text(raw.site, "site").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) throw new Error("docs/seo.json: site must be an https origin");
  const intro = raw.intro ?? {};
  return {
    site,
    lang: text(raw.lang, "lang"),
    title: text(raw.title, "title"),
    description: text(raw.description, "description"),
    keywords: list(raw.keywords, "keywords").map((item, i) => text(item, `keywords[${i}]`)),
    ogTitle: text(raw.ogTitle, "ogTitle"),
    ogDescription: text(raw.ogDescription, "ogDescription"),
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
      if (!/^\/([a-z]+\/)?$/.test(value)) throw new Error(`docs/seo.json: sitemap[${i}] must be "/" or "/<page>/"`);
      return value;
    }),
  };
}

/** JSON for a <script> element: no "</script>" can close it early. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function headTags(seo) {
  const meta = (attr, key, content) => `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const ld = {
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
  };
  return [
    meta("name", "description", seo.description),
    meta("name", "keywords", seo.keywords.join(",")),
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "inputread"),
    meta("property", "og:title", seo.ogTitle),
    meta("property", "og:description", seo.ogDescription),
    meta("property", "og:url", `${seo.site}/`),
    meta("property", "og:locale", seo.lang.replace("-", "_")),
    meta("name", "twitter:card", "summary"),
    meta("name", "twitter:title", seo.ogTitle),
    meta("name", "twitter:description", seo.ogDescription),
    `<script type="application/ld+json">${scriptJson(ld)}</script>`,
    // A browser that runs scripts never paints the introduction (index.html sets data-js first).
    `<style>html[data-js] #${INTRO_ID}{display:none}</style>`,
  ].join("\n    ");
}

export function introHtml(seo) {
  const { intro } = seo;
  const font = "font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
  const sections = intro.sections
    .map((section) => `<h2 style="margin:28px 0 6px;font-size:18px">${escapeHtml(section.h2)}</h2><p style="margin:0">${escapeHtml(section.p)}</p>`)
    .join("");
  const links = intro.links
    .map((link) => `<a href="${escapeHtml(link.href)}" style="margin-right:16px">${escapeHtml(link.text)}</a>`)
    .join("");
  return (
    `<div id="${INTRO_ID}" style="max-width:40rem;margin:0 auto;padding:10vh 20px 48px;${font};font-size:16px;line-height:1.7">` +
    `<h1 style="margin:0 0 12px;font-size:26px">${escapeHtml(intro.h1)}</h1>` +
    `<p style="margin:0">${escapeHtml(intro.lead)}</p>` +
    sections +
    `<nav style="margin-top:28px">${links}</nav>` +
    `</div>`
  );
}

export function sitemapXml(seo, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("sitemap: day must be YYYY-MM-DD");
  const urls = seo.sitemap
    .map((path) => `  <url><loc>${seo.site}${path}</loc><lastmod>${day}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** index.html with the SEO head and introduction. Throws when the page no longer has the expected shape. */
export function applySeo(html, seo) {
  const steps = [
    [/<html lang="en"/, `<html lang="${escapeHtml(seo.lang)}"`, "<html lang=\"en\">"],
    [/<title>[^<]*<\/title>/, `<title>${escapeHtml(seo.title)}</title>`, "<title>"],
    [/<meta\s+name="description"[\s\S]*?\/>/, headTags(seo), "the description meta"],
    [/<div id="root"><\/div>/, `<div id="root">${introHtml(seo)}</div>`, "<div id=\"root\"></div>"],
  ];
  let out = html;
  for (const [pattern, replacement, name] of steps) {
    if (!pattern.test(out)) throw new Error(`seo: index.html has no ${name}`);
    out = out.replace(pattern, () => replacement);
  }
  return out;
}

export function seoPages({ file = SEO_FILE, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  let seo = null;
  const load = () => (seo ??= readSeo(file));
  return {
    name: "margin-words:seo",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return applySeo(html, load());
      },
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(load(), today()) });
    },
  };
}
