/**
 * Word lists for the notebook. A book on this device is read from its saved list.
 * A list that is not here is fetched from the books host, the same files Discover uses.
 * A custom list is never fetched: another device shows the word without a snippet
 * until that list exists locally.
 */
import { booksUrl } from "@/lib/books-base";
import { listPackRecords, loadBookExtras, loadBookMeta, type BookMeta, type PackRecord } from "@/lib/book-db";
import type { GlossFileView } from "@/lib/gloss-ref";
import { bookGlossKey, catalogListId, glossCacheKey, type GlossPoint } from "@/lib/gloss-point";
import type { Book } from "@/lib/vocab-model";
import { bookForSource } from "@/lib/wordbook";

type Listener = () => void;

const listeners = new Set<Listener>();
const cache = new Map<string, GlossFileView>();
const bookLists = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();
let packsPromise: Promise<PackRecord[]> | null = null;
let epoch = 0;
let watching = false;

function notify(): void {
  for (const listener of listeners) listener();
}

/** A word-list update replaces the file on this device. Drop the memory copy so the next read is the new one. */
function watchListUpdates(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("cibian-progress", () => {
    epoch += 1;
    cache.clear();
    bookLists.clear();
    inflight.clear();
    notify();
  });
}

export function subscribeGloss(listener: Listener): () => void {
  watchListUpdates();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function glossSnapshot(): ReadonlyMap<string, GlossFileView> {
  return new Map(cache);
}

function publish(key: string, file: GlossFileView): void {
  cache.set(key, file);
  notify();
}

/** List id plus file for each shelf book whose list has been loaded. Used to turn old saves into pointers. */
export function bookListSnapshot(): ReadonlyMap<string, { list: string; file: GlossFileView }> {
  const out = new Map<string, { list: string; file: GlossFileView }>();
  for (const [book, list] of bookLists) {
    const file = cache.get(bookGlossKey(book));
    if (file) out.set(book, { list, file });
  }
  return out;
}

function viewFromJson(value: unknown): GlossFileView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!raw.glossary || typeof raw.glossary !== "object" || Array.isArray(raw.glossary)) return null;
  const phrases = raw.phrases && typeof raw.phrases === "object" && !Array.isArray(raw.phrases) ? raw.phrases : {};
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    author: typeof raw.author === "string" ? raw.author : "",
    glossary: raw.glossary as GlossFileView["glossary"],
    phrases: phrases as GlossFileView["phrases"],
  };
}

function viewFromLocal(meta: BookMeta, phrases: GlossFileView["phrases"], book?: { title: string; author: string }): GlossFileView {
  return {
    title: book?.title || meta.title || "",
    author: book?.author || "",
    glossary: meta.glossary,
    phrases: phrases ?? {},
  };
}

function sameList(meta: BookMeta | null, extrasSource: string | undefined, list: string): boolean {
  const id = catalogListId(meta?.bundled || extrasSource);
  if (list === "custom") return id === "custom";
  return id === list;
}

async function packs(): Promise<PackRecord[]> {
  packsPromise ??= listPackRecords().catch(() => []);
  return packsPromise;
}

async function localFile(ref: GlossPoint, bookKey: string, books: readonly Book[]): Promise<GlossFileView | null> {
  const shelf = bookForSource({ book: bookKey }, books);
  const candidates: Array<{ id: string; title?: string; author?: string }> = [];
  if (shelf) candidates.push(shelf);
  if (ref.list !== "custom") {
    for (const record of await packs()) {
      if (record.packId === ref.list && !candidates.some((item) => item.id === record.bookId)) {
        candidates.push({ id: record.bookId });
      }
    }
  }
  for (const candidate of candidates) {
    const meta = await loadBookMeta(candidate.id).catch(() => null);
    if (!meta) continue;
    const extras = await loadBookExtras(candidate.id).catch(() => null);
    if (!sameList(meta, extras?.source, ref.list)) continue;
    return viewFromLocal(meta, extras?.phrases, "title" in candidate ? { title: candidate.title ?? "", author: candidate.author ?? "" } : undefined);
  }
  return null;
}

async function fetchList(id: string): Promise<GlossFileView | null> {
  if (catalogListId(id) === "custom") return null;
  for (const path of [`word-lists/${id}/glossary.json`, `public-books/${id}/glossary.json`]) {
    try {
      const response = await fetch(booksUrl(path));
      if (!response.ok) continue;
      const view = viewFromJson(await response.json());
      if (view) return view;
    } catch {
      // The other path may still have the list.
    }
  }
  return null;
}

async function resolveOne(ref: GlossPoint, bookKey: string, books: readonly Book[]): Promise<GlossFileView | null> {
  const local = await localFile(ref, bookKey, books);
  if (local) return local;
  if (ref.list === "custom") return null;
  return fetchList(ref.list);
}

async function resolveBook(bookKey: string, books: readonly Book[]): Promise<{ list: string; file: GlossFileView } | null> {
  const shelf = bookForSource({ book: bookKey }, books);
  if (!shelf) return null;
  const meta = await loadBookMeta(shelf.id).catch(() => null);
  const extras = await loadBookExtras(shelf.id).catch(() => null);
  const list = catalogListId(meta?.bundled || extras?.source);
  if (meta && Object.keys(meta.glossary ?? {}).length > 0) {
    return { list, file: viewFromLocal(meta, extras?.phrases, { title: shelf.title, author: shelf.author }) };
  }
  if (list === "custom") return null;
  const fetched = await fetchList(list);
  return fetched ? { list, file: fetched } : null;
}

function remember(started: number, bookKey: string, result: { list: string; file: GlossFileView }): void {
  if (started !== epoch) return;
  bookLists.set(bookKey, result.list);
  cache.set(bookGlossKey(bookKey), result.file);
  cache.set(glossCacheKey({ list: result.list }, bookKey), result.file);
  notify();
}

/** Load the word list of one shelf book, for a saved word that does not have a pointer yet. */
export function requestBookGloss(bookKey: string, books: readonly Book[]): void {
  watchListUpdates();
  if (!bookKey) return;
  const key = bookGlossKey(bookKey);
  if (cache.has(key) || inflight.has(key)) return;
  const started = epoch;
  const job = resolveBook(bookKey, books)
    .then((result) => {
      inflight.delete(key);
      if (result) remember(started, bookKey, result);
    })
    .catch(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
}

/** Load one list into the memory cache. A list already loaded, or already loading, is left alone. */
export function requestGloss(ref: GlossPoint, bookKey: string, books: readonly Book[]): void {
  watchListUpdates();
  const key = glossCacheKey(ref, bookKey);
  if (cache.has(key) || inflight.has(key)) return;
  const started = epoch;
  const job = resolveOne(ref, bookKey, books)
    .then((file) => {
      inflight.delete(key);
      if (file && started === epoch) publish(key, file);
    })
    .catch(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
}
