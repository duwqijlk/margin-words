/**
 * Read and write word-lists/qq-groups.json. Catalog files are not touched.
 */
import { normalizeQqGroups, qqGroupsFile, QQ_GROUPS_KEY, type QqGroupsFile } from "../../src/lib/qq-groups.ts";
import type { R2BucketLike } from "./db.ts";
import { HttpError } from "./http.ts";

export async function readQqGroups(bucket: R2BucketLike): Promise<QqGroupsFile | null> {
  const object = await bucket.get(QQ_GROUPS_KEY);
  if (!object) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await object.arrayBuffer()));
  } catch {
    throw new HttpError(500, "bad-groups-file");
  }
  const normalized = normalizeQqGroups(parsed);
  if (!normalized.ok) throw new HttpError(500, "bad-groups-file");
  const updated = (parsed as { updated?: unknown }).updated;
  return qqGroupsFile(normalized.groups, typeof updated === "string" ? updated : "");
}

export async function writeQqGroups(bucket: R2BucketLike, groups: readonly string[], updated: string): Promise<QqGroupsFile> {
  const file = qqGroupsFile(groups, updated);
  await bucket.put(QQ_GROUPS_KEY, new TextEncoder().encode(`${JSON.stringify(file, null, 1)}\n`));
  return file;
}
