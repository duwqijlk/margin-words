/**
 * Pure merge for account sync. No DOM, no zustand, no network.
 *
 * An item is one bookshelf card, one book's reading progress, one book's saved
 * words, or the single settings blob. Last-write-wins is per item. Saved words
 * inside a book are still unioned by lemma, so two devices can each add a word
 * without wiping the other. The second argument wins when updatedAt ties.
 */

export const SYNC_KINDS = ["shelf", "progress", "words", "settings"] as const;
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
  /** Set while the open page is an extra spine file. */
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
  const extraId = text(raw.extraId, 40);
  if (extraId) progress.extraId = extraId;
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

function lemmaKey(lemma: string): string {
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
 * Merge one item. `preferred` wins when updatedAt is equal.
 * Word books union. Settings keep the newer preferences and the higher review counts.
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
  if (kind !== "shelf" && kind !== "progress" && kind !== "words" && kind !== "settings") return null;
  const itemId = typeof raw.itemId === "string" ? raw.itemId : "";
  if (!ITEM_ID.test(itemId)) return null;
  if (kind === "settings" && itemId !== "main") return null;
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
