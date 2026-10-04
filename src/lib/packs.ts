/**
 * Book packs: the way books and their word lists reach the reader.
 *
 * A pack is one book (book.epub) and its whole-book data (glossary.json: meanings, paragraph notes,
 * sentence notes, phrases, coined words). Packs are listed in a catalog (catalog.json) on any static
 * host; the reader downloads one from its Discover card. After a pack is stored in this browser
 * (IndexedDB) the reader needs no network at all. See README, "Reader and book packs".
 */
import {
  deleteStoredBook,
  listBookSummaries,
  listPackRecords,
  loadBookExtras,
  loadBookMeta,
  loadCover,
  loadPackRecord,
  loadStoredBook,
  requestPersistentStorage,
  saveCover,
  savePackRecord,
  saveStoredBook,
  type CoverInfo,
  type PackRecord,
} from "@/lib/book-db";
import { fetchCoverData } from "@/lib/covers";
import { findOnShelf, type Identity } from "@/lib/shelf-identity";
import { useVocab } from "@/lib/vocab-store";
import { applySpineMerge, parseEpub, type ParsedEpub } from "@/lib/epub";
import { validateGlossary } from "@/lib/glossary-format";
import { tr, type Key } from "@/lib/i18n";
import { applyPackGlossary, hashBytes } from "@/lib/pack-glossary";
import { booksUrl } from "@/lib/books-base";
import { isbnDigits, readSeries } from "@/lib/book-meta";
import { readContentCategory, type ContentCategory } from "@/lib/content-category";
import { lexileMeasure } from "@/lib/lexile";

/* ------------------------------------------------------------------ catalog types */

export type PackFileRef = { url: string; bytes: number; sha256: string };

export type CatalogPack = {
  id: string;
  title: string;
  author: string;
  level: string;
  notes: string;
  /** changes whenever the book file or the word list changes; the reader shows "Update available" */
  rev: string;
  /** word list format version (1 or 2) */
  version: number;
  chapters: number;
  words: number;
  paragraphs: number;
  sentences: number;
  phrases: number;
  coined: number;
  epub: PackFileRef;
  glossary: PackFileRef & { rev: string };
  cover: { url: string; bytes: number; sha256: string } | null;
  zip: PackFileRef | null;
  /** Lexile measure such as "880L". "" when the catalog does not give one. */
  lexile: string;
  /** ISBN-13. "" when this edition has none in the pack. */
  isbn: string;
  /** Series title. "" when the book is not in a series. */
  series: string;
  /** 1-based place in the series. 0 when there is no series. */
  seriesNumber: number;
  /**
   * Discover tab. Missing on older catalogs, which are novels.
   * Set by hand in info.json as "speech".
   */
  category: ContentCategory;
  /** English that is too old for a beginner. Set by hand in info.json. */
  oldFashioned: boolean;
  /** Short English reason. "" when the book is not flagged, or when no reason was written. */
  oldFashionedReason: string;
  /** Day the word list last changed, YYYY-MM-DD. "" when the catalog has no date. */
  updated: string;
};

export type Catalog = {
  format: 1;
  name: string;
  updated: string;
  packs: CatalogPack[];
};

/** The public-domain books. Fetched from the books host, or from this origin in dev. */
export const BUNDLED_CATALOG_URL = booksUrl("public-books/catalog.json");
export const DEFAULT_CATALOG_URL = BUNDLED_CATALOG_URL;
const URL_KEY = "cibian-catalog-url-v1";
const CACHE_KEY = "cibian-catalog-cache-v1";
const LEGACY_LIBRARY_KEY = "cibian-library-v1";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

function fileRef(value: unknown): PackFileRef | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const url = text(row.url, 600);
  if (!url) return null;
  return {
    url,
    bytes: count(row.bytes),
    sha256: /^[0-9a-f]{64}$/.test(String(row.sha256)) ? String(row.sha256) : "",
  };
}

/** Read a catalog.json value. Bad packs are skipped; the rest is kept. Never throws. */
export function parseCatalog(value: unknown): Catalog | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.packs)) return null;
  const packs: CatalogPack[] = [];
  const seen = new Set<string>();
  for (const item of raw.packs) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id, 64);
    const epub = fileRef(row.epub);
    const glossary = fileRef(row.glossary);
    if (!ID_PATTERN.test(id) || seen.has(id) || !epub) continue;
    seen.add(id);
    const cover = row.cover && typeof row.cover === "object" ? fileRef(row.cover) : null;
    packs.push({
      id,
      title: text(row.title, 160) || id,
      author: text(row.author, 120),
      level: text(row.level, 200),
      notes: text(row.notes, 400),
      rev: text(row.rev, 64) || (glossary?.sha256 ?? epub.sha256).slice(0, 12),
      version: count(row.version) || 2,
      chapters: count(row.chapters),
      words: count(row.words),
      paragraphs: count(row.paragraphs),
      sentences: count(row.sentences),
      phrases: count(row.phrases),
      coined: count(row.coined),
      epub,
      glossary: {
        url: glossary?.url ?? "",
        bytes: glossary?.bytes ?? 0,
        sha256: glossary?.sha256 ?? "",
        rev:
          text((row.glossary as Record<string, unknown> | undefined)?.rev, 64) ||
          (glossary?.sha256 ?? "").slice(0, 12),
      },
      cover: cover ? { url: cover.url, bytes: cover.bytes, sha256: cover.sha256 } : null,
      zip: fileRef(row.zip),
      lexile: lexileMeasure(row.lexile),
      isbn: isbnDigits(row.isbn),
      ...(() => {
        const series = readSeries(row.series, row.seriesNumber);
        return { series: series.series, seriesNumber: series.seriesNumber };
      })(),
      category: readContentCategory(row.category),
      oldFashioned: row.oldFashioned === true,
      oldFashionedReason: row.oldFashioned === true ? text(row.oldFashionedReason, 240) : "",
      updated: /^\d{4}-\d{2}-\d{2}$/.test(text(row.updated, 10)) ? text(row.updated, 10) : "",
    });
  }
  return {
    format: 1,
    name: text(raw.name, 120),
    updated: text(raw.updated, 40),
    packs,
  };
}

/* ------------------------------------------------------------------ catalog address (Settings) */

export function getCatalogUrl(): string {
  try {
    return localStorage.getItem(URL_KEY)?.trim() || DEFAULT_CATALOG_URL;
  } catch {
    return DEFAULT_CATALOG_URL;
  }
}

export function setCatalogUrl(value: string): void {
  try {
    const clean = value.trim();
    if (!clean || clean === DEFAULT_CATALOG_URL) localStorage.removeItem(URL_KEY);
    else localStorage.setItem(URL_KEY, clean);
  } catch {
    // Blocked storage: the default address is used.
  }
}

/** Is this text a usable catalog address? Returns a plain-English problem, or "" when it is fine. */
export function catalogUrlProblem(value: string): Key | "" {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean, document.baseURI);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "err.catalogScheme";
    return "";
  } catch {
    return "err.catalogBad";
  }
}

/** The absolute address of a file named in the catalog. File addresses are relative to the catalog. */
export function resolveAgainst(catalogUrl: string, file: string): string {
  const base = new URL(catalogUrl, document.baseURI);
  return new URL(file, base).toString();
}

/* ------------------------------------------------------------------ loading the catalog */

export type CatalogResult = {
  catalog: Catalog;
  /** the address that was asked */
  url: string;
  /** true when the network failed and the last saved copy is shown */
  offline: boolean;
};

type CachedCatalog = { url: string; at: number; catalog: Catalog };

function readCache(url: string): CachedCatalog | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CachedCatalog;
    if (data.url !== url) return null;
    const catalog = parseCatalog(data.catalog);
    return catalog ? { url: data.url, at: data.at, catalog } : null;
  } catch {
    return null;
  }
}

function writeCache(url: string, catalog: Catalog) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ url, at: Date.now(), catalog }));
  } catch {
    // The list is just not kept.
  }
}

export async function loadCatalog(url = getCatalogUrl()): Promise<CatalogResult> {
  let failure = tr("err.catalogLoad");
  try {
    const res = await fetch(resolveAgainst(url, ""), { cache: "no-cache" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as unknown;
    const catalog = parseCatalog(json);
    if (!catalog) {
      failure = tr("err.notCatalog");
      throw new Error("not a catalog");
    }
    writeCache(url, catalog);
    return { catalog, url, offline: false };
  } catch {
    const cached = readCache(url);
    if (cached) return { catalog: cached.catalog, url, offline: true };
    throw new Error(failure);
  }
}

/* ------------------------------------------------------------------ installing */

export type InstallInput = {
  packId: string;
  rev: string;
  title: string;
  author: string;
  epub: Uint8Array;
  epubSha256: string;
  /** word list text; empty for a book without a list */
  glossaryText: string;
  /** a data: URL; when empty the cover of the EPUB is used */
  cover: string;
  /** where `cover` came from; the catalog sha256 lets a later start see that the catalog picture changed */
  coverInfo?: CoverInfo;
  /** another name this book is known by (for example the title in its word list), for matching a card */
  also?: Identity;
  /** the book already opened by the caller (saves opening it twice) */
  parsed?: ParsedEpub;
  /** Lexile measure, or "" */
  lexile?: string;
  isbn?: string;
  series?: string;
  seriesNumber?: number;
};

export type InstallResult = {
  bookId: string;
  title: string;
  author: string;
  words: number;
  updated: boolean;
  /** Lexile measure that came with the pack, or "" */
  lexile: string;
  isbn: string;
  series: string;
  seriesNumber: number;
};

/**
 * A tagged OPF cover, or a cover passed in (the word-list catalog, or cover.jpg
 * from a pack), replaces what is stored. A portrait image from the start of the
 * book is used only when the card has no cover yet, so a catalog cover already
 * on a "needs your e-book" card is kept.
 */
async function storeImportedCover(
  bookId: string,
  given: string,
  givenInfo: CoverInfo | undefined,
  parsed: ParsedEpub,
): Promise<void> {
  const tagged = parsed.coverTagged ? parsed.cover ?? "" : "";
  const spine = parsed.coverTagged ? "" : parsed.cover ?? "";
  // `given` is a catalog cover or a pack cover.jpg. Together with a tagged OPF
  // cover it wins over the spine image. The spine image fills in only when the
  // card does not already have a cover.
  const chosen = given || tagged;
  if (chosen) {
    const info: CoverInfo =
      given && given !== tagged ? (givenInfo ?? { source: "epub", ref: "" }) : { source: "epub", ref: "" };
    await saveCover(bookId, chosen, info).catch(() => undefined);
    return;
  }
  if (spine && !(await loadCover(bookId)))
    await saveCover(bookId, spine, { source: "chapter", ref: "" }).catch(() => undefined);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function packRecordFor(packId: string): Promise<PackRecord | null> {
  const all = await listPackRecords();
  return all.find((record) => record.packId === packId) ?? null;
}

/**
 * The card this book already has, if any. First by pack id. Then by what the book is (ISBN, or title and
 * author): a pack .zip often carries a made-up pack id, and a "needs your e-book" card from Discover has
 * the catalog id, so the pack id alone would put the same book on the shelf twice.
 */
async function findInstalled(input: InstallInput): Promise<PackRecord | null> {
  const records = await listPackRecords();
  const byId = records.find((record) => record.packId === input.packId);
  if (byId) return byId;
  const stored = new Set((await listBookSummaries().catch(() => [])).map((book) => book.id));
  const shelf = useVocab
    .getState()
    .books.map((book) => ({ ...book, stored: stored.has(book.id) }));
  const names: Identity[] = [{ title: input.title, author: input.author, isbn: input.isbn ?? "" }];
  if (input.also) names.push({ ...input.also, isbn: input.isbn ?? "" });
  if (input.parsed) names.push({ title: input.parsed.title, author: input.parsed.author, isbn: input.isbn ?? "" });
  const hit = findOnShelf(shelf, names);
  if (!hit) return null;
  return (
    records.find((record) => record.bookId === hit.id) ?? {
      packId: input.packId,
      bookId: hit.id,
      rev: "",
      sha256: "",
      installedAt: Date.now(),
    }
  );
}

function spineMergeOf(glossaryText: string): Record<string, string> | undefined {
  if (!glossaryText.trim()) return undefined;
  const merge = validateGlossary(glossaryText).file?.spine?.merge;
  if (!merge || Object.keys(merge).length === 0) return undefined;
  return merge;
}

/** `2` when the word list opts into chapter-wrapper blockquotes. Otherwise unset. */
function segmentationOf(glossaryText: string): 2 | undefined {
  if (!glossaryText.trim()) return undefined;
  return validateGlossary(glossaryText).file?.segmentation;
}

let installTail: Promise<unknown> = Promise.resolve();

/** Store a pack in this browser. One install runs at a time. Throws a plain-English Error. */
export function installPack(input: InstallInput): Promise<InstallResult> {
  const run = installTail.then(() => installNow(input));
  installTail = run.catch(() => undefined);
  return run;
}

async function installNow(input: InstallInput): Promise<InstallResult> {
  void requestPersistentStorage();
  const existing = await findInstalled(input);
  const sameBook = Boolean(existing && existing.sha256 && existing.sha256 === input.epubSha256);
  let bookId = existing?.bookId ?? "";
  let title = input.title;
  let author = input.author;
  try {
    const spineMerge = spineMergeOf(input.glossaryText);
    const segmentation = segmentationOf(input.glossaryText);
    const storedNow = existing ? await loadStoredBook(existing.bookId).catch(() => null) : null;
    const segChanged = (storedNow?.segmentation === 2) !== (segmentation === 2);
    let parsed = input.parsed;
    if ((!existing || !sameBook || spineMerge || segChanged) && !parsed)
      parsed = await parseEpub(bufferOf(input.epub), { segmentation });
    if (parsed && spineMerge) parsed = applySpineMerge(parsed, spineMerge);
    if (!existing || !sameBook) {
      if (!parsed) throw new Error(tr("err.openFailed"));
      title = input.title || parsed.title;
      author = input.author || parsed.author;
      bookId = existing?.bookId ?? crypto.randomUUID();
      await saveStoredBook({
        id: bookId,
        title,
        author,
        chapters: parsed.chapters,
        ...(parsed.extras.length > 0 ? { extras: parsed.extras } : {}),
        ...(segmentation === 2 ? { segmentation: 2 } : {}),
        glossary: {},
        pending: [],
        totalHard: 0,
      });
      // Read it back: a browser that silently drops the write would lose the book on refresh.
      if (!(await loadBookMeta(bookId))) throw new Error(tr("err.saveFailedPack"));
      await storeImportedCover(bookId, input.cover, input.coverInfo, parsed);
    } else if (sameBook && (spineMerge || segChanged) && parsed && existing) {
      const stored = storedNow ?? (await loadStoredBook(existing.bookId));
      if (stored) {
        const next = {
          ...stored,
          chapters: parsed.chapters,
          extras: parsed.extras,
        };
        if (segmentation === 2) next.segmentation = 2;
        else delete next.segmentation;
        await saveStoredBook(next);
      }
      if (!(await loadCover(bookId)))
        await storeImportedCover(bookId, input.cover, input.coverInfo, parsed);
    } else if (input.parsed && !(await loadCover(bookId))) {
      // The same book again (for example the pack is imported once more): fill in a cover that is missing.
      await storeImportedCover(bookId, input.cover, input.coverInfo, input.parsed);
    }
    let words = 0;
    if (input.glossaryText) {
      // A word list the user added to this book by hand is theirs: an update never replaces it.
      const mine = existing
        ? (await loadBookExtras(bookId).catch(() => null))?.source === "custom"
        : false;
      if (!mine)
        words = (await applyPackGlossary(bookId, input.glossaryText, input.packId, input.rev))
          .words;
    }
    await savePackRecord({
      // A card that was found by what the book is keeps its catalog pack id, so Discover still shows it.
      packId: existing?.packId ?? input.packId,
      bookId,
      rev: input.rev,
      sha256: input.epubSha256,
      installedAt: Date.now(),
    });
    const series = readSeries(input.series, input.seriesNumber);
    return {
      bookId,
      title,
      author,
      words,
      updated: Boolean(existing),
      lexile: lexileMeasure(input.lexile),
      isbn: isbnDigits(input.isbn),
      series: series.series,
      seriesNumber: series.seriesNumber,
    };
  } catch (reason) {
    if (!existing && bookId) await deleteStoredBook(bookId).catch(() => undefined);
    if (reason instanceof DOMException && reason.name === "QuotaExceededError")
      throw new Error(tr("err.noSpace"));
    throw reason instanceof Error ? reason : new Error(tr("err.packAddFailed"));
  }
}

/* ------------------------------------------------------------------ downloading */

export type DownloadProgress = {
  stage: "book" | "words" | "saving";
  /** 0 to 1 over the whole download */
  fraction: number;
};

async function fetchBytes(
  url: string,
  expected: number,
  onBytes: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new Error(tr("err.downloadFailed"));
  }
  if (!res.ok) throw new Error(tr("err.fileNotFound"));
  const total = Number(res.headers.get("content-length")) || expected || 0;
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    onBytes(all.byteLength, all.byteLength);
    return all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onBytes(loaded, total);
      }
    }
  } catch {
    throw new Error(tr("err.downloadStopped"));
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Download one pack of the catalog and store it. */
export async function downloadPack(
  catalogUrl: string,
  pack: CatalogPack,
  onProgress: (progress: DownloadProgress) => void,
): Promise<InstallResult> {
  onProgress({ stage: "book", fraction: 0 });
  // An update of the word list does not need the book again when the book file is the same.
  const have = await packRecordFor(pack.id);
  const keepBook = Boolean(have && have.sha256 && have.sha256 === pack.epub.sha256);
  let epub: Uint8Array = new Uint8Array(0);
  let epubSha = pack.epub.sha256;
  if (!keepBook) {
    epub = await fetchBytes(
      resolveAgainst(catalogUrl, pack.epub.url),
      pack.epub.bytes,
      (loaded, total) =>
        onProgress({
          stage: "book",
          fraction: total > 0 ? Math.min(0.9, (loaded / total) * 0.9) : 0.3,
        }),
    );
    epubSha = (await hashBytes(epub)) || pack.epub.sha256;
    if (pack.epub.sha256 && epubSha && pack.epub.sha256 !== epubSha)
      throw new Error(tr("err.damaged"));
  }

  onProgress({ stage: "words", fraction: 0.92 });
  let glossaryText = "";
  if (pack.glossary.url) {
    const bytes = await fetchBytes(
      resolveAgainst(catalogUrl, pack.glossary.url),
      pack.glossary.bytes,
      () => undefined,
    );
    const sha = await hashBytes(bytes);
    if (pack.glossary.sha256 && sha && pack.glossary.sha256 !== sha)
      throw new Error(tr("err.damaged"));
    glossaryText = new TextDecoder().decode(bytes);
  }
  // The same EPUB file is skipped above. A word list that turns blockquote
  // splitting on or off still needs those bytes, so the stored paragraphs match.
  if (keepBook && have && glossaryText) {
    const segmentation = segmentationOf(glossaryText);
    const stored = await loadStoredBook(have.bookId).catch(() => null);
    if ((stored?.segmentation === 2) !== (segmentation === 2) && pack.epub.url) {
      epub = await fetchBytes(
        resolveAgainst(catalogUrl, pack.epub.url),
        pack.epub.bytes,
        () => undefined,
      );
      epubSha = (await hashBytes(epub)) || pack.epub.sha256;
      if (pack.epub.sha256 && epubSha && pack.epub.sha256 !== epubSha)
        throw new Error(tr("err.damaged"));
    }
  }

  // A missing cover is fine: the book makes its own.
  const cover =
    !keepBook && pack.cover?.url
      ? await fetchCoverData(resolveAgainst(catalogUrl, pack.cover.url), pack.cover.sha256)
      : "";

  onProgress({ stage: "saving", fraction: 0.96 });
  const result = await installPack({
    packId: pack.id,
    rev: pack.rev,
    title: pack.title,
    author: pack.author,
    epub,
    epubSha256: epubSha,
    glossaryText,
    cover,
    ...(cover ? { coverInfo: { source: "catalog" as const, ref: pack.cover?.sha256 ?? "" } } : {}),
    lexile: pack.lexile,
    isbn: pack.isbn,
    series: pack.series,
    seriesNumber: pack.seriesNumber,
  });
  onProgress({ stage: "saving", fraction: 1 });
  return result;
}

/* ------------------------------------------------------------------ what is on this device */

export type PackState =
  { kind: "new" } | { kind: "installed"; bookId: string } | { kind: "update"; bookId: string };

export function stateOf(pack: CatalogPack, records: PackRecord[]): PackState {
  const record = records.find((item) => item.packId === pack.id);
  if (!record) return { kind: "new" };
  return record.rev === pack.rev
    ? { kind: "installed", bookId: record.bookId }
    : { kind: "update", bookId: record.bookId };
}

/**
 * Books that an older version copied from its built-in library have no pack record. Match them to the
 * catalog (by the old library list, or by the pack id kept in the book) so they show as "On your shelf"
 * and can be updated. The books, their word lists, saved words and reading place are never changed.
 * Returns the records that exist afterwards.
 */
export async function adoptLegacyBooks(packs: CatalogPack[]): Promise<PackRecord[]> {
  let records = await listPackRecords();
  try {
    let legacy: Record<string, string> = {};
    try {
      const raw = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? "{}") as {
        ids?: Record<string, string>;
      };
      if (raw.ids && typeof raw.ids === "object") legacy = raw.ids;
    } catch {
      // no old state
    }
    const taken = new Set(records.map((record) => record.packId));
    const owned = new Set(records.map((record) => record.bookId));
    let added = 0;
    for (const book of await listBookSummaries()) {
      if (owned.has(book.id)) continue;
      const meta = await loadBookMeta(book.id);
      const slug = Object.keys(legacy).find((key) => legacy[key] === book.id) ?? "";
      const named = meta?.bundled && meta.bundled !== "custom" ? meta.bundled : "";
      const pack = packs.find(
        (item) => !taken.has(item.id) && (item.id === slug || item.id === named),
      );
      if (!pack) continue;
      const extras = await loadBookExtras(book.id).catch(() => null);
      await savePackRecord({
        packId: pack.id,
        bookId: book.id,
        // The old version kept the short hash of the word list as "rev".
        rev: extras?.rev && extras.rev === pack.glossary.rev ? pack.rev : "",
        // The old library imported exactly this file.
        sha256: slug ? pack.epub.sha256 : "",
        installedAt: Date.now(),
      });
      taken.add(pack.id);
      added += 1;
    }
    if (added > 0) records = await listPackRecords();
  } catch {
    // Matching is a convenience. The books themselves work without it.
  }
  return records;
}

export { loadPackRecord, listPackRecords };
