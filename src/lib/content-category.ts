/**
 * What kind of reading a Discover card is. Missing or unknown stays a novel, so an older
 * catalog keeps every book on the Novels tab.
 */
export const CONTENT_CATEGORIES = ["novel", "ted", "speech"] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export function readContentCategory(value: unknown): ContentCategory {
  return value === "ted" || value === "speech" ? value : "novel";
}
