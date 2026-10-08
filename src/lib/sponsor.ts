/**
 * Public-interest sponsorships. The reader picks a way to give. The admin types the
 * USD amount and ticks the row, and only then does the name appear on the overview.
 * Names are not invented here.
 */

import { cleanNickname } from "./nickname.ts";

/** The only address that sends sponsorship instructions. Shown in the dialog. */
export const SPONSOR_EMAIL = "xcrunnnn@outlook.com";

export const SPONSOR_METHODS = ["wechat", "alipay", "crypto"] as const;
export type SponsorMethod = (typeof SPONSOR_METHODS)[number];

const SHANGHAI_MS = 8 * 60 * 60 * 1000;
const MAX_CENTS = 100_000_000;

export function isSponsorAdmin(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SPONSOR_EMAIL;
}

export function isSponsorMethod(value: unknown): value is SponsorMethod {
  return value === "wechat" || value === "alipay" || value === "crypto";
}

/** A display name for the thank-you list, or null when the text cannot be shown. */
export function sponsorName(value: unknown): string | null {
  return cleanNickname(value);
}

/**
 * USD typed by the admin, as integer cents. Accepts "10" and "10.50".
 * Zero, extra decimals, and amounts over 1,000,000 dollars are refused.
 */
export function parseUsdToCents(value: unknown): number | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** "10" or "10.50". Thousands are grouped. */
export function formatSponsorUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) return "0";
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  const grouped = whole.toLocaleString("en-US");
  return frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, "0")}`;
}

/** Calendar month in China (UTC+8, no daylight saving), "YYYY-MM". */
export function shanghaiMonthKey(ms: number): string {
  const shifted = new Date(ms + SHANGHAI_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}`;
}

/** Calendar day in China, "YYYY-MM-DD". */
export function formatShanghaiDate(ms: number): string {
  const shifted = new Date(ms + SHANGHAI_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

export type ListedGift = {
  userId: string;
  name: string;
  cents: number;
  listedAt: number;
};

export type SponsorLine = {
  name: string;
  cents: number;
};

/**
 * One line per person. This month sums gifts confirmed in the current China month.
 * History sums every confirmed gift. The name is the one on the latest gift.
 */
export function sponsorBoards(
  gifts: readonly ListedGift[],
  now: number,
): { month: SponsorLine[]; total: SponsorLine[] } {
  const monthKey = shanghaiMonthKey(now);
  const byUser = new Map<string, { name: string; nameAt: number; month: number; total: number }>();
  for (const gift of gifts) {
    if (!gift.userId || !gift.name) continue;
    if (!Number.isSafeInteger(gift.cents) || gift.cents <= 0) continue;
    if (!Number.isFinite(gift.listedAt)) continue;
    const row = byUser.get(gift.userId) ?? { name: gift.name, nameAt: gift.listedAt, month: 0, total: 0 };
    row.total += gift.cents;
    if (shanghaiMonthKey(gift.listedAt) === monthKey) row.month += gift.cents;
    if (gift.listedAt >= row.nameAt) {
      row.name = gift.name;
      row.nameAt = gift.listedAt;
    }
    byUser.set(gift.userId, row);
  }
  const rows = [...byUser.values()];
  const byAmount = (amount: (row: (typeof rows)[number]) => number) =>
    rows
      .filter((row) => amount(row) > 0)
      .sort((a, b) => amount(b) - amount(a) || a.name.localeCompare(b.name))
      .map((row) => ({ name: row.name, cents: amount(row) }));
  return { month: byAmount((row) => row.month), total: byAmount((row) => row.total) };
}

/** Lines from the public sponsorship response. Drops anything that is not a name plus cents. */
export function readSponsorLines(value: unknown): SponsorLine[] {
  if (!Array.isArray(value)) return [];
  const out: SponsorLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = (item as { name?: unknown }).name;
    const cents = (item as { cents?: unknown }).cents;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) continue;
    out.push({ name, cents });
  }
  return out;
}
