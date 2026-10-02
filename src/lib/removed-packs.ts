/**
 * The "removed" flag for book packs. Deleting a book that came from a pack writes its pack id here, so the
 * app never installs that pack again by itself (see classics.ts). Downloading it by hand clears the flag.
 */
import { loadPackRecord } from "@/lib/book-db";

const REMOVED_KEY = "cibian-removed-packs-v1";

export function readRemoved(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REMOVED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeRemoved(ids: string[]) {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Blocked storage: the book may come back after a restart.
  }
}

export const wasRemoved = (packId: string): boolean => readRemoved().includes(packId);

export function clearPackRemoved(packId: string): void {
  const now = readRemoved();
  if (now.includes(packId)) writeRemoved(now.filter((id) => id !== packId));
}

/** Call BEFORE the book is deleted: the pack record is still there to say which pack it was. */
export async function markPackRemoved(bookId: string): Promise<void> {
  const record = await loadPackRecord(bookId);
  if (record) writeRemoved([...readRemoved(), record.packId]);
}

