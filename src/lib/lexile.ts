/**
 * A Lexile measure (MetaMetrics), such as "880L" or "HL1070L".
 * Optional everywhere: a book or a pack without one is simply unrated.
 * The pattern is the one publishers and library catalogs print. Keep build-packs.mjs in step with it.
 */

/** Codes MetaMetrics prints in front of the number, then the number and L. BR is below 0L. */
const LEXILE_RE = /^(?:AD|NC|HL|IG|GN|NP)?\d{1,4}L$|^BR\d{1,4}L$/;

/** "" when the value is missing or not a Lexile measure. Stored form is upper case, no spaces. */
export function lexileMeasure(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, "").toUpperCase();
  return LEXILE_RE.test(clean) ? clean : "";
}

/**
 * The number used to sort. "880L" is 880. "BR100L" is -100 (a beginning-reader measure,
 * and a larger BR number is easier). Codes such as HL do not change the number.
 */
export function lexileNumber(measure: string): number | null {
  const clean = lexileMeasure(measure);
  if (!clean) return null;
  const digits = Number(clean.match(/(\d+)L$/)?.[1]);
  if (!Number.isFinite(digits)) return null;
  return clean.startsWith("BR") ? -digits : digits;
}

export type DifficultyBand = "unrated" | "under800" | "mid" | "high";

/** Bands for the shelf and the free-books list. Unrated is its own band. */
export function difficultyBand(measure: string): DifficultyBand {
  const n = lexileNumber(measure);
  if (n === null) return "unrated";
  if (n < 800) return "under800";
  if (n < 1000) return "mid";
  return "high";
}

/** Easiest or hardest first. Books with no measure sort last either way. */
export function compareLexile(a: string, b: string, direction: "easy" | "hard"): number {
  const an = lexileNumber(a);
  const bn = lexileNumber(b);
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return direction === "easy" ? an - bn : bn - an;
}
