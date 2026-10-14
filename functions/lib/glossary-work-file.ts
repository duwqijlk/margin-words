/**
 * Read and write word-lists/glossary-work.json. Catalog files are not touched.
 */
import {
  applyGlossaryWork,
  glossaryWorkFile,
  GLOSSARY_WORK_KEY,
  normalizeGlossaryWork,
  type GlossaryWorkItem,
  type GlossaryWorkKind,
} from "../../src/lib/glossary-work.ts";
import type { R2BucketLike } from "./db.ts";
import { HttpError } from "./http.ts";

export async function readGlossaryWork(bucket: R2BucketLike): Promise<GlossaryWorkItem[]> {
  const object = await bucket.get(GLOSSARY_WORK_KEY);
  if (!object) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await object.arrayBuffer()));
  } catch {
    throw new HttpError(500, "bad-work-file");
  }
  const normalized = normalizeGlossaryWork(parsed);
  if (!normalized.ok) throw new HttpError(500, "bad-work-file");
  return normalized.items;
}

export async function writeGlossaryWork(bucket: R2BucketLike, items: readonly GlossaryWorkItem[], updated: string): Promise<void> {
  const file = glossaryWorkFile(items, updated);
  await bucket.put(GLOSSARY_WORK_KEY, new TextEncoder().encode(`${JSON.stringify(file, null, 1)}\n`));
}

/** Drop one book after its glossary is published. A missing file is fine. A bad file is left alone. */
export async function clearGlossaryWork(bucket: R2BucketLike, kind: GlossaryWorkKind, id: string): Promise<void> {
  try {
    const items = await readGlossaryWork(bucket);
    const next = applyGlossaryWork(items, kind, id, false, new Date().toISOString());
    if (!next || next.length === items.length) return;
    await writeGlossaryWork(bucket, next, new Date().toISOString());
  } catch {
    // The glossary is already on the host. The row can still be cleared from the table.
  }
}
