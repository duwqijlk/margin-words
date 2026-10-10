/**
 * Add or replace one word-list row on top of the catalog that is already on
 * the books host. Other rows, including their glossary hashes, stay untouched:
 * a later upload must not point Discover at files that were not uploaded.
 * Ported from scripts/lib/publish-word-list.mjs so the admin endpoint and the
 * CLI enforce the same invariants.
 */

function glossHash(row: unknown): string {
  const value = (row as { glossary?: { sha256?: unknown } } | null)?.glossary?.sha256;
  return typeof value === "string" ? value : "";
}

export type CatalogRow = Record<string, unknown> & { id: string };

export type WordListCatalog = {
  format?: number;
  name?: string;
  updated: string;
  lists: CatalogRow[];
};

export function assertWordListPublish(before: WordListCatalog, after: WordListCatalog, id: string): void {
  const prior = before?.lists ?? [];
  const next = after?.lists ?? [];
  const seen = new Set<string>();
  for (const row of next) {
    if (!row || typeof row.id !== "string" || seen.has(row.id)) {
      throw new Error("word-list catalog has a missing or repeated id");
    }
    seen.add(row.id);
  }
  if (!seen.has(id)) throw new Error(`publish is missing ${id}`);
  for (const row of prior) {
    if (!seen.has(row.id)) throw new Error(`refusing to drop ${row.id}`);
    if (row.id === id) continue;
    const kept = next.find((item) => item.id === row.id);
    if (glossHash(kept) !== glossHash(row)) {
      throw new Error(`refusing to change the glossary hash of ${row.id}`);
    }
  }
}

export function mergeWordListCatalog(
  live: WordListCatalog,
  row: CatalogRow,
  updated = new Date().toISOString(),
): WordListCatalog {
  if (!live || !Array.isArray((live as WordListCatalog).lists)) throw new Error("live catalog has no lists");
  if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)) {
    throw new Error("word-list id is missing");
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(updated)) {
    throw new Error("updated time is not a day or an ISO instant");
  }
  const lists: CatalogRow[] = live.lists.map((item) => ({ ...item }));
  const index = lists.findIndex((item) => item.id === row.id);
  if (index >= 0) lists[index] = row;
  else lists.push(row);
  const next: WordListCatalog = {
    format: live.format ?? 1,
    name: typeof live.name === "string" ? live.name : "Word lists",
    updated,
    lists,
  };
  assertWordListPublish(live, next, row.id);
  return next;
}
