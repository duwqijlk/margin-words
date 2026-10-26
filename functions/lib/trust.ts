/** Length of a trusted-reader grant. "forever" stores no end time. */
export const TRUST_TERMS = ["week", "month", "quarter", "year", "forever"] as const;
export type TrustTerm = (typeof TRUST_TERMS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTrustTerm(value: unknown): value is TrustTerm {
  return typeof value === "string" && (TRUST_TERMS as readonly string[]).includes(value);
}

/**
 * When this grant ends, or null when it does not end.
 * A week is 7 days. A month, quarter, and year step the calendar in UTC.
 */
export function trustedUntil(term: TrustTerm, now: number): number | null {
  if (term === "forever") return null;
  if (term === "week") return now + 7 * DAY_MS;
  const date = new Date(now);
  const months = term === "month" ? 1 : term === "quarter" ? 3 : 12;
  const day = date.getUTCDate();
  // Step to the 1st, add the months, then take the same day or the last day of that month:
  // Jan 31 + 1 month is Feb 28 (or 29), not Mar 3; Feb 29 + 1 year is Feb 28.
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

/** Distinct new novels a plain reader may open in one rolling week. */
export const GLOSSARY_WEEK_BOOKS = 7;
/** Distinct new speeches, counted apart from novels. */
export const GLOSSARY_WEEK_SPEECHES = 7;
export const GLOSSARY_WEEK_MS = 7 * DAY_MS;

type CountDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
  };
};

/** Places used in the rolling week, and when the oldest one comes back (0 when none is used). */
export type WeekCount = { used: number; resetAt: number };
export type GlossaryWeek = { novels: WeekCount; speeches: WeekCount };

/** How many distinct novels and speeches this reader opened in the current week. */
export async function glossaryWeekUsed(
  db: CountDb,
  userId: string,
  now: number,
  speeches: ReadonlySet<string>,
): Promise<GlossaryWeek> {
  const since = now - GLOSSARY_WEEK_MS;
  const recent = await db
    .prepare(
      "SELECT book_id, MIN(created_at) AS at FROM glossary_reads WHERE user_id = ? AND created_at > ? GROUP BY book_id",
    )
    .bind(userId, since)
    .all<{ book_id: string; at: number }>();
  const week: GlossaryWeek = { novels: { used: 0, resetAt: 0 }, speeches: { used: 0, resetAt: 0 } };
  for (const row of recent.results ?? []) {
    const count = speeches.has(row.book_id) ? week.speeches : week.novels;
    count.used += 1;
    // A place comes back 7 days after that book was first opened. The oldest one comes back first.
    const back = Number(row.at) + GLOSSARY_WEEK_MS;
    if (!count.resetAt || back < count.resetAt) count.resetAt = back;
  }
  return week;
}
