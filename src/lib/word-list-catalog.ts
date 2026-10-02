/**
 * Word lists for the copyrighted books. The books host serves glossary.json only.
 * There is no EPUB, cover image, or zip in this catalog. A card with no shippable
 * cover draws a generated title and author (see BookCover).
 */
import { booksUrl } from "@/lib/books-base";
import { isbnDigits, readSeries } from "@/lib/book-meta";
import { lexileMeasure } from "@/lib/lexile";

export const WORD_LIST_CATALOG_URL = booksUrl("word-lists/catalog.json");

export type WordListPack = {
  id: string;
  title: string;
  author: string;
  lexile: string;
  isbn: string;
  series: string;
  seriesNumber: number;
  words: number;
  glossary: { url: string; bytes: number; sha256: string };
};

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function parseWordListCatalog(value: unknown): WordListPack[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.lists)) return [];
  const out: WordListPack[] = [];
  const seen = new Set<string>();
  for (const item of raw.lists) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id, 64);
    const glossary = row.glossary && typeof row.glossary === "object" ? (row.glossary as Record<string, unknown>) : null;
    const url = text(glossary?.url, 600);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || seen.has(id) || !url || url.includes("..") || /\.epub$/i.test(url))
      continue;
    seen.add(id);
    const series = readSeries(row.series, row.seriesNumber);
    out.push({
      id,
      title: text(row.title, 160) || id,
      author: text(row.author, 120),
      lexile: lexileMeasure(row.lexile),
      isbn: isbnDigits(row.isbn),
      series: series.series,
      seriesNumber: series.seriesNumber,
      words: typeof row.words === "number" && row.words > 0 ? Math.floor(row.words) : 0,
      glossary: {
        url,
        bytes: typeof glossary?.bytes === "number" ? glossary.bytes : 0,
        sha256: /^[0-9a-f]{64}$/.test(String(glossary?.sha256)) ? String(glossary?.sha256) : "",
      },
    });
  }
  return out;
}

export async function loadWordListCatalog(url = WORD_LIST_CATALOG_URL): Promise<WordListPack[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("word list catalog");
  return parseWordListCatalog(await response.json());
}
