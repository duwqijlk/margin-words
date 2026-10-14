/**
 * The "updated" line on a Discover card.
 * A catalog may store a day (`YYYY-MM-DD`) or an instant (`2026-10-07T01:17:00Z`,
 * or the same shape with an offset). A day stays that calendar day. An instant is
 * shown in the reader's own time zone, down to the minute.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type ListUpdated =
  | { year: string; month: number; day: number }
  | { year: string; month: number; day: number; hour: string; minute: string };

/** Keep a catalog `updated` value the reader can show. Anything else becomes "". */
export function readUpdated(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim().slice(0, 40);
  if (DAY.test(text) || INSTANT.test(text)) return text;
  return "";
}

function realDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const stamp = new Date(Date.UTC(year, month - 1, day));
  return stamp.getUTCFullYear() === year && stamp.getUTCMonth() === month - 1 && stamp.getUTCDate() === day;
}

/** Parts for the Discover line. `hour` and `minute` are set only when the catalog stored a clock time. */
export function listUpdatedParts(updated: string): ListUpdated | null {
  const day = DAY.exec(updated);
  if (day) {
    const year = Number(day[1]);
    const month = Number(day[2]);
    const date = Number(day[3]);
    if (!realDay(year, month, date)) return null;
    return { year: day[1], month, day: date };
  }
  if (!INSTANT.test(updated)) return null;
  const when = new Date(updated);
  if (Number.isNaN(when.getTime())) return null;
  const year = when.getFullYear();
  const month = when.getMonth() + 1;
  const date = when.getDate();
  if (!realDay(year, month, date)) return null;
  return {
    year: String(year),
    month,
    day: date,
    hour: String(when.getHours()).padStart(2, "0"),
    minute: String(when.getMinutes()).padStart(2, "0"),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Order two stamps. A missing stamp stays last in either direction, so books
 * with no time stay in one group at the bottom.
 */
export function compareListStamps(left: string, right: string, dir: "asc" | "desc"): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return dir === "desc" ? right.localeCompare(left) : left.localeCompare(right);
}

/** `YYYY-MM-DD`, or `YYYY-MM-DD HH:mm` when the catalog stored a clock time. Digits only. */
export function listUpdatedStamp(updated: string): string {
  const parts = listUpdatedParts(updated);
  if (!parts) return "";
  const day = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  if (!("hour" in parts)) return day;
  return `${day} ${parts.hour}:${parts.minute}`;
}
