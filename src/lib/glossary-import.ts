import { tr } from "@/lib/i18n";
import {
  loadBookExtras,
  loadStoredBook,
  patchStoredBook,
  saveBookExtras,
  type Gloss,
  type StoredBook,
} from "@/lib/book-db";
import { mergeExtras } from "@/lib/help-match";
import {
  checkAgainstBook,
  checkExtrasAgainstBook,
  forBook,
  indexChapterHtml,
  LIMITS,
  normText,
  validateGlossary,
  type ChapterIndex,
  type GlossaryCheck,
  type GlossaryFile,
} from "@/lib/glossary-format";

/** How a new word list meets the words a book already has. */
export type ImportMode = "replace" | "add";

export type ImportPlan = {
  /** words in the list that the book already has a meaning for */
  overlap: string[];
  /** words that are new to the book */
  fresh: string[];
  warnings: string[];
};

export type ImportResult = { written: number; kept: number; multi: number };

/** Read a .json file from the user and check it. Never throws. */
export async function readGlossaryFile(file: File): Promise<GlossaryCheck> {
  if (file.size > LIMITS.bytes) {
    return validateGlossary("x".repeat(LIMITS.bytes + 1));
  }
  let text = "";
  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      errors: [tr("err.listUnreadable")],
      warnings: [],
      file: null,
      stats: { words: 0, senses: 0, anchors: 0, chineseWords: [] },
    };
  }
  return validateGlossary(text);
}

/** The words of every chapter, numbered exactly as the reader numbers them. */
export function indexStoredBook(book: Pick<StoredBook, "chapters">): ChapterIndex[] {
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  return book.chapters.map((chapter) =>
    indexChapterHtml(
      chapter.html ||
        chapter.paragraphs
          .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`)
          .join(""),
      parse,
    ),
  );
}

const sameBook = (a: string, b: string) => {
  const n = (v: string) => normText(v).replace(/[^a-z0-9]+/g, "");
  return n(a) === n(b);
};

type ChapterLike = Pick<StoredBook, "chapters" | "extras">;

/**
 * Compare a checked list with a book (not yet saved, or on the shelf).
 * `have` is what the book already knows. Nothing is written.
 */
export function comparePlan(
  file: GlossaryFile,
  book: ChapterLike & { title: string },
  have: Record<string, unknown>,
): ImportPlan {
  const warnings: string[] = [];
  if (file.title && !sameBook(file.title, book.title)) {
    warnings.push(tr("plan.titleMismatch", { listTitle: file.title, bookTitle: book.title }));
  }
  if (file.chapters && file.chapters !== book.chapters.length) {
    warnings.push(
      tr("plan.chapterMismatch", {
        listChapters: file.chapters,
        bookChapters: book.chapters.length,
      }),
    );
  }
  const used = forBook(file, book.chapters.length);
  const found = checkAgainstBook(used, indexStoredBook(book), false);
  if (found.missing > 0) {
    warnings.push(tr("plan.missingPlaces", { missing: found.missing, checked: found.checked }));
    warnings.push(...found.warnings.slice(0, 5));
  }
  const notes = checkExtrasAgainstBook(used, book.chapters, false, book.extras);
  if (notes.missing > 0) {
    warnings.push(tr("plan.missingNotes", { missing: notes.missing, checked: notes.checked }));
    warnings.push(...notes.warnings.slice(0, 3));
  }
  const overlap: string[] = [];
  const fresh: string[] = [];
  for (const lemma of Object.keys(file.glossary)) {
    (have[lemma] ? overlap : fresh).push(lemma);
  }
  return { overlap, fresh, warnings };
}

export async function planImport(file: GlossaryFile, bookId: string): Promise<ImportPlan | null> {
  const book = await loadStoredBook(bookId);
  return book ? comparePlan(file, book, book.glossary) : null;
}

/**
 * Put the words of a checked list into a book. "replace" overwrites the words that
 * are already there; "add" keeps them and only adds new words. Words that are not
 * in the list are never touched. Returns how many words were written.
 */
export async function applyGlossary(
  bookId: string,
  file: GlossaryFile,
  mode: ImportMode,
  options: { fresh?: boolean } = {},
): Promise<ImportResult> {
  const book = await loadStoredBook(bookId);
  if (!book) throw new Error(tr("err.bookGone"));
  const used = forBook(file, book.chapters.length);
  let written = 0;
  let kept = 0;
  let multi = 0;
  await patchStoredBook(bookId, (meta) => {
    const done: string[] = [];
    for (const [lemma, entry] of Object.entries(used.glossary)) {
      if (mode === "add" && meta.glossary[lemma]) {
        kept += 1;
        continue;
      }
      const gloss: Gloss = { pos: entry.pos, meaning: entry.meaning, whyHard: entry.whyHard };
      if (entry.forms?.length) gloss.forms = entry.forms;
      if (entry.coined) gloss.coined = true;
      if (entry.senseOnly) gloss.senseOnly = true;
      if (entry.senses?.length) {
        gloss.senses = entry.senses;
        multi += 1;
      }
      meta.glossary[lemma] = gloss;
      done.push(lemma);
      written += 1;
    }
    const covered = new Set(done);
    meta.pending = options.fresh ? [] : meta.pending.filter((lemma) => !covered.has(lemma));
    meta.totalHard = Object.keys(meta.glossary).length + meta.pending.length;
    // A list that came with the book is the whole list of that book.
    if (options.fresh) meta.bundled = "custom";
  });
  // Paragraph notes, sentence notes and phrases that come with the list.
  const incoming = {
    paragraphs: used.paragraphs ?? [],
    sentences: used.sentences ?? [],
    phrases: used.phrases ?? {},
  };
  const old = options.fresh ? null : await loadBookExtras(bookId);
  const merged = mergeExtras(old, incoming, mode);
  // "custom" tells the app not to reload the bundled list over the user's own words.
  await saveBookExtras(bookId, { source: "custom", ...merged });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("cibian-progress", {
        detail: { bookId, done: written, total: written, error: "" },
      }),
    );
  }
  return { written, kept, multi };
}
