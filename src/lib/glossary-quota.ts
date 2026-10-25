/**
 * The reader's weekly word-list places, from /api/auth/me. Novels and speeches are counted apart.
 * Discover shows what is left; the account dialog shows the same numbers.
 */
import { create } from "zustand";
import type { ContentCategory } from "@/lib/content-category";
import { useLocale } from "@/lib/i18n";
import { accountRequest } from "@/lib/sync-engine";

/** used of limit; resetAt is when the oldest used place comes back (0 when none is used). */
export type QuotaCount = { used: number; limit: number; resetAt: number };
export type GlossaryQuota = { novel: QuotaCount; speech: QuotaCount | null; unlimited: boolean };

function readCount(value: unknown): QuotaCount | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { used?: unknown; limit?: unknown; resetAt?: unknown };
  const used = typeof row.used === "number" && Number.isFinite(row.used) ? Math.max(0, row.used) : 0;
  const limit = typeof row.limit === "number" && row.limit > 0 ? row.limit : 0;
  const resetAt = typeof row.resetAt === "number" && Number.isFinite(row.resetAt) ? row.resetAt : 0;
  return limit > 0 ? { used, limit, resetAt } : null;
}

/** The quota in a /api/auth/me answer. Null when signed out or when the server sends none. */
export function readGlossaryQuota(payload: Record<string, unknown>): GlossaryQuota | null {
  const glossary = payload.glossary;
  if (!glossary || typeof glossary !== "object") return null;
  const row = glossary as { unlimited?: unknown; speech?: unknown };
  const unlimited = row.unlimited === true;
  const novel = readCount(glossary);
  if (!unlimited && !novel) return null;
  return { novel: novel ?? { used: 0, limit: 0, resetAt: 0 }, speech: readCount(row.speech), unlimited };
}

/** The count for one kind of book, or null when it has no weekly limit. */
export function quotaFor(quota: GlossaryQuota | null, category: ContentCategory): QuotaCount | null {
  if (!quota || quota.unlimited) return null;
  return category === "speech" ? quota.speech : quota.novel;
}

export function placesLeft(count: QuotaCount): number {
  return Math.max(0, count.limit - count.used);
}

/** A short day, like "Oct 28", in the language chosen now. */
export function dayLabel(time: number): string {
  return new Date(time).toLocaleDateString(useLocale.getState().locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

type QuotaState = { quota: GlossaryQuota | null; refresh: () => Promise<void> };

let asked = 0;

export const useGlossaryQuota = create<QuotaState>()((set) => ({
  quota: null,
  refresh: async () => {
    const ticket = ++asked;
    try {
      const quota = readGlossaryQuota(await accountRequest("/api/auth/me"));
      if (ticket === asked) set({ quota });
    } catch {
      // Offline or signed out: keep what we had. The server still checks every open.
    }
  },
}));
