import JSZip from "jszip";
import { CodedError } from "./errors.ts";
import { stripWordBreaks, stripWordBreaksIn } from "./glossary-format.ts";

export type EpubChapter = {
  title: string;
  paragraphs: string[];
  html: string;
};

export type ParsedEpub = {
  title: string;
  author: string;
  chapters: EpubChapter[];
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
    const src = tag === "img" ? el.getAttribute("src") : null;
    const centered =
      el.getAttribute("align") === "center" ||
      /text-align\s*:\s*center/i.test(el.getAttribute("style") ?? "");
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    if (centered) el.setAttribute("style", "text-align:center");
    if (tag === "img" && src?.startsWith("data:image/")) el.setAttribute("src", src);
  }
}

/** Paragraph text the reader stores: spaces collapsed, soft hyphens removed. */
function paragraphText(block: ParentNode): string {
  return stripWordBreaks((block.textContent ?? "").replace(/\s+/g, " ").trim());
}

function paragraphsOf(root: ParentNode): string[] {
  const blocks = [...root.querySelectorAll("p, h1, h2, h3, h4, li, blockquote")];
  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.parentElement && ["p", "li", "blockquote"].includes(localName(block.parentElement)))
      continue;
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

async function chapterFromElement(
  source: ParentNode,
  title: string,
  zip: JSZip,
  path: string,
): Promise<EpubChapter | null> {
  // An inert document: images with a relative path must not be fetched from the page address.
  const inert = document.implementation.createHTMLDocument("");
  const holder = inert.createElement("div");
  holder.append(...[...source.childNodes].map((node) => inert.importNode(node, true)));
  dropChinese(holder);
  await embedImages(holder, zip, path);
  sanitize(holder);
  // Before paragraph strings and the stored HTML are taken, so numbering, glossary
  // positions, the import match rate and the text on screen all see the same words.
  stripWordBreaksIn(holder);
  const paragraphs = paragraphsOf(holder);
  const letters = englishLetters(paragraphs.join(" "));
  if (letters < 20) return null;
  const html = holder.innerHTML.trim();
  if (!html) return null;
  return { title: title.slice(0, 90), paragraphs, html };
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
export function leadingImageHref(root: ParentNode): string | null {
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
      return src && !/^https?:/i.test(src) && !src.startsWith("data:") ? src : null;
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

export async function parseEpub(
  buffer: ArrayBuffer,
  options: { cover?: boolean } = {},
): Promise<ParsedEpub> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new CodedError("notValidEpub", "This file is not a valid EPUB book.");
  }
  if (zip.file("META-INF/encryption.xml")) {
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
  const spine = byLocal(opf, "itemref")
    .map((item) => manifest.get(item.getAttribute("idref") ?? ""))
    .filter((item): item is { href: string; type: string; props: string } => Boolean(item))
    .filter((item) => !item.props.includes("nav"))
    .filter((item) => !item.type || item.type.includes("html"))
    .filter((item) => !/(^|\/)(nav|toc|cover)\b/i.test(item.href));

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

  const chapters: EpubChapter[] = [];
  async function push(holder: ParentNode, rawTitle: string, path: string, index: number) {
    if (chapters.length >= CHAPTER_CAP) return;
    stripWordBreaksIn(holder);
    const heading = holder.querySelector?.("h1, h2, h3");
    const title =
      englishTitle(stripWordBreaks(rawTitle), "") ||
      englishTitle(textOf(heading), `Chapter ${index + 1}`);
    const chapter = await chapterFromElement(holder, title, zip, path);
    if (chapter) chapters.push(chapter);
  }

  if (toc.length >= 2) {
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
      if (anchor && !start) continue;
      const end = nextAnchor ? findById(body, nextAnchor) : null;
      const holder = sliceBetween(body, start, end);
      await push(holder, entry.title, path, chapters.length);
    }
  }

  if (chapters.length < 2) {
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
  return { title, author, chapters: ready, cover, coverTagged };
}
