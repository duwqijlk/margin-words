/**
 * Add or replace one public-domain book on top of the catalog that is already live.
 * Other books keep the file hashes already on the host. Rebuilding the whole catalog
 * from git and uploading it points those books at glossaries that were never uploaded,
 * and the reader then rejects the download.
 */

function fileSha(row, key) {
  const value = row?.[key]?.sha256;
  return typeof value === "string" ? value : "";
}

/**
 * @param {{ packs?: object[] }} before
 * @param {{ packs?: object[] }} after
 * @param {string | string[]} ids books this publish is allowed to change
 */
export function assertPublicPublish(before, after, ids) {
  const allowed = new Set(Array.isArray(ids) ? ids : [ids]);
  const prior = before?.packs ?? [];
  const next = after?.packs ?? [];
  const seen = new Set();
  for (const row of next) {
    if (!row || typeof row.id !== "string" || seen.has(row.id)) {
      throw new Error("public catalog has a missing or repeated id");
    }
    seen.add(row.id);
  }
  for (const id of allowed) {
    if (!seen.has(id)) throw new Error(`publish is missing ${id}`);
  }
  for (const row of prior) {
    if (!seen.has(row.id)) throw new Error(`refusing to drop ${row.id}`);
    if (allowed.has(row.id)) continue;
    const kept = next.find((item) => item.id === row.id);
    if (fileSha(kept, "glossary") !== fileSha(row, "glossary")) {
      throw new Error(`refusing to change the glossary hash of ${row.id}`);
    }
    if (fileSha(kept, "epub") !== fileSha(row, "epub")) {
      throw new Error(`refusing to change the book file hash of ${row.id}`);
    }
  }
}

/**
 * @param {object} live catalog JSON already on the books host
 * @param {object | object[]} rows one pack, or several packs, from the local public catalog
 * @param {string} [updated] a day `YYYY-MM-DD`, or an ISO instant
 */
export function mergePublicCatalog(live, rows, updated = new Date().toISOString()) {
  const incoming = Array.isArray(rows) ? rows : [rows];
  if (!live || !Array.isArray(live.packs)) throw new Error("live catalog has no packs");
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(updated)) {
    throw new Error("updated time is not a day or an ISO instant");
  }
  const packs = live.packs.map((item) => ({ ...item, zip: null }));
  for (const row of incoming) {
    if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)) {
      throw new Error("public book id is missing");
    }
    const nextRow = { ...row, zip: null };
    const index = packs.findIndex((item) => item.id === row.id);
    if (index >= 0) packs[index] = nextRow;
    else packs.push(nextRow);
  }
  const next = {
    format: live.format ?? 1,
    name: typeof live.name === "string" ? live.name : "Margin Words book packs",
    updated,
    packs,
  };
  assertPublicPublish(live, next, incoming.map((row) => row.id));
  return next;
}
