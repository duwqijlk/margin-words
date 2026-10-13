import { isbnDigits } from "../../src/lib/book-meta.ts";

/**
 * Whether two descriptions are the same book.
 * Kept in step with src/lib/shelf-identity.ts: ISBN, or the same title and author.
 */
export type BookIdentity = { title: string; author: string; isbn?: string };

const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function titleKeys(title: string): string[] {
  const whole = plain(title);
  if (!whole) return [];
  const main = title
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .split(/\s[:\u2013\u2014-]\s|:\s/)[0]
    ?.replace(/^\s*(?:the|a|an)\s+/i, "");
  const short = plain(main ?? "");
  return short && short !== whole ? [whole, short] : [whole];
}

function sameAuthor(a: string, b: string): boolean {
  const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0);
  const first = words(a);
  const second = words(b);
  if (first.length === 0 || second.length === 0) return true;
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  return short.every((word) => long.includes(word));
}

export function sameBook(a: BookIdentity, b: BookIdentity): boolean {
  const isbnA = isbnDigits(a.isbn ?? "");
  const isbnB = isbnDigits(b.isbn ?? "");
  if (isbnA && isbnA === isbnB) return true;
  const keysA = titleKeys(a.title);
  const keysB = titleKeys(b.title);
  if (!keysA.some((key) => keysB.includes(key))) return false;
  return sameAuthor(a.author, b.author);
}
