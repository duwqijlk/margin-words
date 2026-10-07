/**
 * The pure decisions behind word-list updates (no DOM, no storage, unit tested in
 * scripts/word-list-update.test.mjs). The runner that notices them is src/lib/word-list-update.ts.
 * A newer list is never applied by itself. The reader taps Update.
 */
import { editionMatch, matchPercent, EDITION_MATCH_OK } from "@/lib/edition-match";
import { validateGlossary } from "@/lib/glossary-format";

export type ListHoldWhy = "ownList" | "bookChanged" | "mismatch" | "newList";

export type ListUpdatePlan =
  /** the installed list is current */
  | { kind: "none" }
  /**
   * Leave the stored list until the reader taps Update.
   * `newList` and `bookChanged` keep the button.
   * `ownList` does not: a hand-edited list stays, and the card only says so.
   */
  | { kind: "manual"; why: "ownList" | "bookChanged" | "newList" };

/**
 * What to do with one installed book whose pack is in the catalog.
 * A newer word list waits for Update. A list the reader added or edited by hand stays theirs.
 * A classic whose BOOK file changed still waits for that same button.
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
  /**
   * Words stored on this book. Omit when the e-book is not stored yet.
   * Compared with `catalogWords` so a stale list saved under the current revision
   * still offers Update.
   */
  installedWords?: number;
  /** Words in the catalog list. 0 when the catalog does not say. */
  catalogWords?: number;
}): ListUpdatePlan {
  const countsDiffer =
    input.listSource !== "custom" &&
    typeof input.installedWords === "number" &&
    typeof input.catalogWords === "number" &&
    input.catalogWords > 0 &&
    input.installedWords !== input.catalogWords;
  if (!input.catalogRev || input.installedRev === input.catalogRev) {
    if (countsDiffer) return { kind: "manual", why: "newList" };
    return { kind: "none" };
  }
  if (input.listSource === "custom") return { kind: "manual", why: "ownList" };
  if (input.catalogSha && input.installedSha !== input.catalogSha)
    return { kind: "manual", why: "bookChanged" };
  return { kind: "manual", why: "newList" };
}

/**
 * A saved copy of a word list may be paired only when it is the catalog file.
 * An empty catalog hash cannot be checked, so the copy is kept.
 * An empty saved hash means the copy could not be checked, so it is not current.
 */
export function savedListIsCurrent(savedSha: string, catalogSha: string): boolean {
  if (!catalogSha) return true;
  return savedSha === catalogSha;
}

/**
 * What applying one downloaded word list does. The manual Update button uses this same path.
 * A hand-edited list (`source === "custom"`) is never replaced, not even from that button:
 * the saved copy of the new text and the revision still move on, and the stored glossary stays.
 * A card that is still waiting for the reader's e-book only refreshes the saved copy.
 */
export function wordListUpdateActions(input: {
  /** the book already has the reader's EPUB stored */
  hasStoredBook: boolean;
  /** `extras.source`; "custom" when the reader added or edited this book's list by hand */
  listSource: string | undefined;
}): { applyGlossary: boolean; saveText: true; saveRev: true } {
  return {
    applyGlossary: input.hasStoredBook && input.listSource !== "custom",
    saveText: true,
    saveRev: true,
  };
}

/**
 * The Discover card offers Update only when that tap can change the stored list or book.
 * A hand-edited list does not: the button would look like it replaces the list the reader wrote.
 */
export function holdOffersUpdate(why: ListHoldWhy): boolean {
  return why !== "ownList";
}

/** i18n key for a hold the reader can see on the card. A low match uses `lists.matchWarn`. */
export function holdReasonKey(
  why: "ownList" | "bookChanged" | "newList",
): "lists.keptYours" | "lists.keptBook" | "lists.newList" {
  if (why === "ownList") return "lists.keptYours";
  if (why === "bookChanged") return "lists.keptBook";
  return "lists.newList";
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
