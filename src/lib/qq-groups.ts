/**
 * QQ group numbers shown from the overview. The saved file is
 * word-lists/qq-groups.json. It is not part of a book catalog.
 * Until an admin saves, the overview shows DEFAULT_QQ_GROUPS.
 */

export const QQ_GROUPS_KEY = "word-lists/qq-groups.json";
export const QQ_GROUP_LIMIT = 12;
export const DEFAULT_QQ_GROUPS = ["656911882"] as const;

const NUMBER = /^\d{5,12}$/;

export type QqGroupsFile = {
  format: 1;
  updated: string;
  groups: string[];
};

/** Keep a saved number list, or refuse it. An empty list is allowed. */
export function normalizeQqGroups(value: unknown): { ok: true; groups: string[] } | { ok: false } {
  if (!value || typeof value !== "object") return { ok: false };
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups) || groups.length > QQ_GROUP_LIMIT) return { ok: false };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of groups) {
    if (typeof item !== "string" || !NUMBER.test(item) || seen.has(item)) return { ok: false };
    seen.add(item);
    out.push(item);
  }
  return { ok: true, groups: out };
}

export function qqGroupsFile(groups: readonly string[], updated: string): QqGroupsFile {
  return { format: 1, updated, groups: [...groups] };
}
