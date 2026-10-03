import type JSZip from "jszip";
import { CodedError } from "./errors.ts";
import { normText, stripWordBreaks, stripWordBreaksIn } from "./glossary-format.ts";
import { flowText, skipNestedParagraph } from "./flow-text.ts";

export type EpubChapter = {
  title: string;
  paragraphs: string[];
  html: string;
  /** Zip path of the spine file this chapter was cut from. */
  href?: string;
  /** Manifest href of that file, as written in the OPF. */
  opfHref?: string;
  /** Manifest id of that file. */
  itemId?: string;
  /** Position of that file in the spine (including non-linear items the reader skips). */
  spineAt?: number;
};

/** A spine file whose text was pulled into a recovered contents extra. */
export type AbsorbedSpineFile = {
  href: string;
  opfHref: string;
  itemId: string;
};

/** A spine file the chapter list does not use. Its id is not a chapter index. */
export type EpubExtra = {
  /**
   * `x0`, `x1`, … in spine order. Not a chapter index.
   * Word anchors and phrase notes do not resolve here. A paragraph or sentence
   * note can name this id only when `fromToc` is set.
   */
  id: string;
  href: string;
  opfHref: string;
  itemId: string;
  spineAt: number;
  title: string;
  paragraphs: string[];
  html: string;
  /**
   * The contents entry for this place pointed at a file with no paragraphs.
   * The text is the following spine files that are not contents entries.
   * The numbered chapter list does not include it, so later chapter numbers stay put.
   */
  fromToc?: boolean;
  /**
   * Spine files whose text is in this extra. A `spine.merge` key may name any of
   * them, or the empty contents file this extra stands for. Both name this extra.
   */
  absorbed?: AbsorbedSpineFile[];
};

export type ReadingSlot =
  | { kind: "chapter"; index: number; spineAt: number }
  | { kind: "extra"; index: number; spineAt: number };

export type ParsedEpub = {
  title: string;
  author: string;
  chapters: EpubChapter[];
  /** Spine files the chapter list drops. Empty when every spine file is already a chapter. */
  extras: EpubExtra[];
  /** Every HTML spine item, including files that became chapters or extras. */
  spine: AbsorbedSpineFile[];
  cover: string | null;
  /**
   * True when `cover` came from an OPF tag (meta name=cover, properties=cover-image,
   * a guide cover) or from a file whose name says it is the cover. False when `cover`
   * is only the portrait image at the start of the first spine document.
   */
  coverTagged: boolean;
};

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function stripCjk(value: string): string {
  return value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/[ \t]{2,}/g, " ");
}

function cjkCount(value: string): number {
  return value.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
}
const CHAPTER_CAP = 240;

type TocNode = {
  title: string;
  href: string;
  children: TocNode[];
};

function localName(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, "");
}

function byLocal(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i];
    if (el && localName(el) === name) out.push(el);
  }
  return out;
}

function textOf(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function englishLetters(value: string): number {
  return value.match(/[A-Za-z]/g)?.length ?? 0;
}

/** Download-site watermarks that get glued onto titles/authors, e.g. "(z-library.sk, 1lib.sk, z-lib.sk)". */
const WATERMARK =
  /[([{][^)\]}]*(?:z-?lib(?:rary)?|1lib|b-ok|bookzz|oceanofpdf|libgen|\.sk\b)[^)\]}]*[)\]}]|\b(?:z-?library|oceanofpdf)(?:\.\w+)*\b/gi;

export function cleanBookText(raw: string): string {
  return raw
    .replace(WATERMARK, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[\s,;:-]+$/, "")
    .trim();
}

function englishTitle(raw: string, fallback: string): string {
  const cleaned = cleanBookText(stripCjk(raw)).replace(/\s+/g, " ").trim();
  if (englishLetters(cleaned) < 2) return fallback;
  return cleaned.slice(0, 90);
}

/**
 * Contents labels that name the cover or other front matter, not the text that
 * follows an empty page. Recovered text keeps the heading it already has.
 */
function isFrontMatterTitle(title: string): boolean {
  const key = title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    key === "cover" ||
    key === "covers" ||
    key === "cover page" ||
    key === "title" ||
    key === "title page" ||
    key === "titlepage" ||
    key === "half title" ||
    key === "half title page" ||
    key === "copyright" ||
    key === "copyright page" ||
    key === "contents" ||
    key === "table of contents" ||
    key === "toc" ||
    key === "frontispiece"
  );
}

function resolveZipPath(base: string, href: string): string {
  const clean = decodeURIComponent((href.split("#")[0] ?? "").split("?")[0] ?? "");
  const parts = `${base}${clean}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

/**
 * Directory plus the filename with one trailing `_split_NNN` removed.
 * `story_c01_r1_split_000.xhtml` and `story_c01_r1_split_001.xhtml` share
 * `story_c01_r1.xhtml`. `c01.xhtml` and `c01_split_001.xhtml` share `c01.xhtml`.
 * `index_split_004.xhtml` is just `index.xhtml`, the same prefix as every
 * `index_split_*` file.
 */
function splitPrefix(path: string): string {
  const dir = dirOf(path);
  const file = path.slice(dir.length);
  const dot = file.lastIndexOf(".");
  const stem = dot >= 0 ? file.slice(0, dot) : file;
  const ext = dot >= 0 ? file.slice(dot) : "";
  return `${dir}${stem.replace(/_split_\d+$/, "")}${ext}`;
}

function hashOf(href: string): string {
  const hash = href.split("#")[1] ?? "";
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

function mimeFrom(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

function dropChinese(root: ParentNode) {
  const elements = [...root.querySelectorAll("*")].reverse();
  for (const el of elements) {
    if (!el.parentNode) continue;
    const tag = localName(el);
    if (tag === "rt" || tag === "rp") {
      el.remove();
      continue;
    }
    if (tag === "ruby") {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    if (el.querySelector("p, h1, h2, h3, h4, li, blockquote")) continue;
    const lang = (el.getAttribute("lang") || el.getAttribute("xml:lang") || "").toLowerCase();
    const mark = `${el.getAttribute("class") || ""} ${el.getAttribute("id") || ""}`;
    const marked =
      lang.startsWith("zh") ||
      lang.startsWith("cn") ||
      /\b(zh|cn|chinese|translation|translate)\b/i.test(mark);
    const text = el.textContent ?? "";
    const cjk = cjkCount(text);
    const letters = englishLetters(text);
    if (marked && letters < 12) {
      el.remove();
      continue;
    }
    if (cjk >= 4 && letters < 12) el.remove();
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    texts.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of texts) {
    if (CJK.test(node.data)) node.data = stripCjk(node.data);
  }
}

function looksLikeContents(root: Document): boolean {
  const links = root.querySelectorAll("a").length;
  const paras = root.querySelectorAll("p").length;
  return links > 12 && links > paras;
}

async function embedImages(root: ParentNode, zip: JSZip, chapterPath: string) {
  const images = [...root.querySelectorAll("img")];
  for (const img of images) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:")) continue;
    const path = resolveZipPath(dirOf(chapterPath), src);
    const file = zip.file(path) ?? zip.file(src.replace(/^\.\//, ""));
    if (!file) {
      img.remove();
      continue;
    }
    const bytes = await file.async("uint8array");
    if (bytes.byteLength > 1_200_000) {
      img.remove();
      continue;
    }
    img.setAttribute("src", `data:${mimeFrom(path)};base64,${bytesToBase64(bytes)}`);
  }
}

const KEEP = new Set([
  "p",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "em",
  "strong",
  "i",
  "b",
  "br",
  "ul",
  "ol",
  "li",
  "hr",
  "img",
  "sup",
  "sub",
  "figure",
  "figcaption",
]);

/** A one-letter inline at the start of a paragraph, styled as a chapter drop cap. */
function looksLikeDropCap(el: Element): boolean {
  const cls = el.getAttribute("class") ?? "";
  const style = el.getAttribute("style") ?? "";
  if (/drop[\s_-]?caps?|first[\s_-]?letter|initial-letter/i.test(`${cls} ${style}`)) return true;
  if (/(?:^|\s)big(?:\s|$)/i.test(cls)) return true;
  if (/float\s*:\s*left/i.test(style) && /font-size/i.test(style)) return true;
  return false;
}

function markDropCaps(root: ParentNode) {
  for (const el of root.querySelectorAll("span, em, i, b, strong")) {
    if (!looksLikeDropCap(el)) continue;
    const text = (el.textContent ?? "").replace(/[\s\u00AD\u200B\u2060]/g, "");
    if (!/^(?:["'\u2018\u2019\u201C\u201D])?\p{L}\p{M}*$/u.test(text)) continue;
    const block = el.closest("p, li, blockquote, h1, h2, h3, h4, div");
    if (!block) continue;
    const doc = el.ownerDocument;
    if (!doc) continue;
    const range = doc.createRange();
    try {
      range.setStart(block, 0);
      range.setEndBefore(el);
    } catch {
      continue;
    }
    if (range.toString().replace(/[\s\u00AD\u200B\u2060]/g, "")) continue;
    block.classList.add("dropcap");
  }
}

/** The joined word lives on the paragraph; the one-letter wrapper must not swallow the line. */
function unwrapDropCaps(root: ParentNode) {
  for (const el of [...root.querySelectorAll("span.dropcap, em.dropcap, i.dropcap, b.dropcap, strong.dropcap")]) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  }
}

function sanitize(root: HTMLElement) {
  const all = [...root.querySelectorAll("*")];
  for (const el of all) {
    if (!el.parentNode) continue;
    const tag = localName(el);
    if (tag === "a") {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    if (tag === "script" || tag === "style" || tag === "nav" || tag === "iframe" || tag === "svg") {
      el.remove();
      continue;
    }
    if (!KEEP.has(tag)) {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    const dropcap = el.classList.contains("dropcap");
    const src = tag === "img" ? el.getAttribute("src") : null;
    const centered =
      el.getAttribute("align") === "center" ||
      /text-align\s*:\s*center/i.test(el.getAttribute("style") ?? "");
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    if (centered) el.setAttribute("style", "text-align:center");
    if (dropcap) el.setAttribute("class", "dropcap");
    if (tag === "img" && src?.startsWith("data:image/")) el.setAttribute("src", src);
  }
}

/** Paragraph text the reader stores: spaces collapsed, soft hyphens removed. */
function paragraphText(block: ParentNode): string {
  return stripWordBreaks(flowText(block));
}

const PARAGRAPH_BLOCKS = "p, h1, h2, h3, h4, li, blockquote";

/** Text inside one of these belongs to that block, not to a wrapping div. */
const NESTED_BLOCK = new Set(["div", "p", "h1", "h2", "h3", "h4", "li", "blockquote"]);

/** Text of a div that is not inside a nested div or another paragraph block. */
function inlineText(el: Element): string {
  let text = "";
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const nested = child as Element;
    if (NESTED_BLOCK.has(localName(nested))) continue;
    text += inlineText(nested);
  }
  return text;
}

function divHasInlineText(el: Element): boolean {
  return inlineText(el).replace(/[\s\u00AD\u200B\u2060]/g, "").length > 0;
}

/**
 * A div paragraph: it holds text directly or through inline tags (span, i, b, em, strong, a),
 * and no descendant div does. Empty divs and image-only divs do not.
 */
function isDivParagraph(el: Element): boolean {
  if (!divHasInlineText(el)) return false;
  for (const nested of el.querySelectorAll("div")) {
    if (divHasInlineText(nested)) return false;
  }
  return true;
}

/**
 * Paragraph strings for one chapter fragment.
 * `divParagraphs` is true only when the whole book has no `p` element. Then each innermost
 * text div is a paragraph too, marked `data-para` so the reader numbers the same blocks.
 * When it is false this is the historical rule: a blockquote is one paragraph,
 * including one that holds a heading. `blockquoteSplit` (glossary `"segmentation": 2`)
 * counts the children of a chapter-wrapper blockquote instead. A quote or poem stays
 * one paragraph either way.
 */
function paragraphsOf(root: ParentNode, divParagraphs = false, blockquoteSplit = false): string[] {
  const selector = divParagraphs ? `${PARAGRAPH_BLOCKS}, div` : PARAGRAPH_BLOCKS;
  const blocks = [...root.querySelectorAll(selector)];
  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (skipNestedParagraph(block, blockquoteSplit)) continue;
    if (divParagraphs && localName(block) === "div") {
      if (!isDivParagraph(block)) continue;
      const text = paragraphText(block);
      if (englishLetters(text) > 1) {
        block.setAttribute("data-para", "");
        paragraphs.push(text);
      }
      continue;
    }
    const text = paragraphText(block);
    if (englishLetters(text) > 1) paragraphs.push(text);
  }
  if (paragraphs.length === 0) {
    const text = paragraphText(root);
    if (englishLetters(text) > 20) paragraphs.push(text);
  }
  return paragraphs;
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function resolveHref(documentPath: string, href: string): string {
  const hash = hashOf(href);
  const file = (href.split("#")[0] ?? "").trim();
  const path = file ? resolveZipPath(dirOf(documentPath), file) : documentPath;
  return hash ? `${path}#${hash}` : path;
}

async function renderFragment(
  source: ParentNode,
  zip: JSZip,
  path: string,
  divParagraphs: boolean,
  blockquoteSplit: boolean,
): Promise<{ paragraphs: string[]; html: string } | null> {
  // An inert document: images with a relative path must not be fetched from the page address.
  const inert = document.implementation.createHTMLDocument("");
  const holder = inert.createElement("div");
  holder.append(...[...source.childNodes].map((node) => inert.importNode(node, true)));
  dropChinese(holder);
  await embedImages(holder, zip, path);
  markDropCaps(holder);
  sanitize(holder);
  // Before paragraph strings and the stored HTML are taken, so numbering, glossary
  // positions, the import match rate and the text on screen all see the same words.
  stripWordBreaksIn(holder);
  unwrapDropCaps(holder);
  const paragraphs = paragraphsOf(holder, divParagraphs, blockquoteSplit);
  const html = holder.innerHTML.trim();
  if (!html) return null;
  return { paragraphs, html };
}

async function chapterFromElement(
  source: ParentNode,
  title: string,
  zip: JSZip,
  path: string,
  divParagraphs: boolean,
  blockquoteSplit: boolean,
): Promise<EpubChapter | null> {
  const rendered = await renderFragment(source, zip, path, divParagraphs, blockquoteSplit);
  if (!rendered) return null;
  const letters = englishLetters(rendered.paragraphs.join(" "));
  if (letters < 20) return null;
  return { title: title.slice(0, 90), paragraphs: rendered.paragraphs, html: rendered.html };
}

function findById(root: Document | Element, id: string): Element | null {
  if (!id) return null;
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i];
    if (!el) continue;
    if (el.id === id || el.getAttribute("name") === id) return el;
  }
  return null;
}

/**
 * True when the fragment id is on `<body>` or `<html>` itself.
 * `findById` only searches inside the body, so it does not see that id.
 */
function fragmentOnDocument(doc: Document, id: string): boolean {
  if (!id) return false;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    if (el.id === id || el.getAttribute("name") === id) return true;
  }
  return false;
}

function sliceBetween(body: Element, start: Element | null, end: Element | null): HTMLElement {
  const range = document.createRange();
  if (start) range.setStartBefore(start);
  else range.setStart(body, 0);
  if (end) range.setEndBefore(end);
  else if (body.lastChild) range.setEndAfter(body.lastChild);
  else range.setEnd(body, 0);
  const inert = document.implementation.createHTMLDocument("");
  const holder = inert.createElement("div");
  holder.appendChild(inert.importNode(range.cloneContents(), true));
  return holder;
}

function parseNavHtml(html: string): TocNode[] {
  const doc = parseHtml(html);
  const navs = byLocal(doc, "nav");
  const nav =
    navs.find((item) => (item.getAttribute("epub:type") || "").includes("toc")) ?? navs[0];
  if (!nav) return [];
  function walk(list: Element): TocNode[] {
    const items = [...list.children].filter((child) => localName(child) === "li");
    return items.map((item) => {
      const link = [...item.children].find((child) => localName(child) === "a");
      const nested = [...item.children].find(
        (child) => localName(child) === "ol" || localName(child) === "ul",
      );
      return {
        title: textOf(link),
        href: link?.getAttribute("href") ?? "",
        children: nested ? walk(nested) : [],
      };
    });
  }
  const list = [...nav.children].find(
    (child) => localName(child) === "ol" || localName(child) === "ul",
  );
  return list ? walk(list) : [];
}

function parseNcx(xml: string): TocNode[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const map = byLocal(doc, "navmap")[0];
  if (!map) return [];
  function walk(parent: Element): TocNode[] {
    return [...parent.children]
      .filter((child) => localName(child) === "navpoint")
      .map((point) => {
        const label = [...point.children].find((child) => localName(child) === "navlabel");
        const content = [...point.children].find((child) => localName(child) === "content");
        return {
          title: textOf(label),
          href: content?.getAttribute("src") ?? "",
          children: walk(point),
        };
      });
  }
  return walk(map);
}

function flattenToc(nodes: TocNode[]): { title: string; href: string }[] {
  const out: { title: string; href: string }[] = [];
  function walk(list: TocNode[]) {
    for (const node of list) {
      if (node.children.length === 0) {
        if (node.href) out.push({ title: node.title, href: node.href });
        continue;
      }
      const first = node.children[0];
      if (node.href && node.href !== first?.href) out.push({ title: node.title, href: node.href });
      walk(node.children);
    }
  }
  walk(nodes);
  return out.filter((item) => item.href && !/^(nav|toc|cover)/i.test(item.href));
}

function headingSplit(body: Element): { title: string; holder: HTMLElement }[] {
  const headings = (tag: string) =>
    [...body.querySelectorAll(tag)].filter(
      (heading) => englishLetters(heading.textContent ?? "") >= 2,
    );
  const marks =
    headings("h1").length >= 2 ? headings("h1") : headings("h2").length >= 2 ? headings("h2") : [];
  if (marks.length < 2) {
    const title = englishTitle(textOf(headings("h1")[0] ?? headings("h2")[0]), "");
    return [{ title, holder: sliceBetween(body, null, null) }];
  }
  return marks.map((heading, index) => ({
    title: englishTitle(textOf(heading), ""),
    holder: sliceBetween(body, heading, marks[index + 1] ?? null),
  }));
}

function mergeShort(chapters: EpubChapter[]): EpubChapter[] {
  const merged: EpubChapter[] = [];
  for (const chapter of chapters) {
    const previous = merged[merged.length - 1];
    const letters = englishLetters(chapter.paragraphs.join(" "));
    if (previous && letters < 40) {
      previous.title = englishTitle(`${previous.title}. ${chapter.title}`, previous.title);
      previous.html = `${previous.html}${chapter.html}`;
      previous.paragraphs = [...previous.paragraphs, ...chapter.paragraphs];
      continue;
    }
    merged.push(chapter);
  }
  return merged;
}

function rawCover(bytes: Uint8Array, mime: string): string | null {
  const url = `data:${mime};base64,${bytesToBase64(bytes)}`;
  return url.length > 500_000 ? null : url;
}

function canDraw(): boolean {
  if (typeof document === "undefined") return false;
  const viewAgent = document.defaultView?.navigator?.userAgent ?? "";
  const agent = viewAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/jsdom/i.test(agent)) return false;
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

function shrinkCover(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (!canDraw()) return Promise.resolve(rawCover(bytes, mime));
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return Promise.resolve(rawCover(bytes, mime));
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const max = 480;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(rawCover(bytes, mime));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      const out = canvas.toDataURL("image/jpeg", 0.82);
      URL.revokeObjectURL(url);
      resolve(out.length > 500_000 ? null : out);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(rawCover(bytes, mime));
    };
    image.src = url;
  });
}

/** Width and height from a PNG, JPEG, or GIF header. Null when the file is not one of those. */
export function imagePixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = bytes[6]! + (bytes[7]! << 8);
    const height = bytes[8]! + (bytes[9]! << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
    if (length < 2) return null;
    const startFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (startFrame) {
      const height = ((bytes[at + 5] ?? 0) << 8) + (bytes[at + 6] ?? 0);
      const width = ((bytes[at + 7] ?? 0) << 8) + (bytes[at + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

/**
 * Cover to keep for an imported EPUB that the OPF did not tag.
 * A tagged cover wins. Otherwise the word-list catalog cover, otherwise the
 * portrait image from the start of the book. Empty means the generated cover.
 */
export function importedCoverChoice(tagged: string, catalog: string, spine: string): string {
  if (tagged) return tagged;
  if (catalog) return catalog;
  return spine;
}

/** English letters before this count are not "substantial text" (a title or a caption). */
const COVER_TEXT_LIMIT = 40;

/**
 * The src of the first img in `root`, when it appears before any substantial text.
 * An image after a real paragraph is not a cover.
 */
export function leadingImageHref(root: ParentNode, options: { data?: boolean } = {}): string | null {
  let letters = 0;
  const skip = new Set(["script", "style"]);
  const walk = (node: Node): string | null => {
    if (letters >= COVER_TEXT_LIMIT) return null;
    if (node.nodeType === 3) {
      letters += englishLetters(node.textContent ?? "");
      return null;
    }
    if (node.nodeType !== 1) return null;
    const el = node as Element;
    const name = el.localName;
    if (skip.has(name)) return null;
    if (name === "img") {
      const src = (el.getAttribute("src") ?? "").trim();
      if (!src || /^https?:/i.test(src)) return null;
      return src.startsWith("data:") && !options.data ? null : src;
    }
    for (let child = el.firstChild; child; child = child.nextSibling) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

type ManifestItem = { href: string; type: string; props: string };

function isImageItem(item: ManifestItem): boolean {
  return /image|png|jpe?g|gif|webp/.test(`${item.type} ${item.href}`) && !/svg/i.test(item.type);
}

async function coverFromFile(zip: JSZip, path: string, mime: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const bytes = await file.async("uint8array");
  if (bytes.byteLength < 80 || bytes.byteLength > 4_000_000) return null;
  const type = mime.startsWith("image/") && !mime.includes("svg") ? mime : mimeFrom(path);
  if (type === "image/svg+xml") return null;
  return shrinkCover(bytes, type);
}

/** An OPF tag, or a file named like a cover. Null when the book does not name one. */
async function taggedCover(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfBase: string,
  loadDoc: (path: string) => Promise<Document | null>,
): Promise<string | null> {
  let coverId = "";
  for (const meta of byLocal(opf, "meta")) {
    if (meta.getAttribute("name") === "cover") coverId = meta.getAttribute("content") ?? "";
  }
  const items = [...manifest.values()];
  const found =
    (coverId ? manifest.get(coverId) : undefined) ??
    items.find((item) => item.props.includes("cover-image")) ??
    items.find((item) => /cover/i.test(item.href) && isImageItem(item));
  if (found && isImageItem(found)) {
    const url = await coverFromFile(
      zip,
      resolveZipPath(opfBase, found.href),
      found.type.startsWith("image/") ? found.type : mimeFrom(found.href),
    );
    if (url) return url;
  }
  for (const ref of byLocal(opf, "reference")) {
    const kind = (ref.getAttribute("type") ?? "").toLowerCase();
    if (kind !== "cover" && !kind.startsWith("cover")) continue;
    const href = ref.getAttribute("href") ?? "";
    if (!href) continue;
    const path = resolveZipPath(opfBase, href);
    if (/\.(png|jpe?g|gif|webp)$/i.test(path)) {
      const url = await coverFromFile(zip, path, mimeFrom(path));
      if (url) return url;
      continue;
    }
    const doc = await loadDoc(path);
    const src = (doc?.body?.querySelector("img")?.getAttribute("src") ?? "").trim();
    if (!src || /^https?:/i.test(src) || src.startsWith("data:")) continue;
    const url = await coverFromFile(zip, resolveZipPath(dirOf(path), src), mimeFrom(src));
    if (url) return url;
  }
  return null;
}

/**
 * The first image of the first spine document, when it is portrait-shaped and
 * sits before any substantial text. This is how some converted EPUBs store the
 * cover (one HTML file, the picture first, no OPF cover tag).
 */
async function spineCover(
  zip: JSZip,
  spine: ManifestItem[],
  opfBase: string,
  loadDoc: (path: string) => Promise<Document | null>,
): Promise<string | null> {
  const first = spine[0];
  if (!first) return null;
  const path = resolveZipPath(opfBase, first.href);
  const doc = await loadDoc(path);
  const src = doc?.body ? leadingImageHref(doc.body) : "";
  if (!src) return null;
  const imagePath = resolveZipPath(dirOf(path), src);
  const file = zip.file(imagePath);
  if (!file) return null;
  const bytes = await file.async("uint8array");
  if (bytes.byteLength < 80 || bytes.byteLength > 4_000_000) return null;
  const size = imagePixelSize(bytes);
  if (!size || size.height <= size.width) return null;
  const mime = mimeFrom(imagePath);
  if (mime === "image/svg+xml") return null;
  return shrinkCover(bytes, mime);
}

/** Adobe and IDPF font mangling. These hide a font file; they do not lock the book. */
const FONT_OBFUSCATION_ALGORITHMS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

/** xhtml/html, the package and contents files, and pictures. A font file is not one of these. */
function isEncryptedContent(uri: string): boolean {
  let path = uri.split("#")[0]?.split("?")[0] ?? "";
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  return /\.(xhtml|html|htm|opf|ncx|jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(path);
}

/**
 * True when encryption.xml locks the book. An obfuscated font is ignored, so the
 * reader uses its own fonts. Anything that encrypts the text or pictures, or that
 * uses some other algorithm, is a lock.
 */
function encryptionLocksBook(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (byLocal(doc, "parsererror").length > 0) return true;
  const items = byLocal(doc, "encrypteddata");
  if (items.length === 0) return false;
  for (const item of items) {
    const algorithm = byLocal(item, "encryptionmethod")[0]?.getAttribute("Algorithm") ?? "";
    const uri = byLocal(item, "cipherreference")[0]?.getAttribute("URI") ?? "";
    if (!FONT_OBFUSCATION_ALGORITHMS.has(algorithm) || isEncryptedContent(uri)) return true;
  }
  return false;
}

export async function parseEpub(
  buffer: ArrayBuffer,
  options: { cover?: boolean; segmentation?: number } = {},
): Promise<ParsedEpub> {
  let zip: JSZip;
  try {
    // Loaded when a book is opened, so the first screen does not carry the zip reader.
    const { default: Zip } = await import("jszip");
    zip = await Zip.loadAsync(buffer);
  } catch {
    throw new CodedError("notValidEpub", "This file is not a valid EPUB book.");
  }
  const encryptionXml = await zip.file("META-INF/encryption.xml")?.async("string");
  if (encryptionXml && encryptionLocksBook(encryptionXml)) {
    throw new CodedError(
      "drm",
      "This EPUB is locked (DRM), so Margin Words cannot open it. Please try a book without a lock.",
    );
  }
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new CodedError("notEpub", "This is not an EPUB book.");
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const opfPath = byLocal(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new CodedError("noToc", "This EPUB has no table of contents.");
  const opfXml = await zip.file(decodeURIComponent(opfPath))?.async("string");
  if (!opfXml) throw new CodedError("noToc", "This EPUB has no table of contents.");
  const opf = new DOMParser().parseFromString(opfXml, "application/xml");
  const title = englishTitle(textOf(byLocal(opf, "title")[0]), "Untitled");
  const author = englishTitle(textOf(byLocal(opf, "creator")[0]), "");
  const opfBase = dirOf(opfPath);
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of byLocal(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      type: item.getAttribute("media-type") ?? "",
      props: item.getAttribute("properties") ?? "",
    });
  }
  const spineRefs: {
    id: string;
    href: string;
    type: string;
    props: string;
    path: string;
    linear: boolean;
  }[] = [];
  for (const itemref of byLocal(opf, "itemref")) {
    const id = itemref.getAttribute("idref") ?? "";
    const ref = manifest.get(id);
    if (!ref) continue;
    if (ref.props.includes("nav")) continue;
    if (ref.type && !ref.type.includes("html")) continue;
    if (/(^|\/)(nav|toc|cover)\b/i.test(ref.href)) continue;
    spineRefs.push({
      id,
      href: ref.href,
      type: ref.type,
      props: ref.props,
      path: resolveZipPath(opfBase, ref.href),
      linear: (itemref.getAttribute("linear") ?? "yes").toLowerCase() !== "no",
    });
  }
  const spine = spineRefs.map(({ href, type, props }) => ({ href, type, props }));

  const docs = new Map<string, Document>();
  async function loadDoc(path: string): Promise<Document | null> {
    const cached = docs.get(path);
    if (cached) return cached;
    const file = zip.file(path);
    if (!file) return null;
    const doc = parseHtml(await file.async("string"));
    docs.set(path, doc);
    return doc;
  }

  let toc: { title: string; href: string }[] = [];
  const navItem = [...manifest.values()].find((item) => item.props.includes("nav"));
  const ncxItem = [...manifest.values()].find(
    (item) => item.type.includes("ncx") || item.href.endsWith(".ncx"),
  );
  if (navItem) {
    const navPath = resolveZipPath(opfBase, navItem.href);
    const navFile = zip.file(navPath);
    if (navFile) {
      toc = flattenToc(parseNavHtml(await navFile.async("string"))).map((item) => ({
        title: item.title,
        href: resolveHref(navPath, item.href),
      }));
    }
  }
  if (toc.length < 2 && ncxItem) {
    const ncxPath = resolveZipPath(opfBase, ncxItem.href);
    const ncxFile = zip.file(ncxPath);
    if (ncxFile) {
      toc = flattenToc(parseNcx(await ncxFile.async("string"))).map((item) => ({
        title: item.title,
        href: resolveHref(ncxPath, item.href),
      }));
    }
  }

  // Div paragraphs apply only when every spine content document has no <p> at all.
  // One <p> anywhere keeps today's paragraph list, byte for byte.
  // Blockquote children stay inside one paragraph unless the word list opts in.
  const blockquoteSplit = options.segmentation === 2;
  let divParagraphs = true;
  for (const item of spineRefs) {
    const spineDoc = await loadDoc(item.path);
    if (spineDoc?.querySelector("p")) {
      divParagraphs = false;
      break;
    }
  }

  const chapters: EpubChapter[] = [];
  const tocFiles = new Set(toc.map((entry) => entry.href.split("#")[0] ?? ""));
  /** Spine files already copied onto a chapter by the split-continuation rule. */
  const attached = new Set<string>();
  /**
   * A contents file with no paragraphs. Its text is the following non-contents
   * files, kept as one extra so the numbered chapters do not move.
   */
  const fills: {
    spineAt: number;
    title: string;
    paragraphs: string[];
    html: string;
    href: string;
    opfHref: string;
    itemId: string;
    absorbed: AbsorbedSpineFile[];
  }[] = [];
  const filledPaths = new Set<string>();
  const prefixCounts = new Map<string, number>();
  for (const entry of toc) {
    const file = entry.href.split("#")[0] ?? "";
    if (!file) continue;
    const prefix = splitPrefix(file);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  async function heldChapter(holder: ParentNode, rawTitle: string, path: string, index: number) {
    // Before soft-hyphen and inline joins, so a one-letter drop cap is still one letter.
    markDropCaps(holder);
    stripWordBreaksIn(holder);
    const heading = holder.querySelector?.("h1, h2, h3");
    const title =
      englishTitle(stripWordBreaks(rawTitle), "") ||
      englishTitle(textOf(heading), `Chapter ${index + 1}`);
    return chapterFromElement(holder, title, zip, path, divParagraphs, blockquoteSplit);
  }

  async function push(holder: ParentNode, rawTitle: string, path: string, index: number) {
    if (chapters.length >= CHAPTER_CAP) return;
    const chapter = await heldChapter(holder, rawTitle, path, index);
    if (!chapter) return;
    stamp(chapter, path);
    chapters.push(chapter);
  }

  function stamp(chapter: EpubChapter, path: string) {
    const at = spineRefs.findIndex((item) => item.path === path);
    const ref = at >= 0 ? spineRefs[at] : undefined;
    chapter.href = path;
    if (at >= 0) chapter.spineAt = at;
    if (ref) {
      chapter.opfHref = ref.href;
      chapter.itemId = ref.id;
    }
  }

  /**
   * Unlisted spine files that continue the file just before them.
   * A file attaches only when its prefix equals the previous linear spine file
   * (so `_split_000`, then `_split_001`, then `_split_002` chain) and that prefix
   * belongs to exactly one contents entry. Book-wide names (`index_split_*`,
   * `Title_split_*`) belong to many entries, so they stay out. A non-linear spine
   * item is not a reading file and does not break the chain.
   */
  async function continuationRenders(originPath: string): Promise<{ paragraphs: string[]; html: string }[]> {
    const out: { paragraphs: string[]; html: string }[] = [];
    const start = spineRefs.findIndex((item) => item.path === originPath);
    if (start < 0) return out;
    let previous = originPath;
    for (let i = start + 1; i < spineRefs.length; i += 1) {
      const item = spineRefs[i];
      if (!item || !item.linear) continue;
      if (tocFiles.has(item.path)) break;
      const prefix = splitPrefix(item.path);
      if (prefix !== splitPrefix(previous) || (prefixCounts.get(prefix) ?? 0) !== 1) break;
      previous = item.path;
      const extraDoc = await loadDoc(item.path);
      if (!extraDoc?.body || looksLikeContents(extraDoc)) continue;
      const extra = await renderFragment(extraDoc.body, zip, item.path, divParagraphs, blockquoteSplit);
      if (!extra) continue;
      attached.add(item.path);
      out.push(extra);
    }
    return out;
  }

  /** True when this contents file has no paragraphs the reader would keep. A short heading is not empty. */
  async function fileIsEmpty(body: Element, path: string): Promise<boolean> {
    const rendered = await renderFragment(body, zip, path, divParagraphs, blockquoteSplit);
    return !rendered || rendered.paragraphs.length === 0;
  }

  /**
   * The contents file at `path` has no paragraphs. Take the linear spine files
   * after it, until the next contents file, as one extra titled with the contents
   * entry. A non-linear file is skipped and does not end the run. Too little text
   * (under 20 letters) is left alone, so those files stay ordinary extras.
   * Cover, title page, copyright, and contents are not recovered: the files after
   * them stay separate extras, with the same ids as before this rule existed.
   */
  async function recoverEmptyToc(path: string, rawTitle: string): Promise<void> {
    if (filledPaths.has(path)) return;
    const tocTitle = englishTitle(stripWordBreaks(rawTitle), "");
    if (isFrontMatterTitle(tocTitle)) return;
    const start = spineRefs.findIndex((item) => item.path === path);
    if (start < 0) return;
    const parts: { paragraphs: string[]; html: string }[] = [];
    const absorbed: AbsorbedSpineFile[] = [];
    for (let i = start + 1; i < spineRefs.length; i += 1) {
      const item = spineRefs[i];
      if (!item || !item.linear) continue;
      if (tocFiles.has(item.path)) break;
      const extraDoc = await loadDoc(item.path);
      if (!extraDoc?.body || looksLikeContents(extraDoc)) break;
      absorbed.push({ href: item.path, opfHref: item.href, itemId: item.id });
      const extra = await renderFragment(extraDoc.body, zip, item.path, divParagraphs, blockquoteSplit);
      if (!extra || extra.paragraphs.length === 0) continue;
      parts.push(extra);
    }
    const paragraphs = parts.flatMap((part) => part.paragraphs);
    if (englishLetters(paragraphs.join(" ")) < 20) return;
    filledPaths.add(path);
    for (const file of absorbed) attached.add(file.href);
    const ref = spineRefs[start];
    fills.push({
      spineAt: start,
      title: tocTitle,
      paragraphs,
      html: parts.map((part) => part.html).join(""),
      href: path,
      opfHref: ref?.href ?? "",
      itemId: ref?.id ?? "",
      absorbed,
    });
  }

  if (toc.length >= 2) {
    // An id on body or html is not visible to findById. Remember those entries.
    // They are restored only when other entries already formed the chapter list.
    // If every fragment is on body or html, this list stays empty and the spine
    // fallback below is unchanged (one file, one chapter, same titles as today).
    const onDocument: {
      at: number;
      title: string;
      path: string;
      body: Element;
      nextAnchor: string;
      lastSlice: boolean;
    }[] = [];
    for (let index = 0; index < toc.length && chapters.length < CHAPTER_CAP; index += 1) {
      const entry = toc[index];
      if (!entry) continue;
      const path = entry.href.split("#")[0] ?? "";
      const anchor = hashOf(entry.href);
      const doc = await loadDoc(path);
      if (!doc?.body || looksLikeContents(doc)) continue;
      const body = doc.body;
      const next = toc[index + 1];
      const nextPath = next ? (next.href.split("#")[0] ?? "") : "";
      const nextAnchor = next && nextPath === path ? hashOf(next.href) : "";
      const start = anchor ? findById(body, anchor) : null;
      const lastSlice = !(next && nextPath === path);
      if (anchor && !start) {
        if (fragmentOnDocument(doc, anchor)) {
          onDocument.push({
            at: chapters.length,
            title: entry.title,
            path,
            body,
            nextAnchor,
            lastSlice,
          });
        } else if (lastSlice && (await fileIsEmpty(body, path))) {
          await recoverEmptyToc(path, entry.title);
        }
        continue;
      }
      const end = nextAnchor ? findById(body, nextAnchor) : null;
      const holder = sliceBetween(body, start, end);
      const before = chapters.length;
      await push(holder, entry.title, path, chapters.length);
      if (chapters.length !== before + 1) {
        // A short heading is not empty, so its split files stay ordinary extras.
        // Only a file with zero paragraphs is filled, and the fill is an extra.
        if (lastSlice && (await fileIsEmpty(body, path))) await recoverEmptyToc(path, entry.title);
        continue;
      }
      if (!lastSlice) continue;
      const last = chapters[chapters.length - 1];
      if (!last) continue;
      // A heading that is too short to be a chapter is dropped above. Do not build
      // a new chapter out of its split files. A later chapter under 40 letters is
      // merged away; adding text could make it survive as a chapter that is not
      // there today. Only a chapter that already stands on its own gets more text,
      // and that text is added after the paragraphs it already has.
      const letters = englishLetters(last.paragraphs.join(" "));
      const standsAlone = before === 0 || letters >= 40;
      if (!standsAlone) continue;
      for (const extra of await continuationRenders(path)) {
        last.paragraphs.push(...extra.paragraphs);
        last.html += extra.html;
      }
    }
    if (chapters.length >= 2) {
      let shift = 0;
      for (const item of onDocument) {
        if (chapters.length >= CHAPTER_CAP) break;
        const end = item.nextAnchor ? findById(item.body, item.nextAnchor) : null;
        const holder = sliceBetween(item.body, null, end);
        const index = item.at + shift;
        const chapter = await heldChapter(holder, item.title, item.path, index);
        if (!chapter) {
          if (item.lastSlice && (await fileIsEmpty(item.body, item.path)))
            await recoverEmptyToc(item.path, item.title);
          continue;
        }
        chapters.splice(index, 0, chapter);
        stamp(chapter, item.path);
        shift += 1;
        if (!item.lastSlice) continue;
        const letters = englishLetters(chapter.paragraphs.join(" "));
        const standsAlone = item.at === 0 || letters >= 40;
        if (!standsAlone) continue;
        for (const extra of await continuationRenders(item.path)) {
          chapter.paragraphs.push(...extra.paragraphs);
          chapter.html += extra.html;
        }
      }
    }
  }

  // The contents list is used only when it already produced at least two chapters.
  // Otherwise the fallback below throws that list away and makes one chapter per
  // spine file. That fallback is the whole book for an empty or one-entry contents
  // list, and its chapter text must stay byte for byte the same.
  const fromContents = chapters.length >= 2;
  if (!fromContents) {
    chapters.length = 0;
    for (const item of spine) {
      if (chapters.length >= CHAPTER_CAP) break;
      const path = resolveZipPath(opfBase, item.href);
      const doc = await loadDoc(path);
      if (!doc?.body || looksLikeContents(doc)) continue;
      const body = doc.body;
      const pieces = headingSplit(body);
      for (const piece of pieces) {
        if (chapters.length >= CHAPTER_CAP) break;
        await push(piece.holder, piece.title, path, chapters.length);
      }
    }
  }

  const ready = mergeShort(chapters).filter(
    (chapter) => englishLetters(chapter.paragraphs.join(" ")) >= 20,
  );
  // Extras are spine files this chapter list never shows. The fallback already
  // shows every spine file, so it has none. A file that became a chapter, or that
  // the continuation rule appended, is not an extra.
  const extras: EpubExtra[] = [];
  if (fromContents) {
    const rendered = new Set<string>(attached);
    for (const chapter of chapters) {
      if (chapter.href) rendered.add(chapter.href);
    }
    const fillAt = new Map(fills.map((fill) => [fill.spineAt, fill]));
    let count = 0;
    for (let spineAt = 0; spineAt < spineRefs.length; spineAt += 1) {
      const fill = fillAt.get(spineAt);
      if (fill) {
        extras.push({
          id: `x${count}`,
          fromToc: true,
          href: fill.href,
          opfHref: fill.opfHref,
          itemId: fill.itemId,
          spineAt,
          title: fill.title,
          paragraphs: fill.paragraphs,
          html: fill.html,
          ...(fill.absorbed.length > 0 ? { absorbed: fill.absorbed } : {}),
        });
        count += 1;
      }
      const item = spineRefs[spineAt];
      if (!item || rendered.has(item.path)) continue;
      const extraDoc = await loadDoc(item.path);
      if (!extraDoc?.body) continue;
      const extra = await renderFragment(extraDoc.body, zip, item.path, divParagraphs, blockquoteSplit);
      if (!extra || englishLetters(extra.paragraphs.join(" ")) < 20) continue;
      const heading = extraDoc.body.querySelector("h1, h2, h3");
      extras.push({
        id: `x${count}`,
        href: item.path,
        opfHref: item.href,
        itemId: item.id,
        spineAt,
        title: englishTitle(textOf(heading), ""),
        paragraphs: extra.paragraphs,
        html: extra.html,
      });
      count += 1;
    }
  }
  if (ready.length === 0)
    throw new CodedError("noEnglishText", "Could not find any English text in this EPUB.");
  let cover: string | null = null;
  let coverTagged = false;
  try {
    if (options.cover !== false) {
      cover = await taggedCover(zip, opf, manifest, opfBase, loadDoc);
      coverTagged = Boolean(cover);
      if (!cover) cover = await spineCover(zip, spine, opfBase, loadDoc);
    }
  } catch {
    cover = null;
    coverTagged = false;
  }
  return {
    title,
    author,
    chapters: ready,
    extras,
    spine: spineRefs.map((item) => ({ href: item.path, opfHref: item.href, itemId: item.id })),
    cover,
    coverTagged,
  };
}

function fileKey(value: string): string {
  const clean = (value.split("#")[0] ?? "").split("?")[0] ?? "";
  try {
    return decodeURIComponent(clean).replace(/\\/g, "/").replace(/^\/+/, "");
  } catch {
    return clean.replace(/\\/g, "/").replace(/^\/+/, "");
  }
}

function baseName(path: string): string {
  const norm = fileKey(path).toLowerCase();
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/** True when two hrefs name the same file (full path, a path suffix, or the file name). */
function sameSpineFile(have: string, want: string): boolean {
  const a = fileKey(have);
  const b = fileKey(want);
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al.endsWith(`/${bl}`) || bl.endsWith(`/${al}`)) return true;
  const left = baseName(a);
  return Boolean(left) && left === baseName(b);
}

function nameMatches(file: { href?: string; opfHref?: string; itemId?: string }, key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (file.itemId === trimmed) return true;
  return (
    (file.href ? sameSpineFile(file.href, trimmed) : false) ||
    (file.opfHref ? sameSpineFile(file.opfHref, trimmed) : false)
  );
}

function extraMatches(extra: EpubExtra, key: string): boolean {
  if (nameMatches(extra, key)) return true;
  return (extra.absorbed ?? []).some((file) => nameMatches(file, key));
}

/**
 * A `spine.merge` name the glossary check should show.
 * `key` / `target`: the name is not a spine item.
 * `idle`: the key is a spine item, and nothing is merged into or from that file.
 */
export type SpineNameWarning = { kind: "key" | "target" | "idle"; name: string };

/**
 * File names in a glossary that should name a spine item. Today that is each
 * `spine.merge` key and its target. A name that matches nothing is a warning.
 * This does not change the book.
 */
export function unmatchedSpineNames(
  merge: Record<string, string> | undefined | null,
  spine: ReadonlyArray<AbsorbedSpineFile>,
): SpineNameWarning[] {
  if (!merge) return [];
  const warnings: SpineNameWarning[] = [];
  const seen = new Set<string>();
  const report = (kind: "key" | "target", name: string) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(`${kind}:${trimmed}`)) return;
    seen.add(`${kind}:${trimmed}`);
    if (spine.some((item) => nameMatches(item, trimmed))) return;
    warnings.push({ kind, name: trimmed });
  };
  for (const [key, target] of Object.entries(merge)) {
    report("key", key);
    if (typeof target === "string") report("target", target);
  }
  return warnings;
}

/**
 * Extras `applySpineMerge` would append, and the chapter each one lands on.
 * Same matching rules. The book is not changed, and paragraph text is not copied.
 */
function plannedSpineMerges(
  book: { chapters: ReadonlyArray<EpubChapter>; extras: ReadonlyArray<EpubExtra> },
  merge: Record<string, string>,
): { extra: EpubExtra; chapter: EpubChapter }[] {
  const pending = book.extras
    .map((extra) => {
      let target = "";
      for (const [key, value] of Object.entries(merge)) {
        if (typeof value !== "string" || !value.trim()) continue;
        if (extraMatches(extra, key)) {
          target = value.trim();
          break;
        }
      }
      return { extra, target };
    })
    .filter((row) => row.target)
    .sort((a, b) => a.extra.spineAt - b.extra.spineAt);
  const planned: { extra: EpubExtra; chapter: EpubChapter }[] = [];
  for (const row of pending) {
    const indexes = chapterIndexes(book.chapters, row.target);
    const at = indexes[indexes.length - 1];
    const chapter = at === undefined ? undefined : book.chapters[at];
    if (!chapter) continue;
    planned.push({ extra: row.extra, chapter });
  }
  return planned;
}

/**
 * `spine.merge` names to warn about. Call this on the book before `applySpineMerge`:
 * a merged extra is no longer in `extras`, so a real key would look idle afterwards.
 * A key that names an empty contents file, or a file absorbed into that extra, does
 * not warn when that extra is appended. A key that names an ordinary chapter, and
 * nothing is appended from that file or onto it, does warn. The book is not changed.
 */
export function spineMergeWarnings(
  merge: Record<string, string> | undefined | null,
  book: Pick<ParsedEpub, "chapters" | "extras" | "spine">,
): SpineNameWarning[] {
  if (!merge) return [];
  const planned = plannedSpineMerges(book, merge);
  const warnings: SpineNameWarning[] = [];
  const seen = new Set<string>();
  const push = (kind: SpineNameWarning["kind"], name: string) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(`${kind}:${trimmed}`)) return;
    seen.add(`${kind}:${trimmed}`);
    warnings.push({ kind, name: trimmed });
  };
  for (const [key, target] of Object.entries(merge)) {
    const trimmed = key.trim();
    if (trimmed) {
      const onSpine = book.spine.some((item) => nameMatches(item, trimmed));
      if (!onSpine) push("key", trimmed);
      else {
        const fromIt = planned.some((row) => extraMatches(row.extra, trimmed));
        const intoIt = planned.some((row) => nameMatches(row.chapter, trimmed));
        if (!fromIt && !intoIt) push("idle", trimmed);
      }
    }
    if (typeof target === "string") {
      const name = target.trim();
      if (name && !book.spine.some((item) => nameMatches(item, name))) push("target", name);
    }
  }
  return warnings;
}

/** English sentences for {@link spineMergeWarnings}. Used by the command-line glossary check. */
export function spineFileWarnings(
  merge: Record<string, string> | undefined | null,
  book: Pick<ParsedEpub, "chapters" | "extras" | "spine">,
): string[] {
  return spineMergeWarnings(merge, book).map((item) => {
    if (item.kind === "key")
      return `spine.merge key "${item.name}" does not match a spine item in this book.`;
    if (item.kind === "idle")
      return `spine.merge key "${item.name}" matches a spine item but nothing is merged into or from it.`;
    return `spine.merge target "${item.name}" does not match a spine item in this book.`;
  });
}

/**
 * The same warnings for a word list imported with this book. Pass the book from
 * before `applySpineMerge`. The book is not changed: a warned name is still ignored
 * when the text is merged.
 */
export function importSpineWarnings(
  merge: Record<string, string> | undefined | null,
  book: Pick<ParsedEpub, "chapters" | "extras" | "spine">,
): SpineNameWarning[] {
  return spineMergeWarnings(merge, book);
}

function chapterIndexes(chapters: ReadonlyArray<EpubChapter>, key: string): number[] {
  const trimmed = key.trim();
  if (!trimmed) return [];
  const byId = chapters.flatMap((chapter, index) => (chapter.itemId === trimmed ? [index] : []));
  if (byId.length > 0) return byId;
  const want = fileKey(trimmed).toLowerCase();
  const exact = chapters.flatMap((chapter, index) => {
    const href = fileKey(chapter.href ?? "").toLowerCase();
    const opf = fileKey(chapter.opfHref ?? "").toLowerCase();
    return want && (href === want || opf === want) ? [index] : [];
  });
  if (exact.length > 0) return exact;
  const suffix = chapters.flatMap((chapter, index) =>
    (chapter.href && sameSpineFile(chapter.href, trimmed)) ||
    (chapter.opfHref && sameSpineFile(chapter.opfHref, trimmed))
      ? [index]
      : [],
  );
  const paths = new Set(suffix.map((index) => chapters[index]?.href ?? ""));
  if (paths.size !== 1) return [];
  return suffix;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A heading for text that `spine.merge` appends. It is not a paragraph.
 * Skip it when the file already shows that title (its first paragraph, or an h1–h4).
 */
function mergeTitleHtml(extra: { title: string; paragraphs: string[]; html: string }): string {
  const title = extra.title.trim();
  if (!title) return "";
  const want = normText(title);
  if (!want) return "";
  if (normText(extra.paragraphs[0] ?? "") === want) return "";
  const headings = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headings.exec(extra.html))) {
    if (normText(match[1].replace(/<[^>]+>/g, " ")) === want) return "";
  }
  return `<h2 data-merge-title="1">${escapeHtml(title)}</h2>`;
}

/**
 * Append dropped spine files onto a contents chapter, in spine order, at the end of
 * that chapter. Earlier paragraphs of the chapter stay put. A name that is not an
 * extra, or that does not name a chapter, is ignored. The input book is not changed.
 * Each appended file shows its title as a heading when that title is not already
 * in the file. The heading is not added to the paragraph list.
 */
export function applySpineMerge<T extends { chapters: EpubChapter[]; extras: EpubExtra[] }>(
  book: T,
  merge: Record<string, string> | undefined | null,
): T {
  if (!merge || book.extras.length === 0) return book;
  const pending = book.extras
    .map((extra) => {
      let target = "";
      for (const [key, value] of Object.entries(merge)) {
        if (typeof value !== "string" || !value.trim()) continue;
        if (extraMatches(extra, key)) {
          target = value.trim();
          break;
        }
      }
      return { extra, target };
    })
    .filter((row) => row.target)
    .sort((a, b) => a.extra.spineAt - b.extra.spineAt);
  if (pending.length === 0) return book;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    paragraphs: [...chapter.paragraphs],
  }));
  const used = new Set<string>();
  for (const row of pending) {
    const indexes = chapterIndexes(chapters, row.target);
    const at = indexes[indexes.length - 1];
    const chapter = at === undefined ? undefined : chapters[at];
    if (!chapter) continue;
    chapter.paragraphs.push(...row.extra.paragraphs);
    chapter.html += mergeTitleHtml(row.extra) + row.extra.html;
    used.add(row.extra.id);
  }
  if (used.size === 0) return book;
  return {
    ...book,
    chapters,
    extras: book.extras.filter((extra) => !used.has(extra.id)),
  };
}

/**
 * Reading order. With no extras this is the chapter list, unchanged. With extras,
 * chapters and extras are interleaved by spine position. Two slices of one file
 * stay in chapter order, and a chapter wins a tie with an extra.
 */
export function readingSlots(book: {
  chapters: ReadonlyArray<{ title: string; spineAt?: number }>;
  extras?: ReadonlyArray<{ spineAt: number }>;
}): ReadingSlot[] {
  const extras = book.extras ?? [];
  if (extras.length === 0) {
    return book.chapters.map((chapter, index) => ({
      kind: "chapter" as const,
      index,
      spineAt: chapter.spineAt ?? index,
    }));
  }
  const slots: ReadingSlot[] = [
    ...book.chapters.map((chapter, index) => ({
      kind: "chapter" as const,
      index,
      spineAt: chapter.spineAt ?? index,
    })),
    ...extras.map((extra, index) => ({
      kind: "extra" as const,
      index,
      spineAt: extra.spineAt,
    })),
  ];
  slots.sort(
    (a, b) =>
      a.spineAt - b.spineAt ||
      (a.kind === b.kind ? a.index - b.index : a.kind === "chapter" ? -1 : 1),
  );
  return slots;
}

function bytesOfDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!match?.[1] || !match[2]) return null;
  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * The cover of a book that is already stored. The EPUB file itself is not kept, but the chapters
 * keep their pictures, so the same rule as the import can run again: the first portrait image
 * that sits at the very start of the book, before any real text. Looks at the first two chapters.
 * Null when there is none (the card keeps its generated cover).
 */
export async function coverFromChapters(chapters: ReadonlyArray<{ html?: string }>): Promise<string | null> {
  for (const chapter of chapters.slice(0, 2)) {
    if (!chapter.html || typeof document === "undefined") continue;
    const doc = parseHtml(`<body>${chapter.html}</body>`);
    const src = doc.body ? leadingImageHref(doc.body, { data: true }) : null;
    if (!src?.startsWith("data:")) continue;
    const image = bytesOfDataUrl(src);
    if (!image || image.mime.includes("svg") || image.bytes.byteLength < 80) continue;
    const size = imagePixelSize(image.bytes);
    if (!size || size.height <= size.width) continue;
    return shrinkCover(image.bytes, image.mime);
  }
  return null;
}
