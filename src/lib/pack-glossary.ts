import { tr } from "@/lib/i18n";
import { forBook, validateGlossary } from "@/lib/glossary-format";
import { loadStoredBook, patchStoredBook, saveBookExtras, type Gloss } from "@/lib/book-db";

/**
 * Put the word list of a book pack into a book that is already stored.
 * The list is the whole-book data: every meaning, paragraph note, sentence note,
 * phrase and "coined" flag the reader shows comes from here. Nothing is looked up online.
 */

type PackRow = {
  pos: string;
  meaning: string;
  whyHard: string;
  here?: string;
  example?: string;
  forms?: string[];
  senses?: Gloss["senses"];
  coined?: boolean;
  senseOnly?: boolean;
};

type PackFile = {
  version: number;
  glossary: Record<string, PackRow>;
};

/** SHA-256 of some bytes as hex, or "" when the browser cannot hash (for example on a plain http page). */
export async function hashBytes(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return "";
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function toGloss(
  row: PackRow,
  extra?: { senses?: Gloss["senses"]; forms?: string[]; coined?: boolean; senseOnly?: boolean },
): Gloss {
  const gloss: Gloss = { pos: row.pos, meaning: row.meaning, whyHard: row.whyHard };
  if (typeof row.here === "string" && row.here.trim()) gloss.here = row.here.trim();
  // Version 2 lists add other meanings and word forms. Version 1 lists stay as they were.
  if (extra?.senses) gloss.senses = extra.senses;
  if (extra?.forms) gloss.forms = extra.forms;
  if (extra?.coined ?? row.coined) gloss.coined = true;
  if (extra?.senseOnly ?? row.senseOnly) gloss.senseOnly = true;
  if (typeof row.example === "string" && row.example.trim()) gloss.example = row.example.trim();
  return gloss;
}

export type PackGlossaryResult = { words: number };

/**
 * Store the word list text of a pack in a book. `packId` is the catalog id (or "custom" for a list
 * the user made), `rev` the revision from the catalog. Returns how many words were stored.
 * Throws a plain-English Error when the list cannot be used.
 */
export async function applyPackGlossary(
  bookId: string,
  glossaryText: string,
  packId: string,
  rev: string,
): Promise<PackGlossaryResult> {
  let pack: PackFile;
  try {
    pack = JSON.parse(glossaryText.replace(/^\uFEFF/, "")) as PackFile;
  } catch {
    throw new Error(tr("err.packListUnreadable"));
  }
  const rows = Object.entries(pack.glossary ?? {});
  if (rows.length === 0) throw new Error(tr("err.packListEmpty"));
  let checked = pack.version === 2 ? validateGlossary(pack).file : null;
  // If this copy of the book is split into a different number of chapters than the
  // list was written for, the chapter numbers cannot be trusted: keep only the context text.
  const full = checked?.chapters ? await loadStoredBook(bookId) : null;
  if (checked && full) checked = forBook(checked, full.chapters.length);
  await saveBookExtras(bookId, {
    ...(rev ? { rev } : {}),
    source: packId,
    paragraphs: checked?.paragraphs ?? [],
    sentences: checked?.sentences ?? [],
    phrases: checked?.phrases ?? {},
  });
  await patchStoredBook(bookId, (latest) => {
    // The pack is the whole word list of the book: replace what was there.
    latest.glossary = {};
    for (const [lemma, row] of rows)
      latest.glossary[lemma] = toGloss(row, checked?.glossary[lemma]);
    latest.pending = [];
    latest.totalHard = Object.keys(latest.glossary).length;
    latest.bundled = packId;
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cibian-progress", { detail: { bookId } }));
  }
  return { words: rows.length };
}
