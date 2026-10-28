/**
 * Ids for NEW catalog books (docs/BOOK_UPLOAD.md, "Identity and naming").
 *
 * A new id is a slug of the book's complete official title: lower-case letters and digits joined by
 * single hyphens, at most 64 characters. "Magic Tree House 5: Night of the Ninjas" becomes
 * `magic-tree-house-5-night-of-the-ninjas`, never `mth05`. The upload file name is only a hint.
 *
 * Old ids stay exactly as they are. The parser still accepts underscores and any legacy spelling
 * (LEGACY_ID), so `mth05` keeps working as an update target; only a NEW row must be NEW_ID.
 */

export const ID_MAX = 64;
/** Every id the catalog parser accepts, old ones included. */
export const LEGACY_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** What a new id must look like. */
export const NEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Reserved for reader-edited lists; never a catalog id. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(["custom"]);

export function isNewIdShape(id: string): boolean {
  return id.length <= ID_MAX && NEW_ID.test(id) && !RESERVED_IDS.has(id);
}

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’ʼ`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Cut at a word boundary so the slug stays readable. */
function clip(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    const next = out ? `${out}-${part}` : part;
    if (next.length > ID_MAX) break;
    out = next;
  }
  return out || parts.join("-").slice(0, ID_MAX).replace(/-+$/, "");
}

/**
 * The id a new book gets from its title. When the title does not already name its series, the
 * series and number go first so books of one series stay distinct and sort together.
 * Returns "" when the title has no letters or digits to build from.
 */
export function idFromTitle(title: string, series = "", seriesNumber = 0): string {
  const titleWords = words(title);
  if (titleWords.length === 0) return "";
  const seriesWords = words(series);
  const named = seriesWords.length > 0 && seriesWords.every((word, i) => titleWords[i] === word);
  const head = seriesWords.length > 0 && !named
    ? [...seriesWords, ...(seriesNumber > 0 ? [String(seriesNumber)] : [])]
    : [];
  const id = clip([...head, ...titleWords]);
  return RESERVED_IDS.has(id) ? `${id}-book` : id;
}

/**
 * Why a proposed new id needs a second look, or "" when it is fine.
 *  - "shape": not a slug (underscore, capital, double hyphen, too long, reserved). Refused.
 *  - "title": a slug, but some of its words are not in the title or series, as in an abbreviation
 *    such as `mth05`. Allowed only after the admin confirms it.
 */
export function newIdProblem(id: string, title: string, series = "", seriesNumber = 0): "" | "shape" | "title" {
  if (!isNewIdShape(id)) return "shape";
  const known = new Set([...words(title), ...words(series), ...(seriesNumber > 0 ? [String(seriesNumber)] : [])]);
  return id.split("-").every((word) => known.has(word)) ? "" : "title";
}
