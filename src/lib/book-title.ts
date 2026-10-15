/**
 * Letters and digits only, so "James!" and "James" are the same title.
 * A trailing edition label is not another book: "Title: A Novel" matches "Title".
 * A real subtitle stays put: "Title: Catching Fire" does not match "Title".
 */
const EDITION =
  "a novel|a memoir|a biography|a true story|an autobiography|a novella|a graphic novel";
const EDITION_TAIL = new RegExp(
  `(?:\\s*[:\uFF1A]\\s*(?:${EDITION})|\\s+[-\\u2013\\u2014]\\s*(?:${EDITION})|\\s*\\((?:${EDITION})\\))\\s*$`,
  "i",
);

function withoutEdition(value: string): string {
  let title = value.trim();
  for (let pass = 0; pass < 2; pass += 1) {
    const next = title.replace(EDITION_TAIL, "").trim();
    if (!next || next === title) break;
    title = next;
  }
  return title;
}

export function normalizeTitle(value: string): string {
  return withoutEdition(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
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
