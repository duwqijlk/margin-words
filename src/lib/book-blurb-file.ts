/**
 * One book's story summary, kept next to its word list on the books host:
 *
 *   word-lists/<id>/blurb.json      a word-list book
 *   public-books/<id>/blurb.json    a public-domain book
 *
 *   { "format": 1, "zh": "Chinese summary", "en": "simple English summary" }
 *
 * Either language may be missing. The Discover sheet shows the one that matches the interface and
 * never the other. Plain text only: it is drawn as text, not HTML. The admin endpoint, the upload
 * script and the app all read it through this file, so the three agree. Pure, so it is tested alone.
 */
export type BlurbLocale = "zh" | "en";
export type BookBlurb = { zh: string; en: string };
export type BlurbKind = "lists" | "public";

/** Longest summary kept, in characters. */
export const BLURB_MAX = 600;
export const BLURB_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

/** The object key of a book's summary in the books bucket. */
export function blurbKey(kind: BlurbKind, id: string): string {
  return `${kind === "public" ? "public-books" : "word-lists"}/${id}/blurb.json`;
}

const clean = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() : "";

/** Read a summary file. Anything unusable reads as empty, so a broken file shows no summary. */
export function parseBlurbFile(value: unknown): BookBlurb {
  if (!value || typeof value !== "object") return { zh: "", en: "" };
  const raw = value as Record<string, unknown>;
  return { zh: clean(raw.zh).slice(0, BLURB_MAX), en: clean(raw.en).slice(0, BLURB_MAX) };
}

/**
 * Why a summary may not be saved, or [] when it is fine. Checked before anything is written.
 * Codes, not sentences, so the server can return them and the script can print them.
 */
export function blurbProblems(value: { zh?: unknown; en?: unknown }): string[] {
  const problems: string[] = [];
  for (const locale of ["zh", "en"] as const) {
    const raw = value[locale];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      problems.push(`${locale}:not-text`);
      continue;
    }
    const text = clean(raw);
    if (!text) continue;
    if (text.length > BLURB_MAX) problems.push(`${locale}:too-long`);
    if (/<[a-z/!]|\*\*|^#|\]\(/im.test(text)) problems.push(`${locale}:markup`);
    if (locale === "zh" && !CJK.test(text)) problems.push("zh:no-chinese");
    if (locale === "en" && CJK.test(text)) problems.push("en:has-chinese");
  }
  return problems;
}

/** The file to store: format 1, and only the languages that have text. */
export function blurbFile(value: { zh?: unknown; en?: unknown }): { format: 1; zh?: string; en?: string } {
  const zh = clean(value.zh);
  const en = clean(value.en);
  return { format: 1, ...(zh ? { zh } : {}), ...(en ? { en } : {}) };
}
