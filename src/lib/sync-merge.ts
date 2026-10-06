/**
 * Pure merge for account sync. No DOM, no zustand, no network.
 *
 * An item is one bookshelf card, one book's reading progress, a shard of the global wordbook, or the single
 * settings blob. Last-write-wins is per item. Saved words inside a wordbook shard are unioned by lemma, so
 * two devices can each add a word without wiping the other, and the sources of a word (the books it was
 * met in) are unioned too. The second argument wins when updatedAt ties.
 *
 * Kind `words` is the old per-book word list. New clients no longer write it; they read it once per pull
 * and fold it into the wordbook (`foldLegacyWords`), so an older client that still writes it is not lost.
 */
import { asGlossPoint, type GlossPoint } from "./gloss-point.ts";
import { asAnchor, normalizeQuote, type TextAnchor } from "./position.ts";

export const SYNC_KINDS = ["shelf", "progress", "words", "wordbook", "settings"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export type SyncItem = {
  kind: SyncKind;
  itemId: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
};

export type WordRecord = {
  id: string;
  surface: string;
  lemma: string;
  pos: string;
  meaning: string;
  whyHard: string;
  recommend: boolean;
  sentence: string;
  seen?: number;
  uses?: string;
  stage: number;
  dueAt: number;
  createdAt: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: number;
  updatedAt: number;
};

export type WordTombstone = { lemma: string; updatedAt: number };

/** Where a word was met, as stored on the server. `k` is `sourceKey`. */
export type SourceLive = {
  k: string;
  book: string;
  title?: string;
  author?: string;
  chapter?: number;
  chapterTitle?: string;
  sentence?: string;
  surface: string;
  meaning?: string;
  pos?: string;
  at?: TextAnchor;
  savedAt: number;
  /** Word-list pointer. The meaning is read from that list. The sentence stays so the notebook can show the paragraph. */
  ref?: GlossPoint;
};
/** The reader took this source away at `removed`. Kept for a while so an older copy cannot bring it back. */
export type SourceGone = { k: string; removed: number };
export type SourceRecord = SourceLive | SourceGone;

export type WordbookRecord = WordRecord & { sources: SourceRecord[] };
export type WordbookBlob = { words: WordbookRecord[]; removed: WordTombstone[] };

export const MAX_LIVE_SOURCES = 12;
const GONE_KEEP_MS = 90 * 86_400_000;

/**
 * The same save on two devices has the same key.
 * A word-list pointer uses the list place. An older save uses the book plus the start of the sentence.
 */
export function sourceKey(source: {
  book: string;
  sentence?: string;
  surface?: string;
  ref?: GlossPoint | null;
}): string {
  const ref = source.ref;
  if (ref?.list) {
    const form = (ref.form ?? "").trim().toLowerCase();
    return `${source.book}#${ref.list}#${ref.phrase ? "p" : "w"}#${ref.chapter ?? ""}#${ref.occurrence ?? ""}#${form}#${ref.mark ?? ""}`;
  }
  const sentence = normalizeQuote(source.sentence ?? "");
  if (sentence) return `${source.book}#${sentence.slice(0, 48)}`;
  return `${source.book}#${(source.surface ?? "").trim().toLowerCase()}`;
}

/** The wordbook is stored in 27 items (first letter of the lemma, or 0) so no row grows without bound. */
export function wordbookShard(lemma: string): string {
  const first = lemma.trim().toLowerCase().charAt(0);
  return /[a-z]/.test(first) ? first : "0";
}
export const wordbookItemId = (shard: string): string => `w-${shard}`;
export const isLive = (source: SourceRecord): source is SourceLive => !("removed" in source);

export type WordBlob = {
  words: WordRecord[];
  removed: WordTombstone[];
};

export type ShelfData = {
  id: string;
  title: string;
  author: string;
  cloth: "cloth" | "ribbon" | "ink" | "sage";
  createdAt: number;
  updatedAt: number;
  source?: "epub" | "notes";
  lexile?: string;
  isbn?: string;
  series?: string;
  seriesNumber?: number;
  matchRate?: number;
  needsEpub?: boolean;
  oldFashioned?: boolean;
  oldFashionedReason?: string;
};

export type ProgressData = {
  chapter: number;
  chapters: number;
  scroll: number;
  updatedAt: number;
  /**
   * File-independent place (see position.ts). `chapter` and `scroll` above are the older, file-dependent hint
   * and stay for older clients and as a fallback. Optional: a position saved before anchors existed omits it.
   * When `extraId` is set, this anchor is resolved inside that extra.
   */
  anchor?: TextAnchor;
  /** Set while the open page is an extra spine file. Optional: omitted on a numbered chapter and on older saves. */
  extraId?: string;
};

export type ReviewDay = { reviewed: number; correct: number };

export type SettingsData = {
  theme: "light" | "sepia" | "dark";
  font: "literata" | "lora" | "sans";
  size: number;
  leading: number;
  width: "narrow" | "medium" | "wide";
  column: number;
  focus: boolean;
  locale: "en" | "zh";
  reviewLog: Record<string, ReviewDay>;
};

const ITEM_ID = /^[a-z0-9][a-z0-9:._|-]{0,180}$/;
const CLOTHS = new Set(["cloth", "ribbon", "ink", "sage"]);
const THEMES = new Set(["light", "sepia", "dark"]);
const FONTS = new Set(["literata", "lora", "sans"]);
const WIDTHS = new Set(["narrow", "medium", "wide"]);

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return Math.min(Math.floor(value), 9_000_000_000_000);
}

function integer(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Stable identity for one book across devices. Title and author, not the local card id. */
export function bookSyncKey(book: { id: string; title: string; author: string }): string {
  const main = book.title
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .split(/\s[:\u2013\u2014-]\s|:\s/)[0] ?? book.title;
  const title = main
    .toLowerCase()
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 120);
  if (!title) {
    const id = text(book.id, 80).toLowerCase().replace(/[^a-z0-9-]/g, "") || "book";
    return `id:${id}`.slice(0, 180);
  }
  const author = book.author
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .sort()
    .join("")
    .slice(0, 80);
  return `book:${title}|${author}`;
}

export function itemKey(item: Pick<SyncItem, "kind" | "itemId">): string {
  return `${item.kind}:${item.itemId}`;
}

export function asWord(value: unknown): WordRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const lemma = text(raw.lemma, 80);
  const id = text(raw.id, 80);
  if (!lemma || !id) return null;
  const word: WordRecord = {
    id,
    surface: text(raw.surface, 80) || lemma,
    lemma,
    pos: text(raw.pos, 60),
    meaning: text(raw.meaning, 400),
    whyHard: text(raw.whyHard, 400),
    recommend: raw.recommend === true,
    sentence: text(raw.sentence, 500),
    stage: integer(raw.stage, 0, 30),
    dueAt: time(raw.dueAt),
    createdAt: time(raw.createdAt),
    reps: integer(raw.reps, 0, 1_000_000),
    lapses: integer(raw.lapses, 0, 1_000_000),
    updatedAt: time(raw.updatedAt) || time(raw.lastReviewedAt) || time(raw.createdAt),
  };
  const seen = integer(raw.seen, 0, 1_000_000, -1);
  if (seen >= 0 && raw.seen !== undefined) word.seen = seen;
  const uses = text(raw.uses, 200);
  if (uses) word.uses = uses;
  const reviewed = time(raw.lastReviewedAt);
  if (reviewed) word.lastReviewedAt = reviewed;
  return word;
}

export function asWordBlob(data: unknown): WordBlob {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const words: WordRecord[] = [];
  if (Array.isArray(raw.words)) {
    for (const entry of raw.words) {
      const word = asWord(entry);
      if (word) words.push(word);
      if (words.length >= 5000) break;
    }
  }
  const removed: WordTombstone[] = [];
  if (Array.isArray(raw.removed)) {
    for (const entry of raw.removed) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const lemma = text(row.lemma, 80);
      if (!lemma) continue;
      removed.push({ lemma, updatedAt: time(row.updatedAt) });
      if (removed.length >= 5000) break;
    }
  }
  return { words, removed };
}


function asSource(value: unknown): SourceRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const removed = time(raw.removed);
  if (removed > 0) {
    const k = text(raw.k, 120);
    return k ? { k, removed } : null;
  }
  const book = text(raw.book, 180);
  if (!book) return null;
  const ref = asGlossPoint(raw.ref);
  if (ref) {
    const source: SourceLive = {
      k: "",
      book,
      surface: text(raw.surface, 80),
      savedAt: time(raw.savedAt),
      ref,
    };
    source.k = sourceKey(source);
    if (typeof raw.chapter === "number") source.chapter = integer(raw.chapter, 0, 100_000);
    const chapterTitle = text(raw.chapterTitle, 200);
    if (chapterTitle) source.chapterTitle = chapterTitle;
    const sentence = text(raw.sentence, 500);
    if (sentence) source.sentence = sentence;
    const title = text(raw.title, 300);
    if (title) source.title = title;
    const author = text(raw.author, 200);
    if (author) source.author = author;
    const pos = text(raw.pos, 60);
    if (pos) source.pos = pos;
    const at = asAnchor(raw.at);
    if (at) source.at = at;
    return source;
  }
  const sentence = text(raw.sentence, 500);
  if (!sentence) {
    const surface = text(raw.surface, 80);
    if (!surface) return null;
    const bare: SourceLive = {
      k: "",
      book,
      surface,
      savedAt: time(raw.savedAt),
    };
    bare.k = sourceKey(bare);
    const title = text(raw.title, 300);
    if (title) bare.title = title;
    const author = text(raw.author, 200);
    if (author) bare.author = author;
    if (typeof raw.chapter === "number") bare.chapter = integer(raw.chapter, 0, 100_000);
    const chapterTitle = text(raw.chapterTitle, 200);
    if (chapterTitle) bare.chapterTitle = chapterTitle;
    const pos = text(raw.pos, 60);
    if (pos) bare.pos = pos;
    return bare;
  }
  const source: SourceLive = {
    k: sourceKey({ book, sentence }),
    book,
    title: text(raw.title, 300),
    author: text(raw.author, 200),
    sentence,
    surface: text(raw.surface, 80),
    savedAt: time(raw.savedAt),
  };
  if (typeof raw.chapter === "number") source.chapter = integer(raw.chapter, 0, 100_000);
  const chapterTitle = text(raw.chapterTitle, 200);
  if (chapterTitle) source.chapterTitle = chapterTitle;
  const meaning = text(raw.meaning, 400);
  if (meaning) source.meaning = meaning;
  const pos = text(raw.pos, 60);
  if (pos) source.pos = pos;
  const at = asAnchor(raw.at);
  if (at) source.at = at;
  return source;
}

export function asWordbookRecord(value: unknown): WordbookRecord | null {
  const base = asWord(value);
  if (!base) return null;
  const raw = value as Record<string, unknown>;
  const sources: SourceRecord[] = [];
  if (Array.isArray(raw.sources)) {
    for (const entry of raw.sources) {
      const source = asSource(entry);
      if (source) sources.push(source);
      if (sources.length >= 40) break;
    }
  }
  const record: WordbookRecord = { ...base, sources };
  const live = sources.filter(isLive);
  if (live.length > 0 && live.every((source) => source.ref)) {
    const kept = live.find((source) => source.sentence)?.sentence;
    record.sentence = kept || record.sentence;
    record.meaning = "";
    record.whyHard = "";
    delete record.uses;
  }
  return record;
}

export function asWordbookBlob(data: unknown): WordbookBlob {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const words: WordbookRecord[] = [];
  if (Array.isArray(raw.words)) {
    for (const entry of raw.words) {
      const word = asWordbookRecord(entry);
      if (word) words.push(word);
      if (words.length >= 5000) break;
    }
  }
  return { words, removed: asWordBlob({ removed: raw.removed }).removed };
}

const sourceTime = (source: SourceRecord): number => (isLive(source) ? source.savedAt : source.removed);

/** Union of source lists by key. The later of save and removal wins; a tie keeps the removal. */
export function mergeSourceRecords(...lists: ReadonlyArray<readonly SourceRecord[]>): SourceRecord[] {
  const map = new Map<string, SourceRecord>();
  for (const list of lists) {
    for (const source of list) {
      const prior = map.get(source.k);
      if (!prior) {
        map.set(source.k, source);
        continue;
      }
      const a = sourceTime(prior);
      const b = sourceTime(source);
      if (b > a || (b === a && !isLive(source))) map.set(source.k, source);
      else if (b === a && isLive(prior) && isLive(source) && detailOf(source) > detailOf(prior)) map.set(source.k, source);
    }
  }
  const all = [...map.values()];
  const newest = all.reduce((max, source) => Math.max(max, sourceTime(source)), 0);
  const live = all.filter(isLive).sort((x, y) => x.savedAt - y.savedAt || x.k.localeCompare(y.k));
  const gone = all
    .filter((source): source is SourceGone => !isLive(source) && source.removed >= newest - GONE_KEEP_MS)
    .sort((x, y) => x.k.localeCompare(y.k));
  const kept = live.length > MAX_LIVE_SOURCES ? live.slice(live.length - MAX_LIVE_SOURCES) : live;
  return [...kept, ...gone];
}

function detailOf(source: SourceLive): number {
  return (source.at ? 2 : 0) + (source.chapter !== undefined ? 1 : 0) + (source.chapterTitle ? 1 : 0);
}

/**
 * Union of two wordbook shards. The same lemma keeps the later card (schedule, meaning); a later tombstone
 * drops the word; the sources of a word are united from both sides.
 */
export function mergeWordbookBlobs(base: WordbookBlob, preferred: WordbookBlob): WordbookBlob {
  type Slot = { winner: { kind: "word"; word: WordbookRecord } | { kind: "removed"; lemma: string; updatedAt: number }; words: WordbookRecord[] };
  const map = new Map<string, Slot>();
  const consider = (entry: Slot["winner"]) => {
    const key = lemmaKey(entry.kind === "word" ? entry.word.lemma : entry.lemma);
    const slot = map.get(key) ?? { winner: entry, words: [] };
    if (entry.kind === "word") slot.words.push(entry.word);
    const at = entry.kind === "word" ? entry.word.updatedAt : entry.updatedAt;
    const prevAt = slot.winner.kind === "word" ? slot.winner.word.updatedAt : slot.winner.updatedAt;
    if (at >= prevAt) slot.winner = entry;
    map.set(key, slot);
  };
  for (const word of base.words) consider({ kind: "word", word });
  for (const row of base.removed) consider({ kind: "removed", lemma: row.lemma, updatedAt: row.updatedAt });
  for (const word of preferred.words) consider({ kind: "word", word });
  for (const row of preferred.removed) consider({ kind: "removed", lemma: row.lemma, updatedAt: row.updatedAt });
  const words: WordbookRecord[] = [];
  const removed: WordTombstone[] = [];
  for (const slot of map.values()) {
    if (slot.winner.kind === "removed") {
      removed.push({ lemma: slot.winner.lemma, updatedAt: slot.winner.updatedAt });
      continue;
    }
    const sources = mergeSourceRecords(...slot.words.map((word) => word.sources));
    words.push({ ...slot.winner.word, sources });
  }
  words.sort((a, b) => lemmaKey(a.lemma).localeCompare(lemmaKey(b.lemma)));
  removed.sort((a, b) => lemmaKey(a.lemma).localeCompare(lemmaKey(b.lemma)));
  return { words, removed };
}

function wordbookBlobTime(blob: WordbookBlob): number {
  let max = 0;
  for (const word of blob.words) max = Math.max(max, word.updatedAt);
  for (const row of blob.removed) max = Math.max(max, row.updatedAt);
  return max;
}

/**
 * Old per-book word lists (kind `words`) become part of the wordbook shards. A word from several books keeps
 * one card (the one with the later updatedAt) and a source per book. Old tombstones are not carried over: they
 * only meant "not in that book". Returns the items without any `words` item, plus the shards.
 */
export function foldLegacyWords(items: readonly SyncItem[]): SyncItem[] {
  const legacy = items.filter((item) => item.kind === "words" && !item.deleted);
  const rest = items.filter((item) => item.kind !== "words");
  if (legacy.length === 0) return rest;
  const shelf = new Map<string, ShelfData>();
  for (const item of items) {
    if (item.kind !== "shelf" || item.deleted) continue;
    const data = asShelf(item.data);
    if (data) shelf.set(item.itemId, data);
  }
  const blobs = new Map<string, WordbookBlob>();
  for (const item of legacy) {
    const home = shelf.get(item.itemId);
    for (const word of asWordBlob(item.data).words) {
      const book = item.itemId;
      const source = asSource({
        book,
        title: home?.title ?? "",
        author: home?.author ?? "",
        sentence: word.sentence,
        surface: word.surface,
        savedAt: word.createdAt,
      });
      const record: WordbookRecord = { ...word, sources: source ? [source] : [] };
      const shard = wordbookShard(word.lemma);
      const prior = blobs.get(shard) ?? { words: [], removed: [] };
      blobs.set(shard, mergeWordbookBlobs(prior, { words: [record], removed: [] }));
    }
  }
  const out: SyncItem[] = [...rest];
  for (const [shard, folded] of blobs) {
    const id = wordbookItemId(shard);
    const at = out.findIndex((item) => item.kind === "wordbook" && item.itemId === id);
    const existing = at >= 0 ? out[at] : undefined;
    const prior = existing && !existing.deleted ? asWordbookBlob(existing.data) : { words: [], removed: [] };
    const blob = mergeWordbookBlobs(folded, prior);
    const item: SyncItem = {
      kind: "wordbook",
      itemId: id,
      deleted: false,
      data: blob,
      updatedAt: Math.max(existing?.updatedAt ?? 0, wordbookBlobTime(blob)),
    };
    if (at >= 0) out[at] = item;
    else out.push(item);
  }
  return out;
}

export function asShelf(data: unknown): ShelfData | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  const title = text(raw.title, 300);
  const id = text(raw.id, 80);
  if (!title || !id) return null;
  const cloth = text(raw.cloth, 20);
  const shelf: ShelfData = {
    id,
    title,
    author: text(raw.author, 200),
    cloth: CLOTHS.has(cloth) ? (cloth as ShelfData["cloth"]) : "cloth",
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
  };
  if (raw.source === "epub" || raw.source === "notes") shelf.source = raw.source;
  const lexile = text(raw.lexile, 20);
  if (lexile) shelf.lexile = lexile;
  const isbn = text(raw.isbn, 20).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbn) shelf.isbn = isbn;
  const series = text(raw.series, 200);
  if (series) shelf.series = series;
  const seriesNumber = integer(raw.seriesNumber, 1, 999, 0);
  if (seriesNumber) shelf.seriesNumber = seriesNumber;
  const matchRate = integer(raw.matchRate, 0, 100, -1);
  if (matchRate >= 0 && raw.matchRate !== undefined) shelf.matchRate = matchRate;
  if (raw.needsEpub === true) shelf.needsEpub = true;
  if (raw.oldFashioned === true) {
    shelf.oldFashioned = true;
    const reason = text(raw.oldFashionedReason, 240);
    if (reason) shelf.oldFashionedReason = reason;
  }
  return shelf;
}

export function asProgress(data: unknown): ProgressData | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  const progress: ProgressData = {
    chapter: integer(raw.chapter, 0, 100_000),
    chapters: integer(raw.chapters, 0, 100_000),
    scroll: Math.min(1, Math.max(0, typeof raw.scroll === "number" && Number.isFinite(raw.scroll) ? raw.scroll : 0)),
    updatedAt: time(raw.updatedAt),
  };
  // Both fields are optional and independent. A save with neither, only one, or both must load.
  // An explicit empty extraId is kept so a later merge does not put an older extra back.
  const anchor = asAnchor(raw.anchor);
  if (anchor) progress.anchor = anchor;
  if (typeof raw.extraId === "string") progress.extraId = text(raw.extraId, 40);
  return progress;
}

export function asSettings(data: unknown): SettingsData {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const theme = text(raw.theme, 20);
  const font = text(raw.font, 20);
  const width = text(raw.width, 20);
  const locale = raw.locale === "zh" ? "zh" : "en";
  return {
    theme: THEMES.has(theme) ? (theme as SettingsData["theme"]) : "light",
    font: FONTS.has(font) ? (font as SettingsData["font"]) : "literata",
    size: integer(raw.size, 16, 30, 20),
    leading: typeof raw.leading === "number" && raw.leading >= 1.2 && raw.leading <= 2.4 ? raw.leading : 1.8,
    width: WIDTHS.has(width) ? (width as SettingsData["width"]) : "medium",
    column: integer(raw.column, 24, 90, 39),
    focus: raw.focus === true,
    locale,
    reviewLog: asReviewLog(raw.reviewLog),
  };
}

function asReviewLog(data: unknown): Record<string, ReviewDay> {
  if (!data || typeof data !== "object") return {};
  const out: Record<string, ReviewDay> = {};
  for (const [day, value] of Object.entries(data as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    out[day] = {
      reviewed: integer(row.reviewed, 0, 100_000),
      correct: integer(row.correct, 0, 100_000),
    };
    if (Object.keys(out).length >= 800) break;
  }
  return out;
}

export function mergeReviewLogs(
  left: Record<string, ReviewDay>,
  right: Record<string, ReviewDay>,
): Record<string, ReviewDay> {
  const days = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out: Record<string, ReviewDay> = {};
  for (const day of days) {
    const a = left[day] ?? { reviewed: 0, correct: 0 };
    const b = right[day] ?? { reviewed: 0, correct: 0 };
    out[day] = {
      reviewed: Math.max(a.reviewed, b.reviewed),
      correct: Math.max(a.correct, b.correct),
    };
  }
  return out;
}

export function lemmaKey(lemma: string): string {
  return lemma.toLowerCase();
}

/** Union of two word books. The same lemma keeps the later updatedAt. A later tombstone drops the word. */
export function mergeWordBlobs(base: WordBlob, preferred: WordBlob): WordBlob {
  type Entry =
    | { kind: "word"; word: WordRecord }
    | { kind: "removed"; lemma: string; updatedAt: number };
  const map = new Map<string, Entry>();
  const consider = (entry: Entry) => {
    const key = lemmaKey(entry.kind === "word" ? entry.word.lemma : entry.lemma);
    const at = entry.kind === "word" ? entry.word.updatedAt : entry.updatedAt;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, entry);
      return;
    }
    const prevAt = prev.kind === "word" ? prev.word.updatedAt : prev.updatedAt;
    if (at >= prevAt) map.set(key, entry);
  };
  for (const word of base.words) consider({ kind: "word", word });
  for (const row of base.removed) consider({ kind: "removed", lemma: row.lemma, updatedAt: row.updatedAt });
  for (const word of preferred.words) consider({ kind: "word", word });
  for (const row of preferred.removed) consider({ kind: "removed", lemma: row.lemma, updatedAt: row.updatedAt });
  const words: WordRecord[] = [];
  const removed: WordTombstone[] = [];
  for (const entry of map.values()) {
    if (entry.kind === "word") words.push(entry.word);
    else removed.push({ lemma: entry.lemma, updatedAt: entry.updatedAt });
  }
  words.sort((a, b) => lemmaKey(a.lemma).localeCompare(lemmaKey(b.lemma)));
  removed.sort((a, b) => lemmaKey(a.lemma).localeCompare(lemmaKey(b.lemma)));
  return { words, removed };
}

function wordBlobTime(blob: WordBlob): number {
  let max = 0;
  for (const word of blob.words) max = Math.max(max, word.updatedAt);
  for (const row of blob.removed) max = Math.max(max, row.updatedAt);
  return max;
}

/**
 * The newer progress wins for chapter, scroll and updatedAt. A field the newer record actually stored
 * (`anchor`, or `extraId` including "") is kept. A field it never stored is kept from the older record,
 * so merging a save that only knew about one of the two fields does not drop the other. The older record
 * is used alone only when the newer data is not progress at all.
 */
function mergeProgress(winner: unknown, other: unknown): ProgressData | null {
  const primary = asProgress(winner);
  if (!primary) return asProgress(other);
  const secondary = asProgress(other);
  if (!secondary) return primary;
  const raw = winner && typeof winner === "object" ? (winner as Record<string, unknown>) : {};
  if (!("anchor" in raw) && secondary.anchor) primary.anchor = secondary.anchor;
  if (!("extraId" in raw) && secondary.extraId) primary.extraId = secondary.extraId;
  return primary;
}

/**
 * Merge one item. `preferred` wins when updatedAt is equal.
 * Word books union. Settings keep the newer preferences and the higher review counts.
 * Progress keeps both optional fields (`anchor`, `extraId`) when the winning record has them.
 */
export function mergeItem(base: SyncItem | undefined, preferred: SyncItem | undefined): SyncItem | undefined {
  if (!base) return preferred ? cloneItem(preferred) : undefined;
  if (!preferred) return cloneItem(base);
  if (base.kind !== preferred.kind || base.itemId !== preferred.itemId) return cloneItem(preferred);

  if (!base.deleted && !preferred.deleted && base.kind === "words") {
    const blob = mergeWordBlobs(asWordBlob(base.data), asWordBlob(preferred.data));
    return {
      kind: "words",
      itemId: base.itemId,
      deleted: false,
      data: blob,
      updatedAt: Math.max(base.updatedAt, preferred.updatedAt, wordBlobTime(blob)),
    };
  }

  if (!base.deleted && !preferred.deleted && base.kind === "wordbook") {
    const blob = mergeWordbookBlobs(asWordbookBlob(base.data), asWordbookBlob(preferred.data));
    return {
      kind: "wordbook",
      itemId: base.itemId,
      deleted: false,
      data: blob,
      updatedAt: Math.max(base.updatedAt, preferred.updatedAt, wordbookBlobTime(blob)),
    };
  }

  if (!base.deleted && !preferred.deleted && base.kind === "progress") {
    const winner = preferred.updatedAt >= base.updatedAt ? preferred : base;
    const other = winner === preferred ? base : preferred;
    const data = mergeProgress(winner.data, other.data);
    if (!data) return cloneItem(winner);
    return {
      kind: "progress",
      itemId: winner.itemId,
      deleted: false,
      updatedAt: winner.updatedAt,
      data,
    };
  }

  if (!base.deleted && !preferred.deleted && base.kind === "settings") {
    const winner = preferred.updatedAt >= base.updatedAt ? preferred : base;
    const left = asSettings(base.data);
    const right = asSettings(preferred.data);
    const prefs = asSettings(winner.data);
    return {
      kind: "settings",
      itemId: "main",
      deleted: false,
      updatedAt: Math.max(base.updatedAt, preferred.updatedAt),
      data: { ...prefs, reviewLog: mergeReviewLogs(left.reviewLog, right.reviewLog) },
    };
  }

  return cloneItem(preferred.updatedAt >= base.updatedAt ? preferred : base);
}

function cloneItem(item: SyncItem): SyncItem {
  return {
    kind: item.kind,
    itemId: item.itemId,
    updatedAt: item.updatedAt,
    deleted: item.deleted,
    data: item.data,
  };
}

/** Union of two snapshots. An item that exists on only one side is kept. */
export function mergeSnapshots(base: readonly SyncItem[], preferred: readonly SyncItem[]): SyncItem[] {
  const map = new Map<string, { base?: SyncItem; preferred?: SyncItem }>();
  for (const item of base) {
    const key = itemKey(item);
    map.set(key, { ...(map.get(key) ?? {}), base: item });
  }
  for (const item of preferred) {
    const key = itemKey(item);
    map.set(key, { ...(map.get(key) ?? {}), preferred: item });
  }
  const out: SyncItem[] = [];
  for (const slot of map.values()) {
    const merged = mergeItem(slot.base, slot.preferred);
    if (merged) out.push(merged);
  }
  out.sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  return out;
}

/** Drop a payload that is not a sync item. Used at the API boundary. */
export function normalizeItem(input: unknown, now = Date.now()): SyncItem | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== "shelf" && kind !== "progress" && kind !== "words" && kind !== "wordbook" && kind !== "settings") return null;
  const itemId = typeof raw.itemId === "string" ? raw.itemId : "";
  if (!ITEM_ID.test(itemId)) return null;
  if (kind === "settings" && itemId !== "main") return null;
  if (kind === "wordbook" && !/^w-(?:[a-z]|0)$/.test(itemId)) return null;
  let updatedAt = time(raw.updatedAt);
  if (updatedAt > now + 5 * 60_000) updatedAt = now;
  const deleted = raw.deleted === true;
  let data: unknown = {};
  if (!deleted) {
    if (kind === "shelf") {
      const shelf = asShelf(raw.data);
      if (!shelf) return null;
      data = shelf;
    } else if (kind === "progress") {
      const progress = asProgress(raw.data);
      if (!progress) return null;
      data = progress;
    } else if (kind === "words") {
      data = asWordBlob(raw.data);
    } else if (kind === "wordbook") {
      data = asWordbookBlob(raw.data);
    } else {
      data = asSettings(raw.data);
    }
  }
  return { kind, itemId, updatedAt, deleted, data };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameSyncItem(a: SyncItem, b: SyncItem): boolean {
  return a.kind === b.kind && a.itemId === b.itemId && a.deleted === b.deleted && stableJson(a.data) === stableJson(b.data);
}
