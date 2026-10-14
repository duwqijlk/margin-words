/**
 * Which books an admin is turning into a glossary right now.
 * The file is word-lists/glossary-work.json. It is not part of catalog.json.
 */

export const GLOSSARY_WORK_KEY = "word-lists/glossary-work.json";
export const GLOSSARY_WORK_LIMIT = 400;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SINCE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type GlossaryWorkKind = "lists" | "public";

export type GlossaryWorkItem = {
  kind: GlossaryWorkKind;
  id: string;
  /** When the book was marked in progress. An ISO instant. */
  since: string;
};

export type GlossaryWorkFile = {
  format: 1;
  updated: string;
  items: GlossaryWorkItem[];
};

export function workKey(item: Pick<GlossaryWorkItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

/** Keep a saved in-progress list, or refuse it. An empty list is allowed. */
export function normalizeGlossaryWork(value: unknown): { ok: true; items: GlossaryWorkItem[] } | { ok: false } {
  if (!value || typeof value !== "object") return { ok: false };
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length > GLOSSARY_WORK_LIMIT) return { ok: false };
  const out: GlossaryWorkItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") return { ok: false };
    const row = item as { kind?: unknown; id?: unknown; since?: unknown };
    if (row.kind !== "lists" && row.kind !== "public") return { ok: false };
    if (typeof row.id !== "string" || !ID_PATTERN.test(row.id)) return { ok: false };
    if (typeof row.since !== "string" || !SINCE.test(row.since.trim())) return { ok: false };
    const key = workKey({ kind: row.kind, id: row.id });
    if (seen.has(key)) return { ok: false };
    seen.add(key);
    out.push({ kind: row.kind, id: row.id, since: row.since.trim() });
  }
  return { ok: true, items: out };
}

export function readWorkToggle(value: unknown): { kind: GlossaryWorkKind; id: string; making: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { kind?: unknown; id?: unknown; making?: unknown };
  if (row.kind !== "lists" && row.kind !== "public") return null;
  if (typeof row.id !== "string" || !ID_PATTERN.test(row.id)) return null;
  if (typeof row.making !== "boolean") return null;
  return { kind: row.kind, id: row.id, making: row.making };
}

/**
 * Mark a book, or clear it. Marking a book that is already marked keeps the
 * original time. `null` means the change is refused (a bad id, or the list is full).
 */
export function applyGlossaryWork(
  items: readonly GlossaryWorkItem[],
  kind: GlossaryWorkKind,
  id: string,
  making: boolean,
  now: string,
): GlossaryWorkItem[] | null {
  if (!ID_PATTERN.test(id) || !SINCE.test(now)) return null;
  const key = workKey({ kind, id });
  const existing = items.find((item) => workKey(item) === key);
  if (!making) return items.filter((item) => workKey(item) !== key);
  if (existing) return [...items];
  if (items.length >= GLOSSARY_WORK_LIMIT) return null;
  return [...items, { kind, id, since: now }];
}

export function glossaryWorkFile(items: readonly GlossaryWorkItem[], updated: string): GlossaryWorkFile {
  return { format: 1, updated, items: [...items] };
}
