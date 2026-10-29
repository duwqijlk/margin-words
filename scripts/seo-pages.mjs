/**
 * The static pages behind link previews and search results: one per Discover category
 * (/discover/, /discover/novels/, /discover/speeches/) and one per catalog book (/book/<id>/).
 *
 * Each page is the app (the same scripts as index.html) with its own <head> and a plain-HTML
 * introduction (scripts/seo-plugin.mjs). A book page carries the book's cover as its preview
 * image, its title, author, Lexile level, word counts and its Chinese summary, so a link pasted
 * into X, Telegram, WeChat or QQ shows the book, and a search engine has the text to index.
 *
 * The books come from the live catalogs and summaries (books.inputread.site) when the site is
 * built for production, and from the local folders for `npm run build:local`. A production build
 * that cannot read the catalogs stops: shipping without the book pages would turn every shared
 * book link into a 404. SEO_BOOK_PAGES=skip builds without them on purpose.
 *
 * A book added to the catalog after a build gets its page with the next deploy.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, introWrap } from "./seo-plugin.mjs";

export const DEFAULT_BOOKS_BASE = "https://books.inputread.site";
/** The same id rule as src/lib/router.ts. */
const BOOK_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SUMMARY_MAX = 600;

/** A text by HTTPS. Node's fetch first; curl when Node cannot reach the host (a proxy only curl reads). */
async function getText(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return { status: response.status, text: response.ok ? await response.text() : "" };
  } catch {
    return await new Promise((resolve) => {
      execFile("curl", ["-sSL", "--max-time", "20", "-w", "\n%{http_code}", url], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
        if (error) return resolve({ status: 0, text: "" });
        const cut = stdout.lastIndexOf("\n");
        const status = Number(stdout.slice(cut + 1)) || 0;
        resolve({ status, text: status >= 200 && status < 300 ? stdout.slice(0, cut) : "" });
      });
    });
  }
}

const str = (value, max = 300) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const count = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** One catalog row as a page needs it. Null for a row without a usable id or title. */
export function bookRow(raw, kind, catalogUrl) {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id, 80);
  const title = str(raw.title);
  if (!BOOK_ID.test(id) || !title) return null;
  let cover = "";
  const coverUrl = str(raw.cover?.url, 500);
  if (coverUrl) {
    try {
      cover = new URL(coverUrl, catalogUrl).href;
    } catch {
      cover = "";
    }
  }
  if (cover && !/^https:\/\//.test(cover)) cover = "";
  return {
    id,
    kind,
    category: raw.category === "speech" ? "speech" : "novel",
    title,
    author: str(raw.author, 200),
    lexile: str(raw.lexile, 20),
    isbn: str(raw.isbn, 20).replace(/[^0-9Xx]/g, ""),
    cover,
    words: count(raw.words),
    phrases: count(raw.phrases),
    blurb: { zh: "", en: "" },
  };
}

function readBlurb(text) {
  try {
    const raw = JSON.parse(text);
    return { zh: str(raw?.zh, SUMMARY_MAX), en: str(raw?.en, SUMMARY_MAX) };
  } catch {
    return { zh: "", en: "" };
  }
}

/** Run `work` over `items`, at most `limit` at a time. */
async function eachLimited(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item);
      }
    }),
  );
}

const SOURCES = [
  { folder: "public-books", key: "packs", kind: "classic" },
  { folder: "word-lists", key: "lists", kind: "list" },
];

/** Every catalog book, with its summary. */
export async function loadCatalogBooks({ local = false, root = ".", base = DEFAULT_BOOKS_BASE, log = console } = {}) {
  if (process.env.SEO_BOOK_PAGES === "skip") {
    log.warn("seo: SEO_BOOK_PAGES=skip, building without the book pages");
    return [];
  }
  const books = [];
  const seen = new Set();
  for (const source of SOURCES) {
    let catalog;
    const catalogUrl = local ? `https://local.invalid/${source.folder}/catalog.json` : `${base}/${source.folder}/catalog.json`;
    if (local) {
      const file = join(root, source.folder, "catalog.json");
      if (!existsSync(file)) continue;
      catalog = JSON.parse(readFileSync(file, "utf8"));
    } else {
      const got = await getText(catalogUrl);
      if (!got.text) {
        throw new Error(
          `seo: could not read ${catalogUrl} (status ${got.status}). The book pages would be missing and shared book links would break. ` +
            "Build again when the book site answers, or set SEO_BOOK_PAGES=skip to build without them.",
        );
      }
      catalog = JSON.parse(got.text);
    }
    const rows = Array.isArray(catalog?.[source.key]) ? catalog[source.key] : [];
    for (const raw of rows) {
      const row = bookRow(raw, source.kind, catalogUrl);
      // The first catalog wins an id both use: Discover shows the public book first too.
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      books.push(row);
    }
  }
  await eachLimited(books, 8, async (book) => {
    const folder = book.kind === "classic" ? "public-books" : "word-lists";
    if (local) {
      const file = join(root, folder, book.id, "blurb.json");
      if (existsSync(file)) book.blurb = readBlurb(readFileSync(file, "utf8"));
      return;
    }
    const got = await getText(`${base}/${folder}/${encodeURIComponent(book.id)}/blurb.json`);
    if (got.text) book.blurb = readBlurb(got.text);
  });
  log.info?.(`seo: ${books.length} book pages (${books.filter((book) => book.blurb.zh).length} with a summary)`);
  return books;
}

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));

/** A description cut on a character boundary, ending in an ellipsis when cut. */
export function clip(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trim()}…`;
}

const H1 = "margin:0 0 8px;font-size:26px";
const H2 = "margin:28px 0 6px;font-size:18px";

function crumbs(seo, items) {
  return `<p style="margin:0 0 16px;font-size:14px"><a href="/">${escapeHtml("inputread")}</a>${items
    .map((item) => ` › <a href="${escapeHtml(item.href)}">${escapeHtml(item.text)}</a>`)
    .join("")}</p>`;
}

export const CATEGORY_PATHS = { discover: "/discover/", novels: "/discover/novels/", speeches: "/discover/speeches/" };

export const bookPath = (id) => `/book/${id}/`;

/** Route heads (src/lib/router.ts) answered by a built page instead of a _redirects rewrite. */
export const STATIC_PAGE_HEADS = ["book"];
/** Addresses that must never get a rewrite rule: it would hide the built page. */
export const STATIC_PAGE_SOURCES = ["/discover/", "/discover/*", "/book/*"];

export function categoryPages(seo, books) {
  const groups = {
    discover: books,
    novels: books.filter((book) => book.category === "novel"),
    speeches: books.filter((book) => book.category === "speech"),
  };
  return Object.entries(groups).map(([key, rows]) => {
    const copy = seo.pages[key];
    const path = CATEGORY_PATHS[key];
    const url = `${seo.site}${path}`;
    const items = rows
      .map((book) => `<li><a href="${bookPath(book.id)}" lang="en">${escapeHtml(book.title)}</a>${book.author ? ` <span lang="en">· ${escapeHtml(book.author)}</span>` : ""}</li>`)
      .join("");
    const others = Object.entries(CATEGORY_PATHS)
      .filter(([other]) => other !== key)
      .map(([other, href]) => `<a href="${href}" style="margin-right:16px">${escapeHtml(seo.pages[other].h1)}</a>`)
      .join("");
    return {
      path,
      title: copy.title,
      description: copy.description,
      url,
      canonical: url,
      ogType: "website",
      imageAlt: copy.h1,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: copy.h1,
        url,
        description: copy.description,
        inLanguage: seo.lang,
        isPartOf: { "@id": `${seo.site}/#website` },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: rows.length,
          itemListElement: rows.slice(0, 300).map((book, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${seo.site}${bookPath(book.id)}`,
            name: book.title,
          })),
        },
      },
      intro: introWrap(
        crumbs(seo, []) +
          `<h1 style="${H1}">${escapeHtml(copy.h1)}</h1>` +
          `<p style="margin:0">${escapeHtml(copy.lead)}</p>` +
          `<nav style="margin-top:12px">${others}</nav>` +
          `<h2 style="${H2}">${escapeHtml(fill(copy.listHeading, { n: rows.length }))}</h2>` +
          `<ul style="margin:0;padding-left:20px">${items}</ul>`,
      ),
    };
  });
}

export function bookTexts(seo, book) {
  const t = seo.book;
  const lexile = book.lexile ? fill(t.lexile, { lexile: book.lexile }) : "";
  const values = { title: book.title, author: book.author || "inputread", lexile };
  const speech = book.category === "speech";
  const title = fill(speech ? t.titleSpeech : book.kind === "classic" ? t.titleClassic : t.titleList, values);
  const lead = fill(speech && book.kind !== "classic" ? t.descSpeech : book.kind === "classic" ? t.descClassic : t.descList, values);
  const description = clip(book.blurb.zh ? `${lead} ${book.blurb.zh}` : lead, 160);
  return { title, lead, description };
}

export function bookPages(seo, books) {
  const t = seo.book;
  return books.map((book) => {
    const path = bookPath(book.id);
    const url = `${seo.site}${path}`;
    const { title, lead, description } = bookTexts(seo, book);
    const category = book.category === "speech" ? "speeches" : "novels";
    const facts = [
      book.lexile ? `Lexile ${book.lexile}` : "",
      book.words || book.phrases ? fill(t.facts, { words: book.words, phrases: book.phrases }) : "",
    ].filter(Boolean);
    return {
      path,
      title,
      description,
      url,
      canonical: url,
      ogType: "book",
      image: book.cover || "",
      imageAlt: book.title,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Book",
        name: book.title,
        ...(book.author ? { author: { "@type": "Person", name: book.author } } : {}),
        inLanguage: "en",
        url,
        ...(book.cover ? { image: book.cover } : {}),
        ...(book.isbn ? { isbn: book.isbn } : {}),
        ...(book.blurb.zh || book.blurb.en ? { description: book.blurb.zh || book.blurb.en } : {}),
        isPartOf: { "@id": `${seo.site}/#website` },
      },
      intro: introWrap(
        crumbs(seo, [{ href: CATEGORY_PATHS[category], text: seo.pages[category].h1 }]) +
          `<h1 style="${H1}" lang="en">${escapeHtml(book.title)}</h1>` +
          (book.author ? `<p style="margin:0 0 8px" lang="en">${escapeHtml(book.author)}</p>` : "") +
          (facts.length ? `<p style="margin:0 0 8px">${escapeHtml(facts.join(" · "))}</p>` : "") +
          `<p style="margin:0">${escapeHtml(lead)}</p>` +
          (book.blurb.zh ? `<h2 style="${H2}">${escapeHtml(t.blurbHeading)}</h2><p style="margin:0">${escapeHtml(book.blurb.zh)}</p>` : "") +
          (book.blurb.en ? `<p style="margin:8px 0 0" lang="en">${escapeHtml(book.blurb.en)}</p>` : "") +
          `<p style="margin:16px 0 0">${escapeHtml(book.kind === "classic" ? t.noteClassic : t.noteList)}</p>` +
          `<nav style="margin-top:20px"><a href="${CATEGORY_PATHS[category]}">${escapeHtml(t.more)}</a></nav>`,
      ),
    };
  });
}
