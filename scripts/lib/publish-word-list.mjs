/**
 * Add or replace one word-list row on top of the catalog that is already live.
 * Other rows, including their glossary hashes, stay byte-for-byte the same idea:
 * a later upload must not point Discover at files that were not uploaded.
 */

function glossHash(row) {
  const value = row?.glossary?.sha256;
  return typeof value === "string" ? value : "";
}

/**
 * @param {{ lists?: object[] }} before
 * @param {{ lists?: object[] }} after
 * @param {string} id
 */
export function assertWordListPublish(before, after, id) {
  const prior = before?.lists ?? [];
  const next = after?.lists ?? [];
  const seen = new Set();
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

/**
 * @param {object} live catalog JSON already on the books host
 * @param {object} row one list from buildWordLists
 * @param {string} [updated] YYYY-MM-DD
 */
export function mergeWordListCatalog(live, row, updated = new Date().toISOString().slice(0, 10)) {
  if (!live || !Array.isArray(live.lists)) throw new Error("live catalog has no lists");
  if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)) {
    throw new Error("word-list id is missing");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) throw new Error("updated day is not YYYY-MM-DD");
  const lists = live.lists.map((item) => ({ ...item }));
  const index = lists.findIndex((item) => item.id === row.id);
  if (index >= 0) lists[index] = row;
  else lists.push(row);
  const next = {
    format: live.format ?? 1,
    name: typeof live.name === "string" ? live.name : "Word lists",
    updated,
    lists,
  };
  assertWordListPublish(live, next, row.id);
  return next;
}
