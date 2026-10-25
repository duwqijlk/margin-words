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
  date.setUTCMonth(date.getUTCMonth() + months);
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

export type GlossaryWeek = { novels: number; speeches: number };

/** How many distinct novels and speeches this reader opened in the current week. */
export async function glossaryWeekUsed(
  db: CountDb,
  userId: string,
  now: number,
  speeches: ReadonlySet<string>,
): Promise<GlossaryWeek> {
  const since = now - GLOSSARY_WEEK_MS;
  const recent = await db
    .prepare("SELECT DISTINCT book_id FROM glossary_reads WHERE user_id = ? AND created_at > ?")
    .bind(userId, since)
    .all<{ book_id: string }>();
  const week = { novels: 0, speeches: 0 };
  for (const row of recent.results ?? []) {
    if (speeches.has(row.book_id)) week.speeches += 1;
    else week.novels += 1;
  }
  return week;
}
