/**
 * Outside pages for a word on the reading card. They are plain links the reader taps
 * (a new tab), never fetched by the app.
 */
export type LookupSite = "longman" | "webster" | "images";

export const LOOKUP_SITES: readonly LookupSite[] = ["longman", "webster", "images"];

/** One space between words, no outside punctuation, so "give  up," looks up "give up". */
export function lookupTerm(word: string): string {
  return word
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function lookupUrl(site: LookupSite, word: string): string {
  const term = lookupTerm(word);
  const q = encodeURIComponent(term);
  switch (site) {
    case "longman":
      return `https://www.ldoceonline.com/search/english/direct/?q=${q}`;
    case "webster":
      return `https://www.merriam-webster.com/dictionary/${q}`;
    case "images":
      return `https://www.bing.com/images/search?q=${q}`;
  }
}
