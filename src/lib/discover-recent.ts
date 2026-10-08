/**
 * Which Discover cards belong in the "updated recently" row.
 * The main list stays in its own order. A day-only catalog value is that calendar
 * day in the reader's time zone. An instant uses its real time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many local calendar days, including today, count as recent. */
export const RECENT_UPDATE_DAYS = 7;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function realDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const stamp = new Date(year, month - 1, day);
  return stamp.getFullYear() === year && stamp.getMonth() === month - 1 && stamp.getDate() === day;
}

/** Start of the local calendar day `days - 1` before `now`, so the window is `days` days long. */
export function recentWindowStart(now: Date, days = RECENT_UPDATE_DAYS): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

/**
 * When this catalog time happened, for sorting. A bare day is local midnight.
 * An unreadable value is null and stays out of the row.
 */
export function updateInstant(updated: string): number | null {
  const day = DAY.exec(updated);
  if (day) {
    const year = Number(day[1]);
    const month = Number(day[2]);
    const date = Number(day[3]);
    if (!realDay(year, month, date)) return null;
    return new Date(year, month - 1, date).getTime();
  }
  if (!INSTANT.test(updated)) return null;
  const when = new Date(updated);
  if (Number.isNaN(when.getTime())) return null;
  return when.getTime();
}

/** True when the update falls inside the recent window and is not after `now`. */
export function isRecentUpdate(updated: string, now: Date, days = RECENT_UPDATE_DAYS): boolean {
  const at = updateInstant(updated);
  if (at == null) return false;
  return at >= recentWindowStart(now, days) && at <= now.getTime();
}

/** Newest first. Same time keeps title order. Books with no usable time are left out. */
export function recentUpdates<T extends { updated: string; title: string }>(
  rows: readonly T[],
  now: Date,
  days = RECENT_UPDATE_DAYS,
): T[] {
  return rows
    .filter((row) => isRecentUpdate(row.updated, now, days))
    .sort((a, b) => {
      const at = updateInstant(b.updated)! - updateInstant(a.updated)!;
      return at || a.title.localeCompare(b.title);
    });
}
