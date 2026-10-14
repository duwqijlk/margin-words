/**
 * Load the QQ groups for the overview popup.
 * A missing file uses the built-in number. A saved list, even an empty one, is what we show.
 */
import { DEFAULT_QQ_GROUPS, normalizeQqGroups } from "@/lib/qq-groups";

export type QqGroupsState = { saved: boolean; groups: string[] };

export async function loadQqGroups(): Promise<QqGroupsState> {
  try {
    const response = await fetch("/api/qq-groups", { cache: "no-store" });
    if (!response.ok) return { saved: false, groups: [...DEFAULT_QQ_GROUPS] };
    const body = (await response.json()) as { saved?: unknown; groups?: unknown };
    if (body.saved !== true) return { saved: false, groups: [...DEFAULT_QQ_GROUPS] };
    const parsed = normalizeQqGroups(body);
    return parsed.ok ? { saved: true, groups: parsed.groups } : { saved: false, groups: [...DEFAULT_QQ_GROUPS] };
  } catch {
    return { saved: false, groups: [...DEFAULT_QQ_GROUPS] };
  }
}
