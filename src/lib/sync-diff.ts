/**
 * Local change tracking for sync. Pure: the engine feeds it store snapshots.
 * Tombstones record deletes so a later pull does not bring the item back.
 */
import {
  asProgress,
  asSettings,
  asShelf,
  asWord,
  bookSyncKey,
  type ProgressData,
  type SettingsData,
  type ShelfData,
  type SyncItem,
  type WordRecord,
} from "./sync-merge.ts";

export type SyncMeta = {
  shelfDeleted: Record<string, number>;
  progressDeleted: Record<string, number>;
  wordsDeleted: Record<string, number>;
  shelfTouched: Record<string, number>;
  wordTouched: Record<string, Record<string, number>>;
  wordRemoved: Record<string, Record<string, number>>;
  settingsUpdatedAt: number;
};

export type LocalWord = WordRecord & { bookId: string };

export type LocalSnapshot = {
  books: ShelfData[];
  words: LocalWord[];
  progress: Record<string, ProgressData>;
  settings: SettingsData;
};

export function emptyMeta(): SyncMeta {
  return {
    shelfDeleted: {},
    progressDeleted: {},
    wordsDeleted: {},
    shelfTouched: {},
    wordTouched: {},
    wordRemoved: {},
    settingsUpdatedAt: 0,
  };
}

export function loadMeta(raw: string | null): SyncMeta {
  const meta = emptyMeta();
  if (!raw) return meta;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    if (parsed.shelfDeleted && typeof parsed.shelfDeleted === "object") meta.shelfDeleted = parsed.shelfDeleted;
    if (parsed.progressDeleted && typeof parsed.progressDeleted === "object") meta.progressDeleted = parsed.progressDeleted;
    if (parsed.wordsDeleted && typeof parsed.wordsDeleted === "object") meta.wordsDeleted = parsed.wordsDeleted;
    if (parsed.shelfTouched && typeof parsed.shelfTouched === "object") meta.shelfTouched = parsed.shelfTouched;
    if (parsed.wordTouched && typeof parsed.wordTouched === "object") meta.wordTouched = parsed.wordTouched;
    if (parsed.wordRemoved && typeof parsed.wordRemoved === "object") meta.wordRemoved = parsed.wordRemoved;
    if (typeof parsed.settingsUpdatedAt === "number") meta.settingsUpdatedAt = parsed.settingsUpdatedAt;
  } catch {
    return emptyMeta();
  }
  return meta;
}

function cloneMeta(meta: SyncMeta): SyncMeta {
  return {
    shelfDeleted: { ...meta.shelfDeleted },
    progressDeleted: { ...meta.progressDeleted },
    wordsDeleted: { ...meta.wordsDeleted },
    shelfTouched: { ...meta.shelfTouched },
    wordTouched: Object.fromEntries(Object.entries(meta.wordTouched).map(([key, value]) => [key, { ...value }])),
    wordRemoved: Object.fromEntries(Object.entries(meta.wordRemoved).map(([key, value]) => [key, { ...value }])),
    settingsUpdatedAt: meta.settingsUpdatedAt,
  };
}

function keysOf(books: ShelfData[]): Map<string, ShelfData> {
  const map = new Map<string, ShelfData>();
  for (const book of books) map.set(bookSyncKey(book), book);
  return map;
}

function wordStamp(word: WordRecord & { bookId?: string }): string {
  const { updatedAt: _updatedAt, bookId: _bookId, ...rest } = word;
  return JSON.stringify(rest);
}

/** Record edits and deletes between two snapshots. `now` is the clock for new tombstones. */
export function noteChanges(meta: SyncMeta, prev: LocalSnapshot, next: LocalSnapshot, now: number): SyncMeta {
  const out = cloneMeta(meta);
  const prevBooks = keysOf(prev.books);
  const nextBooks = keysOf(next.books);

  for (const [key, book] of nextBooks) {
    const before = prevBooks.get(key);
    if (!before || JSON.stringify(before) !== JSON.stringify(book)) {
      if (!before || book.updatedAt <= before.updatedAt) out.shelfTouched[key] = Math.max(out.shelfTouched[key] ?? 0, now);
    }
    if ((out.shelfDeleted[key] ?? 0) <= Math.max(book.updatedAt, out.shelfTouched[key] ?? 0)) {
      delete out.shelfDeleted[key];
    }
    delete out.wordsDeleted[key];
  }

  for (const [key] of prevBooks) {
    if (nextBooks.has(key)) continue;
    out.shelfDeleted[key] = now;
    out.progressDeleted[key] = now;
    out.wordsDeleted[key] = now;
    delete out.shelfTouched[key];
  }

  const prevProgress = prev.progress;
  const nextProgress = next.progress;
  const progressIds = new Set([...Object.keys(prevProgress), ...Object.keys(nextProgress)]);
  for (const bookId of progressIds) {
    const book = next.books.find((item) => item.id === bookId);
    const key = book ? bookSyncKey(book) : progressKey(prev, bookId);
    if (!key) continue;
    const before = prevProgress[bookId];
    const after = nextProgress[bookId];
    if (before && !after && !nextBooks.has(key)) out.progressDeleted[key] = now;
    if (after && (!before || JSON.stringify(before) !== JSON.stringify(after))) {
      delete out.progressDeleted[key];
    }
  }

  const prevWords = groupWords(prev);
  const nextWords = groupWords(next);
  const wordKeys = new Set([...prevWords.keys(), ...nextWords.keys()]);
  for (const key of wordKeys) {
    if (!nextBooks.has(key)) continue;
    const before = prevWords.get(key) ?? new Map<string, WordRecord>();
    const after = nextWords.get(key) ?? new Map<string, WordRecord>();
    const touched = { ...(out.wordTouched[key] ?? {}) };
    const removed = { ...(out.wordRemoved[key] ?? {}) };
    for (const [lemma, word] of after) {
      const prior = before.get(lemma);
      if (!prior || wordStamp(prior) !== wordStamp(word)) touched[lemma] = Math.max(touched[lemma] ?? 0, now);
      delete removed[lemma];
    }
    for (const lemma of before.keys()) {
      if (!after.has(lemma)) {
        removed[lemma] = now;
        delete touched[lemma];
      }
    }
    out.wordTouched[key] = touched;
    out.wordRemoved[key] = removed;
  }

  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) out.settingsUpdatedAt = now;
  return out;
}

function progressKey(snapshot: LocalSnapshot, bookId: string): string | null {
  const book = snapshot.books.find((item) => item.id === bookId);
  return book ? bookSyncKey(book) : null;
}

function groupWords(snapshot: LocalSnapshot): Map<string, Map<string, LocalWord>> {
  const byBook = new Map(snapshot.books.map((book) => [book.id, bookSyncKey(book)]));
  const out = new Map<string, Map<string, LocalWord>>();
  for (const word of snapshot.words) {
    const bookKey = byBook.get(word.bookId);
    if (!bookKey) continue;
    const lemma = word.lemma.toLowerCase();
    const bucket = out.get(bookKey) ?? new Map<string, LocalWord>();
    const prev = bucket.get(lemma);
    if (!prev || word.updatedAt >= prev.updatedAt) bucket.set(lemma, word);
    out.set(bookKey, bucket);
  }
  return out;
}

function shelfTime(book: ShelfData, meta: SyncMeta, key: string): number {
  return Math.max(book.updatedAt, meta.shelfTouched[key] ?? 0);
}

/** The items this device would send. Deletes are tombstones, not missing keys. */
export function buildSyncItems(snapshot: LocalSnapshot, meta: SyncMeta): SyncItem[] {
  const items: SyncItem[] = [];
  const live = keysOf(snapshot.books);
  const words = groupWords(snapshot);

  for (const [key, book] of live) {
    const updatedAt = shelfTime(book, meta, key);
    items.push({ kind: "shelf", itemId: key, updatedAt, deleted: false, data: { ...book, updatedAt } });
    const progress = Object.entries(snapshot.progress).find(([bookId]) => {
      const match = snapshot.books.find((item) => item.id === bookId);
      return match ? bookSyncKey(match) === key : false;
    });
    if (progress) {
      const data = progress[1];
      items.push({
        kind: "progress",
        itemId: key,
        updatedAt: data.updatedAt,
        deleted: false,
        data,
      });
    } else if ((meta.progressDeleted[key] ?? 0) > 0) {
      items.push({
        kind: "progress",
        itemId: key,
        updatedAt: meta.progressDeleted[key] ?? 0,
        deleted: true,
        data: {},
      });
    }

    const bucket = words.get(key) ?? new Map<string, LocalWord>();
    const removed = meta.wordRemoved[key] ?? {};
    const touched = meta.wordTouched[key] ?? {};
    const list: WordRecord[] = [];
    for (const [lemma, word] of bucket) {
      const updatedAt = Math.max(touched[lemma] ?? 0, word.updatedAt, word.lastReviewedAt ?? 0, word.createdAt);
      const { bookId: _bookId, ...rest } = word;
      list.push({ ...rest, updatedAt });
    }
    const tombs = Object.entries(removed)
      .filter(([lemma]) => !bucket.has(lemma))
      .map(([lemma, updatedAt]) => ({ lemma, updatedAt }));
    list.sort((a, b) => a.lemma.toLowerCase().localeCompare(b.lemma.toLowerCase()));
    tombs.sort((a, b) => a.lemma.toLowerCase().localeCompare(b.lemma.toLowerCase()));
    const blobTime = Math.max(0, ...list.map((word) => word.updatedAt), ...tombs.map((row) => row.updatedAt));
    if (list.length > 0 || tombs.length > 0) {
      items.push({
        kind: "words",
        itemId: key,
        updatedAt: blobTime,
        deleted: false,
        data: { words: list, removed: tombs },
      });
    }
  }

  for (const [key, updatedAt] of Object.entries(meta.shelfDeleted)) {
    if (live.has(key)) continue;
    items.push({ kind: "shelf", itemId: key, updatedAt, deleted: true, data: {} });
    if ((meta.progressDeleted[key] ?? 0) > 0) {
      items.push({
        kind: "progress",
        itemId: key,
        updatedAt: meta.progressDeleted[key] ?? updatedAt,
        deleted: true,
        data: {},
      });
    }
    if ((meta.wordsDeleted[key] ?? 0) > 0) {
      items.push({
        kind: "words",
        itemId: key,
        updatedAt: meta.wordsDeleted[key] ?? updatedAt,
        deleted: true,
        data: {},
      });
    }
  }

  items.push({
    kind: "settings",
    itemId: "main",
    updatedAt: meta.settingsUpdatedAt,
    deleted: false,
    data: snapshot.settings,
  });
  return items;
}

export function captureSnapshot(input: {
  books: unknown[];
  words: unknown[];
  progress: Record<string, unknown>;
  settings: unknown;
}): LocalSnapshot {
  const books: ShelfData[] = [];
  for (const book of input.books) {
    const shelf = asShelf(book);
    if (shelf) books.push(shelf);
  }
  const words: LocalWord[] = [];
  for (const word of input.words) {
    const row = asWord(word);
    if (!row || !word || typeof word !== "object") continue;
    const bookId = (word as { bookId?: unknown }).bookId;
    if (typeof bookId !== "string" || !bookId) continue;
    words.push({ ...row, bookId });
  }
  const progress: Record<string, ProgressData> = {};
  for (const [bookId, value] of Object.entries(input.progress)) {
    const row = asProgress(value);
    if (row) progress[bookId] = row;
  }
  return { books, words, progress, settings: asSettings(input.settings) };
}
