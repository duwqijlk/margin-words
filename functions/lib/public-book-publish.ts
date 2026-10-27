/** Shared public-book validation and revision rules. Never serialize the validator's cleaned file. */
import type { Env } from "./db.ts";
import { validateGlossary } from "../../src/lib/glossary-format.ts";
import { replacesSameBook } from "./book-title.ts";
import { previousGlossaryUpdated } from "./glossary-version.ts";
import { HttpError } from "./http.ts";
import { sha256HexBytes } from "./password.ts";

/** Body parsing and validation can exceed Pages Free CPU; no byte threshold proves otherwise. */
export function assertPublicPublishBudget(env: Env): void {
  if (env.PUBLIC_BOOK_PUBLISH_CPU_CONFIRMED !== "true") throw new HttpError(503, "publish-budget-unconfirmed");
}

export function checkPublicGlossary(data: unknown) {
  const checked = validateGlossary(data);
  if (!checked.ok) throw new HttpError(400, "bad-glossary");
  return {
    words: checked.stats.words,
    paragraphs: checked.stats.paragraphs ?? 0,
    sentences: checked.stats.sentences ?? 0,
    phrases: checked.stats.phrases ?? 0,
  };
}

export function fileRef(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Called under the catalog lock, against its freshly read row. */
export async function updatePublicRow(
  row: Record<string, unknown> & { id: string },
  data: unknown,
  counts: { words: number; paragraphs: number; sentences: number; phrases: number; bytes: number; sha256: string },
  epub?: { bytes: number; sha256: string },
): Promise<void> {
  if (!replacesSameBook(row.title, (data as { title?: unknown })?.title)) throw new HttpError(409, "different-book");
  const oldGlossary = fileRef(row.glossary);
  const oldEpub = fileRef(row.epub);
  const glossaryChanged = oldGlossary.sha256 !== counts.sha256;
  const epubChanged = epub !== undefined && oldEpub.sha256 !== epub.sha256;
  const previous = previousGlossaryUpdated(row, counts.sha256);
  if (previous) row.previousUpdated = previous;
  const rev = counts.sha256.slice(0, 12);
  if (epubChanged) {
    row.rev = (await sha256HexBytes(new TextEncoder().encode(`${epub.sha256}\n${counts.sha256}`))).slice(0, 12);
  } else if (glossaryChanged) row.rev = rev;
  Object.assign(row, { words: counts.words, paragraphs: counts.paragraphs, sentences: counts.sentences, phrases: counts.phrases });
  row.glossary = { ...oldGlossary, url: `${row.id}/glossary.json`, bytes: counts.bytes, sha256: counts.sha256, rev };
  if (epub) row.epub = { ...oldEpub, url: `${row.id}/book.epub`, ...epub };
  row.updated = new Date().toISOString();
}

export function applyIsbn(row: Record<string, unknown>, params: URLSearchParams): void {
  if (!params.has("isbn")) return;
  const isbn = (params.get("isbn") ?? "").trim();
  if (isbn) row.isbn = isbn;
  else delete row.isbn;
}
