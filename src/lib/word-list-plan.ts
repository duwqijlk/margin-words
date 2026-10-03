/**
 * The pure decisions behind automatic word-list updates (no DOM, no storage, unit tested in
 * scripts/word-list-update.test.mjs). The runner that applies them is src/lib/word-list-update.ts.
 */
import { editionMatch, matchPercent, EDITION_MATCH_OK } from "@/lib/edition-match";
import { validateGlossary } from "@/lib/glossary-format";

export type ListUpdatePlan =
  /** the installed list is current */
  | { kind: "none" }
  /** replace the word list quietly in the background */
  | { kind: "auto" }
  /** never replace by itself; Discover keeps the manual Update button */
  | { kind: "manual"; why: "ownList" | "bookChanged" }
  /** not now; try again on the next load */
  | { kind: "wait"; why: "offline" | "reading" };

/**
 * What to do with one installed book whose pack is in the catalog. Only the word list is ever
 * replaced automatically: a list the reader added or edited by hand stays theirs, and a classic
 * whose BOOK file changed (or whose stored file cannot be checked) is left to the manual button.
 */
export function planListUpdate(input: {
  /** the revision stored with the book */
  installedRev: string;
  /** the revision the catalog shows now */
  catalogRev: string;
  /** `extras.source`: "custom" when the reader added or edited this book's list by hand */
  listSource: string | undefined;
  /** classics: sha256 of the stored EPUB ("" when unknown). "" for word-list books. */
  installedSha: string;
  /** classics: sha256 of the catalog EPUB. "" for word-list books. */
  catalogSha: string;
  /** navigator.onLine === false */
  offline: boolean;
  /** this book is open in the reader right now (no hot swap mid-reading) */
  reading: boolean;
}): ListUpdatePlan {
  if (!input.catalogRev || input.installedRev === input.catalogRev) return { kind: "none" };
  if (input.listSource === "custom") return { kind: "manual", why: "ownList" };
  if (input.catalogSha && input.installedSha !== input.catalogSha)
    return { kind: "manual", why: "bookChanged" };
  if (input.offline) return { kind: "wait", why: "offline" };
  if (input.reading) return { kind: "wait", why: "reading" };
  return { kind: "auto" };
}

export type NewListCheck =
  | { ok: true; percent: number }
  | { ok: false; problem: "unreadable" | "mismatch"; percent: number };

/**
 * May this downloaded word list replace the one on a book the reader supplied the EPUB for?
 * The same edition check as the own-EPUB dialog: enough of the list's own text snippets must be
 * found in the stored book, else the old list is kept and the reason is shown on the card.
 */
export function checkListAgainstBook(
  glossaryText: string,
  paragraphs: readonly string[],
): NewListCheck {
  const check = validateGlossary(glossaryText);
  if (!check.ok || !check.file) return { ok: false, problem: "unreadable", percent: 0 };
  const match = editionMatch(check.file, paragraphs);
  const percent = matchPercent(match);
  if (match.kind !== "none" && match.rate < EDITION_MATCH_OK)
    return { ok: false, problem: "mismatch", percent };
  return { ok: true, percent };
}
