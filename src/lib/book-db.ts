/** One meaning of a word at certain places in the book (word list format version 2). */
export type GlossSense = {
  pos?: string;
  meaning: string;
  whyHard?: string;
  default?: boolean;
  forms?: string[];
  anchors?: Array<{ chapter?: number; occurrence?: number; context?: string; form?: string }>;
};

import { tr } from "@/lib/i18n";
import type { ParagraphHelp, PhraseEntry, SentenceHelp } from "@/lib/glossary-extras";

export type Gloss = {
  /** `true`: the author of the book invented this word (for example "snozzcumber") */
  coined?: boolean;
  pos: string;
  meaning: string;
  whyHard: string;
  /** word forms such as "saws", used by the format; optional */
  forms?: string[];
  /** another sentence from the book with this word (from the pack's word list; optional) */
  example?: string;
  /** other meanings, with the places they are used (optional; version 2 lists only) */
  senses?: GlossSense[];
};

/**
 * Extra help that comes with a word list (paragraphs, sentences, phrases). Kept in its own
 * record (`extras:<bookId>` in the "notes" store) so the glossary record stays small.
 * No schema bump: books and word lists saved before this change simply have no extras.
 */
export type BookExtras = {
  /** which version of the bundled file these came from (index.json "rev"), "" for uploaded lists */
  rev?: string;
  /** slug of the bundled list, or "custom" for a list the user added */
  source?: string;
  paragraphs: ParagraphHelp[];
  sentences: SentenceHelp[];
  phrases: Record<string, PhraseEntry>;
};

/**
 * Where a book on the shelf came from, when it was downloaded or imported as a book pack.
 * Kept in the "notes" store under `pack:<bookId>`, so it goes away with the book.
 */
export type PackRecord = {
  /** pack id from the catalog (for example "twits") */
  packId: string;
  bookId: string;
  /** revision of the pack that is on this device (catalog "rev"), "" when unknown */
  rev: string;
  /** sha256 of the EPUB that was stored, "" when unknown */
  sha256: string;
  installedAt: number;
};

export type StoredChapter = {
  title: string;
  paragraphs: string[];
  html?: string;
};

export type StoredBook = {
  id: string;
  title: string;
  author: string;
  chapters: StoredChapter[];
  glossary: Record<string, Gloss>;
  pending: string[];
  totalHard: number;
  createdAt?: number;
  /** id of the book pack whose word list was loaded into this book ("custom" for a list the user added) */
  bundled?: string;
};

/** The small, frequently-changing part of a book (kept apart from the big chapter text). */
export type BookMeta = {
  id: string;
  title?: string;
  author?: string;
  glossary: Record<string, Gloss>;
  pending: string[];
  totalHard: number;
  /** id of the book pack whose word list was loaded into this book ("custom" for a list the user added) */
  bundled?: string;
};

const DB_NAME = "cibian-books";
const STORE = "books";
const COVERS = "covers";
const NOTES = "notes";
// Glossary/pending progress is kept in its own small record (inside the existing
// "notes" store under the key `gloss:<bookId>`), so defining one word no longer
// re-reads and re-writes the whole book (chapters + images). No schema bump is
// needed, so existing users' data and other open tabs are never blocked.
const GLOSS = NOTES;
const glossKey = (id: string) => `gloss:${id}`;
const extrasKey = (id: string) => `extras:${id}`;
const packKey = (bookId: string) => `pack:${bookId}`;
// Older versions kept answers from an online helper under `help:`. Nothing writes them now.
const helpRange = (id: string) => IDBKeyRange.bound(`help:${id}:`, `help:${id}:\uffff`);
const allHelpRange = () => IDBKeyRange.bound("help:", "help:\uffff");
const DB_VERSION = 3;

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(tr("err.shelfOpen")));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(COVERS)) db.createObjectStore(COVERS);
      if (!db.objectStoreNames.contains(NOTES)) db.createObjectStore(NOTES);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error(tr("err.shelfOpen")));
  });
}

// Safari / in-app browsers sometimes fail the first open with a transient
// "connection lost" error. One failed open used to mean "no books" for the whole
// session, so retry a couple of times before giving up.
async function openDb(): Promise<IDBDatabase> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await openOnce();
    } catch (error) {
      lastError = error;
      if (
        error instanceof DOMException &&
        (error.name === "SecurityError" || error.name === "VersionError")
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(tr("err.shelfOpen"));
}

/**
 * Ask the browser not to evict this site's data (books live only in the
 * browser). Best effort: some browsers silently ignore it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Can this browser actually keep books across a refresh? */
export async function checkBookStorage(): Promise<{ ok: boolean; reason: string }> {
  try {
    if (typeof indexedDB === "undefined") return { ok: false, reason: tr("err.storageNo") };
    const db = await openDb();
    db.close();
    return { ok: true, reason: "" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return {
      ok: false,
      reason: tr("err.storagePrivate", { detail: detail ? ` (${detail})` : "" }),
    };
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(tr("err.shelfIo")));
  });
}

function finish(tx: IDBTransaction, db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(tr("err.shelfIo")));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error(tr("err.shelfIo")));
    };
  });
}

function metaOf(book: StoredBook): BookMeta {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    glossary: book.glossary ?? {},
    pending: book.pending ?? [],
    totalHard: book.totalHard ?? 0,
    ...(book.bundled ? { bundled: book.bundled } : {}),
  };
}

export async function saveStoredBook(book: StoredBook): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readwrite");
  const done = finish(tx, db);
  tx.objectStore(STORE).put(book, book.id);
  tx.objectStore(GLOSS).put(metaOf(book), glossKey(book.id));
  await done;
}

export async function listStoredBooks(): Promise<StoredBook[]> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readonly");
  const done = finish(tx, db);
  const booksReq = tx.objectStore(STORE).getAll() as IDBRequest<StoredBook[]>;
  const metaReq = tx.objectStore(GLOSS).getAll() as IDBRequest<unknown[]>;
  const keyReq = tx.objectStore(GLOSS).getAllKeys();
  const [books, metas, keys] = await Promise.all([
    requestToPromise(booksReq),
    requestToPromise(metaReq),
    requestToPromise(keyReq),
  ]);
  await done;
  const byId = new Map<string, BookMeta>();
  (keys ?? []).forEach((key, index) => {
    const value = metas?.[index] as BookMeta | undefined;
    if (typeof key === "string" && key.startsWith("gloss:") && value && typeof value === "object") {
      byId.set(key.slice(6), value);
    }
  });
  return (books ?? []).map((book) => {
    const meta = byId.get(book.id);
    return meta
      ? { ...book, glossary: meta.glossary, pending: meta.pending, totalHard: meta.totalHard }
      : book;
  });
}

/**
 * Shelf listing without loading chapter text. The old shelf startup called
 * `listStoredBooks()`, which pulled every chapter and embedded image of every
 * book into memory just to read titles, so the shelf looked empty for a long
 * time after a refresh once a few books were stored.
 */
export async function listBookSummaries(): Promise<
  Array<{ id: string; title: string; author: string }>
> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readonly");
  const done = finish(tx, db);
  const idsReq = tx.objectStore(STORE).getAllKeys();
  const metaKeysReq = tx.objectStore(NOTES).getAllKeys();
  const metaReq = tx.objectStore(NOTES).getAll() as IDBRequest<unknown[]>;
  const [ids, metaKeys, metas] = await Promise.all([
    requestToPromise(idsReq),
    requestToPromise(metaKeysReq),
    requestToPromise(metaReq),
  ]);
  await done;
  const byId = new Map<string, BookMeta>();
  (metaKeys ?? []).forEach((key, index) => {
    const value = metas?.[index] as BookMeta | undefined;
    if (typeof key === "string" && key.startsWith("gloss:") && value && typeof value === "object") {
      byId.set(key.slice(6), value);
    }
  });
  const out: Array<{ id: string; title: string; author: string }> = [];
  for (const key of ids ?? []) {
    if (typeof key !== "string") continue;
    const meta = byId.get(key);
    if (meta && typeof meta.title === "string") {
      out.push({ id: key, title: meta.title, author: meta.author ?? "" });
      continue;
    }
    // Book saved by an older version: read it once and remember its title.
    const full = await loadStoredBook(key).catch(() => null);
    if (!full) continue;
    out.push({ id: full.id, title: full.title, author: full.author });
    void patchStoredBook(full.id, (m) => {
      m.title = full.title;
      m.author = full.author;
    }).catch(() => undefined);
  }
  return out;
}

export async function saveNotes(words: unknown[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(NOTES).put(words, "words");
  await done;
}

export async function loadNotes(): Promise<unknown[]> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readonly");
  const done = finish(tx, db);
  const value = await requestToPromise(tx.objectStore(NOTES).get("words") as IDBRequest<unknown>);
  await done;
  return Array.isArray(value) ? value : [];
}

export async function loadStoredBook(id: string): Promise<StoredBook | null> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readonly");
  const done = finish(tx, db);
  const bookReq = tx.objectStore(STORE).get(id) as IDBRequest<StoredBook | undefined>;
  const metaReq = tx.objectStore(GLOSS).get(glossKey(id)) as IDBRequest<BookMeta | undefined>;
  const [book, meta] = await Promise.all([requestToPromise(bookReq), requestToPromise(metaReq)]);
  await done;
  if (!book) return null;
  return meta
    ? { ...book, glossary: meta.glossary, pending: meta.pending, totalHard: meta.totalHard }
    : book;
}

/** Light read: only glossary + pending (no chapter text). Fast even for image-heavy books. */
export async function loadBookMeta(id: string): Promise<BookMeta | null> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readonly");
  const done = finish(tx, db);
  const exists = await requestToPromise(tx.objectStore(STORE).getKey(id));
  let meta: BookMeta | null = null;
  if (exists !== undefined) {
    const stored = await requestToPromise(
      tx.objectStore(GLOSS).get(glossKey(id)) as IDBRequest<BookMeta | undefined>,
    );
    if (stored) meta = stored;
    else {
      // Book saved by an older version: progress still sits inside the book record.
      const legacy = await requestToPromise(
        tx.objectStore(STORE).get(id) as IDBRequest<StoredBook | undefined>,
      );
      if (legacy) meta = metaOf(legacy);
    }
  }
  await done;
  return meta;
}

export async function deleteStoredBook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE, COVERS, NOTES], "readwrite");
  const done = finish(tx, db);
  tx.objectStore(STORE).delete(id);
  tx.objectStore(COVERS).delete(id);
  tx.objectStore(GLOSS).delete(glossKey(id));
  tx.objectStore(NOTES).delete(extrasKey(id));
  tx.objectStore(NOTES).delete(packKey(id));
  tx.objectStore(NOTES).delete(helpRange(id));
  await done;
}

/* ------------------------------------------------------------------ extras and help cache */

const extrasRevisions = new Map<string, number>();

/** Changes every time the extras of a book are saved in this tab (lets callers drop their memory copy). */
export const extrasRevision = (id: string): number => extrasRevisions.get(id) ?? 0;

export async function loadBookExtras(id: string): Promise<BookExtras | null> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readonly");
  const done = finish(tx, db);
  const value = await requestToPromise(
    tx.objectStore(NOTES).get(extrasKey(id)) as IDBRequest<BookExtras | undefined>,
  );
  await done;
  if (!value || typeof value !== "object") return null;
  return {
    ...(value.rev ? { rev: value.rev } : {}),
    ...(value.source ? { source: value.source } : {}),
    paragraphs: Array.isArray(value.paragraphs) ? value.paragraphs : [],
    sentences: Array.isArray(value.sentences) ? value.sentences : [],
    phrases: value.phrases && typeof value.phrases === "object" ? value.phrases : {},
  };
}

export async function saveBookExtras(id: string, extras: BookExtras): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(NOTES).put(extras, extrasKey(id));
  await done;
  extrasRevisions.set(id, extrasRevision(id) + 1);
}

/** One-time clean-up: remove the saved answers an older version kept from its online helper. */
export async function purgeLegacyHelpCache(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(NOTES).delete(allHelpRange());
  await done;
}

/* ------------------------------------------------------------------ book packs */

export async function savePackRecord(record: PackRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(NOTES).put(record, packKey(record.bookId));
  await done;
}

export async function loadPackRecord(bookId: string): Promise<PackRecord | null> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readonly");
  const done = finish(tx, db);
  const value = await requestToPromise(
    tx.objectStore(NOTES).get(packKey(bookId)) as IDBRequest<PackRecord | undefined>,
  );
  await done;
  return value && typeof value === "object" && typeof value.packId === "string" ? value : null;
}

/** Every pack that is on this device (one record per book). */
export async function listPackRecords(): Promise<PackRecord[]> {
  const db = await openDb();
  const tx = db.transaction([STORE, NOTES], "readonly");
  const done = finish(tx, db);
  const range = IDBKeyRange.bound("pack:", "pack:\uffff");
  const valuesReq = tx.objectStore(NOTES).getAll(range) as IDBRequest<PackRecord[]>;
  const idsReq = tx.objectStore(STORE).getAllKeys();
  const [values, ids] = await Promise.all([requestToPromise(valuesReq), requestToPromise(idsReq)]);
  await done;
  const alive = new Set((ids ?? []).filter((id): id is string => typeof id === "string"));
  // A record whose book is gone is ignored.
  return (values ?? []).filter(
    (item) => item && typeof item.packId === "string" && alive.has(item.bookId),
  );
}

const writeTail = new Map<string, Promise<void>>();

/**
 * Read-modify-write the glossary/pending progress of one book in a single
 * transaction. Only the small meta record is written, never the chapters.
 */
export async function patchStoredBook(
  id: string,
  change: (meta: BookMeta) => void,
): Promise<BookMeta | null> {
  const prev = writeTail.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE, NOTES], "readwrite");
    const done = finish(tx, db);
    try {
      const exists = await requestToPromise(tx.objectStore(STORE).getKey(id));
      if (exists === undefined) {
        await done;
        return null;
      }
      let meta = await requestToPromise(
        tx.objectStore(GLOSS).get(glossKey(id)) as IDBRequest<BookMeta | undefined>,
      );
      if (!meta) {
        const legacy = await requestToPromise(
          tx.objectStore(STORE).get(id) as IDBRequest<StoredBook | undefined>,
        );
        if (!legacy) {
          await done;
          return null;
        }
        meta = metaOf(legacy);
      }
      change(meta);
      tx.objectStore(GLOSS).put(meta, glossKey(id));
      await done;
      return meta;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await done.catch(() => undefined);
      throw error;
    }
  });
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  writeTail.set(id, settled);
  return next;
}

export async function saveCover(id: string, cover: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(COVERS, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(COVERS).put(cover, id);
  await done;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cibian-covers"));
}

export async function loadAllCovers(): Promise<Record<string, string>> {
  const db = await openDb();
  const tx = db.transaction(COVERS, "readonly");
  const store = tx.objectStore(COVERS);
  const done = finish(tx, db);
  const keysReq = store.getAllKeys();
  const valuesReq = store.getAll();
  const keys = await requestToPromise(keysReq);
  const values = await requestToPromise(valuesReq);
  await done;
  const covers: Record<string, string> = {};
  keys.forEach((key, index) => {
    const value = values[index];
    if (typeof key === "string" && typeof value === "string") covers[key] = value;
  });
  return covers;
}

/** A downloaded word list, kept so it can be paired with the reader's own EPUB later. */
export async function saveCachedText(key: string, text: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readwrite");
  const done = finish(tx, db);
  tx.objectStore(NOTES).put(text, key);
  await done;
}

export async function loadCachedText(key: string): Promise<string> {
  const db = await openDb();
  const tx = db.transaction(NOTES, "readonly");
  const done = finish(tx, db);
  const value = await requestToPromise(tx.objectStore(NOTES).get(key) as IDBRequest<unknown>);
  await done;
  return typeof value === "string" ? value : "";
}
