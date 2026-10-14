/**
 * When a new glossary file replaces a different one, remember when the file
 * it replaced was uploaded. Uploading the same bytes again does not move that.
 */
export function previousGlossaryUpdated(prior: object | undefined, nextHash: string): string {
  if (!prior) return "";
  const row = prior as { updated?: unknown; previousUpdated?: unknown; glossary?: { sha256?: unknown } };
  const oldHash = typeof row.glossary?.sha256 === "string" ? row.glossary.sha256 : "";
  const oldUpdated = typeof row.updated === "string" ? row.updated.trim() : "";
  if (oldHash && nextHash && oldHash !== nextHash && oldUpdated) return oldUpdated;
  return typeof row.previousUpdated === "string" ? row.previousUpdated.trim() : "";
}
