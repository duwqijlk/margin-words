/**
 * How much of a word list's own book text is in an EPUB the reader supplied.
 * Anchor `context` snippets are counted. When a list has none, paragraph and
 * sentence `context` snippets are used instead: they are the same kind of quote.
 */
import { looseText } from "@/lib/help-match";
import { includesLoose } from "@/lib/flow-text";

export type SnippetSource = {
  glossary?: Record<string, { senses?: Array<{ anchors?: Array<{ context?: string }> }> }>;
  paragraphs?: Array<{ context?: string }>;
  sentences?: Array<{ context?: string }>;
};

export type EditionMatch = {
  found: number;
  total: number;
  /** 0–1. 1 when there is nothing to compare. */
  rate: number;
  kind: "anchor" | "snippet" | "none";
};

/** Below this, the EPUB is treated as a different edition. */
export const EDITION_MATCH_OK = 0.8;

function contexts(rows: Array<{ context?: string }> | undefined): string[] {
  const out: string[] = [];
  for (const row of rows ?? []) {
    const text = row.context?.trim();
    if (text) out.push(text);
  }
  return out;
}

export function collectSnippets(file: SnippetSource): { kind: EditionMatch["kind"]; snippets: string[] } {
  const anchors: string[] = [];
  for (const entry of Object.values(file.glossary ?? {})) {
    for (const sense of entry.senses ?? []) anchors.push(...contexts(sense.anchors));
  }
  if (anchors.length > 0) return { kind: "anchor", snippets: anchors };
  const extra = [...contexts(file.paragraphs), ...contexts(file.sentences)];
  if (extra.length > 0) return { kind: "snippet", snippets: extra };
  return { kind: "none", snippets: [] };
}

/** Share of the list's snippets found in the book's paragraphs. */
export function editionMatch(file: SnippetSource, paragraphs: readonly string[]): EditionMatch {
  const { kind, snippets } = collectSnippets(file);
  if (snippets.length === 0) return { found: 0, total: 0, rate: 1, kind: "none" };
  const haystack = looseText(paragraphs.join("\n"));
  let found = 0;
  for (const snippet of snippets) {
    const needle = looseText(snippet);
    if (includesLoose(haystack, needle)) found += 1;
  }
  return { found, total: snippets.length, rate: found / snippets.length, kind };
}

/** Whole percent, 0–100. */
export function matchPercent(match: EditionMatch): number {
  if (match.kind === "none" || match.total === 0) return 100;
  return Math.round(match.rate * 100);
}
