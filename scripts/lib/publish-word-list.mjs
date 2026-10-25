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

const addedOf = (row) => (row && typeof row.added === "string" ? row.added : "");

/**
 * `added` is when the book first came to the catalog. A new list for the same book keeps it,
 * so Discover's new-books row does not fill with old books whose word list changed.
 */
export function keepAdded(prior, row) {
  const added = addedOf(prior);
  const kept = added ? { ...row, added } : row;
  // The live cover is the one shown (moved to covers/ by scripts/move-covers.mjs, or uploaded in the
  // admin page). A list republished from git keeps it rather than pointing back at an old file.
  if (prior?.cover?.url && /^https:\/\//.test(prior.cover.url)) return { ...kept, cover: prior.cover };
  return kept;
}

/**
 * @param {object} live catalog JSON already on the books host
 * @param {object} row one list from buildWordLists
 * @param {string} [updated] a day `YYYY-MM-DD`, or an ISO instant
 */
export function mergeWordListCatalog(live, row, updated = new Date().toISOString()) {
  if (!live || !Array.isArray(live.lists)) throw new Error("live catalog has no lists");
  if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)) {
    throw new Error("word-list id is missing");
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(updated)) {
    throw new Error("updated time is not a day or an ISO instant");
  }
  const lists = live.lists.map((item) => ({ ...item }));
  const index = lists.findIndex((item) => item.id === row.id);
  if (index >= 0) {
    const prior = lists[index];
    const nextRow = keepAdded(prior, row);
    const oldHash = glossHash(prior);
    const nextHash = glossHash(nextRow);
    const oldUpdated = typeof prior.updated === "string" ? prior.updated.trim() : "";
    const kept = typeof prior.previousUpdated === "string" ? prior.previousUpdated.trim() : "";
    const previous = oldHash && nextHash && oldHash !== nextHash && oldUpdated ? oldUpdated : kept;
    if (previous) nextRow.previousUpdated = previous;
    else delete nextRow.previousUpdated;
    lists[index] = nextRow;
  } else {
    const fresh = { ...row, added: addedOf(row) || updated };
    delete fresh.previousUpdated;
    lists.push(fresh);
  }
  const next = {
    format: live.format ?? 1,
    name: typeof live.name === "string" ? live.name : "Word lists",
    updated,
    lists,
  };
  assertWordListPublish(live, next, row.id);
  return next;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Credits on an entry and its senses, as "word" or "word#2" (sense 2) -> public id. */
function creditsOf(glossary) {
  const out = new Map();
  for (const [word, entry] of Object.entries(glossary ?? {})) {
    if (typeof entry?.credit === "string") out.set(word, entry.credit);
    (entry?.senses ?? []).forEach((sense, index) => {
      if (typeof sense?.credit === "string") out.set(`${word}#${index + 1}`, sense.credit);
    });
  }
  return out;
}

/**
 * What a rebuilt list would lose against the list that is live now. The daily patrol edits the live
 * list (adds words, fixes meanings, credits readers), and a list rebuilt from the book has none of
 * that. Returns the words the new list drops, the words whose entry changed, and the reader credits
 * that would disappear (a credit that moved with an identical meaning still counts as kept).
 * @param {{ glossary?: object, phrases?: object }} live
 * @param {{ glossary?: object, phrases?: object }} next
 */
export function liveListLosses(live, next) {
  const before = live?.glossary ?? {};
  const after = next?.glossary ?? {};
  const dropped = Object.keys(before).filter((word) => !(word in after));
  const changed = Object.keys(before).filter((word) => word in after && !sameJson(before[word], after[word]));
  const kept = new Set(creditsOf(after).values());
  const credits = [...creditsOf(before)]
    .filter(([, id]) => !kept.has(id))
    .map(([where, id]) => `${where} (${id})`);
  const phrases = Object.keys(live?.phrases ?? {}).filter((key) => !(key in (next?.phrases ?? {})));
  return { dropped, changed, credits, phrases };
}
