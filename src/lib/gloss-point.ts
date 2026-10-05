/**
 * A saved word points at one place in a word list. The list already holds the short
 * original snippet and the meaning. The account stores this pointer, not text copied
 * from the reader's own e-book.
 */

export type GlossPoint = {
  /** Catalog id of the word list, or "custom" for a list that exists only on this device. */
  list: string;
  /** 0-based chapter on the anchor, when the list still has chapter numbers. */
  chapter?: number;
  /** 1-based occurrence on the anchor. */
  occurrence?: number;
  /** Word form on the anchor, only when it is not the lemma. */
  form?: string;
  /** The save is a phrase entry, not a single word. */
  phrase?: boolean;
  /** 8 hex digits: hash of the anchor's own context, so a list without chapter numbers still matches. */
  mark?: string;
};

const LIST_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A published list id, or "custom" when this device's list is not one we can fetch. */
export function catalogListId(bundled: string | undefined): string {
  const id = (bundled ?? "").trim();
  if (id === "custom") return "custom";
  return LIST_ID.test(id) ? id : "custom";
}

/** Cache key for one list. A custom list is per book, so two edited lists do not share a file. */
export function glossCacheKey(ref: GlossPoint, book: string): string {
  return ref.list === "custom" ? `custom:${book}` : ref.list;
}

/**
 * Cache key for the word list of one shelf book, used when a saved word has no pointer yet.
 * The book sync key is the same on every device, so the notebook can find the file from the source alone.
 */
export function bookGlossKey(book: string): string {
  return `book:${book}`;
}

export function asGlossPoint(value: unknown): GlossPoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const list = typeof raw.list === "string" ? raw.list.trim() : "";
  if (list !== "custom" && !LIST_ID.test(list)) return null;
  const point: GlossPoint = { list };
  if (raw.phrase === true) point.phrase = true;
  if (typeof raw.chapter === "number" && Number.isFinite(raw.chapter)) {
    point.chapter = Math.min(100_000, Math.max(0, Math.floor(raw.chapter)));
  }
  if (typeof raw.occurrence === "number" && Number.isFinite(raw.occurrence) && raw.occurrence >= 1) {
    point.occurrence = Math.min(1_000_000, Math.floor(raw.occurrence));
  }
  if (typeof raw.form === "string") {
    const form = raw.form.replace(/\s+/g, " ").trim().slice(0, 48);
    if (form) point.form = form;
  }
  if (typeof raw.mark === "string" && /^[0-9a-f]{8}$/.test(raw.mark)) point.mark = raw.mark;
  return point;
}
