/**
 * Local change tracking for sync. Pure: the engine feeds it store snapshots.
 * Tombstones record deletes so a later pull does not bring the item back.
 */
import {
  asProgress,
  asSettings,
  asShelf,
  asWordbookRecord,
  bookSyncKey,
  isLive,
  sourceKey,
  wordbookItemId,
  wordbookShard,
  type ProgressData,
  type SettingsData,
  type ShelfData,
  type SourceRecord,
  type SyncItem,
  type WordbookRecord,
} from "./sync-merge.ts";

export type SyncMeta = {
  shelfDeleted: Record<string, number>;
  progressDeleted: Record<string, number>;
  shelfTouched: Record<string, number>;
  /** lemma -> time this device last changed the card (the wordbook is global, not per book) */
  wordTouched: Record<string, number>;
  /** lemma -> time this device took the word out of the wordbook */
  wordRemoved: Record<string, number>;
  /** lemma -> source key -> time this device took that source away */
  sourceRemoved: Record<string, Record<string, number>>;
  settingsUpdatedAt: number;
};

export type LocalWord = WordbookRecord;

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
    shelfTouched: {},
    wordTouched: {},
    wordRemoved: {},
    sourceRemoved: {},
    settingsUpdatedAt: 0,
  };
}

/** Older versions kept `bookKey -> lemma -> time`. The wordbook is global now: keep the latest time per lemma. */
function flattenPerBook(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number") out[key] = Math.max(out[key] ?? 0, entry);
    else if (entry && typeof entry === "object") {
      for (const [lemma, time] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof time === "number") out[lemma] = Math.max(out[lemma] ?? 0, time);
      }
    }
  }
  return out;
}

export function loadMeta(raw: string | null): SyncMeta {
  const meta = emptyMeta();
  if (!raw) return meta;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    if (parsed.shelfDeleted && typeof parsed.shelfDeleted === "object") meta.shelfDeleted = parsed.shelfDeleted;
    if (parsed.progressDeleted && typeof parsed.progressDeleted === "object") meta.progressDeleted = parsed.progressDeleted;
    if (parsed.shelfTouched && typeof parsed.shelfTouched === "object") meta.shelfTouched = parsed.shelfTouched;
    meta.wordTouched = flattenPerBook(parsed.wordTouched);
    meta.wordRemoved = flattenPerBook(parsed.wordRemoved);
    if (parsed.sourceRemoved && typeof parsed.sourceRemoved === "object") {
      for (const [lemma, row] of Object.entries(parsed.sourceRemoved)) {
        if (row && typeof row === "object") meta.sourceRemoved[lemma] = { ...row };
      }
    }
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
    shelfTouched: { ...meta.shelfTouched },
    wordTouched: { ...meta.wordTouched },
    wordRemoved: { ...meta.wordRemoved },
    sourceRemoved: Object.fromEntries(Object.entries(meta.sourceRemoved).map(([key, value]) => [key, { ...value }])),
    settingsUpdatedAt: meta.settingsUpdatedAt,
  };
}

function keysOf(books: ShelfData[]): Map<string, ShelfData> {
  const map = new Map<string, ShelfData>();
  for (const book of books) map.set(bookSyncKey(book), book);
  return map;
}

function wordStamp(word: WordbookRecord): string {
  const { updatedAt: _updatedAt, ...rest } = word;
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
  }

  for (const [key] of prevBooks) {
    if (nextBooks.has(key)) continue;
    out.shelfDeleted[key] = now;
    out.progressDeleted[key] = now;
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

  // The wordbook is global: words are tracked by lemma, whatever book they came from. Deleting a book from
  // the shelf does not remove its words.
  const prevWords = byLemma(prev.words);
  const nextWords = byLemma(next.words);
  for (const [lemma, word] of nextWords) {
    const prior = prevWords.get(lemma);
    if (!prior || wordStamp(prior) !== wordStamp(word)) out.wordTouched[lemma] = Math.max(out.wordTouched[lemma] ?? 0, now);
    delete out.wordRemoved[lemma];
    const live = new Set(word.sources.filter(isLive).map((source) => source.k));
    const gone = { ...(out.sourceRemoved[lemma] ?? {}) };
    for (const key of live) delete gone[key];
    for (const source of prior?.sources ?? []) {
      if (isLive(source) && !live.has(source.k)) gone[source.k] = now;
    }
    if (Object.keys(gone).length > 0) out.sourceRemoved[lemma] = gone;
    else delete out.sourceRemoved[lemma];
  }
  for (const lemma of prevWords.keys()) {
    if (nextWords.has(lemma)) continue;
    out.wordRemoved[lemma] = now;
    delete out.wordTouched[lemma];
    delete out.sourceRemoved[lemma];
  }

  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) out.settingsUpdatedAt = now;
  return out;
}

function progressKey(snapshot: LocalSnapshot, bookId: string): string | null {
  const book = snapshot.books.find((item) => item.id === bookId);
  return book ? bookSyncKey(book) : null;
}

function byLemma(words: readonly WordbookRecord[]): Map<string, WordbookRecord> {
  const out = new Map<string, WordbookRecord>();
  for (const word of words) {
    const lemma = word.lemma.toLowerCase();
    const prev = out.get(lemma);
    if (!prev || word.updatedAt >= prev.updatedAt) out.set(lemma, word);
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
  }

  items.push(...wordbookItems(snapshot, meta));
  items.push({
    kind: "settings",
    itemId: "main",
    updatedAt: meta.settingsUpdatedAt,
    deleted: false,
    data: snapshot.settings,
  });
  return items;
}

/** A pointer source keeps the paragraph and drops the stored meaning. The meaning is read from the word list. */
function publishSource(source: Extract<SourceRecord, { book: string }>): SourceRecord {
  const keyed = { ...source, k: sourceKey(source) };
  if (!keyed.ref) return keyed;
  const next = { ...keyed };
  delete next.meaning;
  return next;
}

/** The wordbook as sync items: one per first letter, so no stored row grows without bound. */
export function wordbookItems(snapshot: LocalSnapshot, meta: SyncMeta): SyncItem[] {
  const shards = new Map<string, { words: WordbookRecord[]; removed: Array<{ lemma: string; updatedAt: number }> }>();
  const shardOf = (lemma: string) => {
    const id = wordbookShard(lemma);
    const slot = shards.get(id) ?? { words: [], removed: [] };
    shards.set(id, slot);
    return slot;
  };
  const here = byLemma(snapshot.words);
  for (const [lemma, word] of here) {
    const updatedAt = Math.max(meta.wordTouched[lemma] ?? 0, word.updatedAt, word.lastReviewedAt ?? 0, word.createdAt);
    const liveSources = word.sources.filter(isLive).map((source) => publishSource(source));
    const liveKeys = new Set(liveSources.map((source) => source.k));
    const stubs: SourceRecord[] = Object.entries(meta.sourceRemoved[lemma] ?? {})
      .filter(([k]) => !liveKeys.has(k))
      .map(([k, removed]) => ({ k, removed }));
    const published: WordbookRecord = { ...word, updatedAt, sources: [...liveSources, ...stubs] };
    if (liveSources.length > 0 && liveSources.every((source) => isLive(source) && source.ref)) {
      let kept = "";
      for (const source of liveSources) {
        if (isLive(source) && source.sentence) {
          kept = source.sentence;
          break;
        }
      }
      published.sentence = kept || published.sentence;
      published.meaning = "";
      published.whyHard = "";
      delete published.uses;
    }
    shardOf(lemma).words.push(published);
  }
  for (const [lemma, updatedAt] of Object.entries(meta.wordRemoved)) {
    if (here.has(lemma)) continue;
    shardOf(lemma).removed.push({ lemma, updatedAt });
  }
  const items: SyncItem[] = [];
  for (const [shard, blob] of [...shards].sort((a, b) => a[0].localeCompare(b[0]))) {
    blob.words.sort((a, b) => a.lemma.toLowerCase().localeCompare(b.lemma.toLowerCase()));
    blob.removed.sort((a, b) => a.lemma.toLowerCase().localeCompare(b.lemma.toLowerCase()));
    const updatedAt = Math.max(0, ...blob.words.map((word) => word.updatedAt), ...blob.removed.map((row) => row.updatedAt));
    items.push({ kind: "wordbook", itemId: wordbookItemId(shard), updatedAt, deleted: false, data: blob });
  }
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
    const row = asWordbookRecord(word);
    if (row) words.push(row);
  }
  const progress: Record<string, ProgressData> = {};
  for (const [bookId, value] of Object.entries(input.progress)) {
    const row = asProgress(value);
    if (row) progress[bookId] = row;
  }
  return { books, words, progress, settings: asSettings(input.settings) };
}
