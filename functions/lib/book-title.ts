/** Letters and digits only, so "James!" and "James" are the same title. */
export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * An upload may replace the word list of the book this id already names.
 * A file that names a different book must not reuse the id: Discover would
 * keep the old name while the file became the new book.
 * A file with no title is an update of the existing book. Older word lists omit it.
 */
export function replacesSameBook(existingTitle: unknown, incomingTitle: unknown): boolean {
  if (typeof incomingTitle !== "string" || !incomingTitle.trim()) return true;
  const current = typeof existingTitle === "string" ? existingTitle : "";
  return normalizeTitle(incomingTitle) === normalizeTitle(current);
}
