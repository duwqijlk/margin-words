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

/** Distinct word lists a plain reader may open in one rolling week. */
export const GLOSSARY_WEEK_BOOKS = 5;
export const GLOSSARY_WEEK_MS = 7 * DAY_MS;
