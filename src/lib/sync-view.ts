/**
 * What this device knows the server holds, so a pull can ask only for what changed.
 *
 * The old sync read the whole account on every pull (every start, focus and edit). A large word
 * book is several hundred KB per shard, and parsing all of it in one Function call ran past the
 * Free plan's 10ms of CPU. Now the device keeps the server's cursor and one short signature per
 * item, pulls `GET /api/sync?after=<cursor>`, and uploads an item only when it differs from the
 * signature the server last returned for it. A full pull still runs on the first sync of an account
 * on this device, once a day, and whenever this record is missing or belongs to another email.
 *
 * Pure functions: the engine (sync-engine.ts) stores the record in localStorage.
 */
import { itemKey, stableJson, type SyncItem } from "./sync-merge.ts";

export const SYNC_VIEW_KEY = "cibian-sync-server-v1";
/** A full pull at least this often, so a signature that drifted for any reason is corrected. */
export const FULL_PULL_MS = 24 * 60 * 60_000;

export type SyncView = {
  /** The account this record describes. Another account starts over. */
  email: string;
  /** The server's cursor from the last pull (its clock, ms). */
  cursor: number;
  /** When the last full pull ran (this device's clock, ms). */
  fullAt: number;
  /** itemKey -> signature of the item as the server holds it. */
  sigs: Record<string, string>;
};

/** 53-bit string hash (cyrb53). Used to compare, never to protect anything. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The parts of an item that decide whether it must be uploaded: the same parts sameSyncItem
 * compares (deleted and data, not the time), plus the length, so a collision also needs equal size.
 */
export function signatureOf(item: SyncItem): string {
  const data = item.deleted ? "" : stableJson(item.data);
  return `${item.deleted ? "d" : "l"}${data.length.toString(36)}.${hash53(data)}`;
}

export function readView(raw: string | null, email: string | null): SyncView | null {
  if (!raw || !email) return null;
  try {
    const value = JSON.parse(raw) as Partial<SyncView>;
    if (
      !value ||
      value.email !== email ||
      typeof value.cursor !== "number" ||
      !Number.isFinite(value.cursor) ||
      typeof value.fullAt !== "number" ||
      !value.sigs ||
      typeof value.sigs !== "object"
    )
      return null;
    const sigs: Record<string, string> = {};
    for (const [key, sig] of Object.entries(value.sigs)) if (typeof sig === "string") sigs[key] = sig;
    return { email, cursor: value.cursor, fullAt: value.fullAt, sigs };
  } catch {
    return null;
  }
}

/** The pull to make: everything (null) or only what the server wrote after the cursor. */
export function pullAfter(view: SyncView | null, email: string | null, now: number): number | null {
  if (!view || !email || view.email !== email) return null;
  if (now - view.fullAt >= FULL_PULL_MS || now < view.fullAt) return null;
  return view.cursor;
}

/**
 * The record after a pull. `cursor` is what the server sent; a server without cursors (an older
 * deploy) sends none, and then there is no record and the next pull is a full one again.
 */
export function afterPull(
  view: SyncView | null,
  email: string,
  items: readonly SyncItem[],
  cursor: unknown,
  full: boolean,
  now: number,
): SyncView | null {
  if (typeof cursor !== "number" || !Number.isFinite(cursor)) return null;
  const sigs: Record<string, string> = full || !view || view.email !== email ? {} : { ...view.sigs };
  for (const item of items) sigs[itemKey(item)] = signatureOf(item);
  return {
    email,
    cursor,
    fullAt: full || !view || view.email !== email ? now : view.fullAt,
    sigs,
  };
}

/** The record after a push: the server answered with each item as it now holds it. */
export function afterPush(view: SyncView | null, saved: readonly SyncItem[]): SyncView | null {
  if (!view) return null;
  const sigs = { ...view.sigs };
  for (const item of saved) sigs[itemKey(item)] = signatureOf(item);
  return { ...view, sigs };
}

/** True when the server does not already hold this exact item. */
export function needsUpload(view: SyncView, item: SyncItem): boolean {
  return view.sigs[itemKey(item)] !== signatureOf(item);
}
