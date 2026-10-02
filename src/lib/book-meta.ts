/**
 * Optional book facts: an ISBN for one edition, and a series name plus its number.
 * Invalid values become empty. Nothing here is guessed.
 */

const ISBN13 = /^97[89]\d{10}$/;
const ISBN10 = /^\d{9}[\dX]$/;

function isbn13Ok(digits: string): boolean {
  if (!ISBN13.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

function isbn10Ok(digits: string): boolean {
  if (!ISBN10.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (digits[i] === "X" ? 10 : Number(digits[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn10To13(digits: string): string {
  const core = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + String((10 - (sum % 10)) % 10);
}

/** A valid ISBN-13 (digits only), or "". ISBN-10 is converted. Hyphens and the word ISBN are ignored. */
export function isbnDigits(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const compact = String(value).toUpperCase().replace(/[^0-9X]/g, "");
  if (isbn13Ok(compact)) return compact;
  if (compact.length === 10 && isbn10Ok(compact)) return isbn10To13(compact);
  return "";
}

/** Series title, or "". */
export function seriesName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return "";
  return name;
}

/** 1–99, or 0 when missing or invalid. */
export function seriesNumber(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d{1,2}$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(raw) && raw >= 1 && raw <= 99 ? raw : 0;
}

export type SeriesFields = { series: string; seriesNumber: number };

/**
 * Read a series from flat fields or from `{ name, number }`.
 * A name alone is kept. A number is kept only together with a name.
 */
export function readSeries(source: unknown, numberValue?: unknown): SeriesFields {
  let nameSource: unknown = source;
  let numberSource: unknown = numberValue;
  if (source && typeof source === "object") {
    const row = source as Record<string, unknown>;
    nameSource = row.name;
    numberSource = row.number;
  }
  const series = seriesName(nameSource);
  const number = series ? seriesNumber(numberSource) : 0;
  return series ? { series, seriesNumber: number } : { series: "", seriesNumber: 0 };
}
