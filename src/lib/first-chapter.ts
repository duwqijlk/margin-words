/**
 * Where a book opens the first time: the first chapter that is not front matter.
 *
 * The old rule waited for the first chapter with more than 1,200 characters in paragraphs of more
 * than 60 characters on average. A hand-made e-book has no cover, title or copyright page, and its
 * first chapters can be short or mostly dialogue, so the rule skipped real chapters and opened at
 * the fourth. Now a chapter is skipped only when it looks like front matter:
 *
 *   - its title names it (cover, title page, copyright, contents, dedication, epigraph, preface,
 *     foreword, introduction, ...);
 *   - it has almost no text (a picture of the cover, a title page, a one-line dedication);
 *   - it is a copyright page (©, "all rights reserved", ISBN) of modest length;
 *   - it is a contents page: many short lines that are mostly the titles of later chapters
 *     or "Chapter …" lines;
 *   - it is a title page: it opens with the book's own title and is short (a title page with a
 *     dedication and a verse, as Treasure Island has).
 * Only the first MAX_SKIP chapters are considered; a book whose first chapters all look like front
 * matter falls back to the old rule.
 */
export type ChapterLike = { title?: string; paragraphs: string[] };

const MAX_SKIP = 8;
/** Fewer letters than this is a cover, title or dedication page, not a chapter. */
const FEW_LETTERS = 200;

const FRONT_TITLES = new Set([
  "cover", "covers", "cover page", "front cover", "title", "title page", "titlepage", "half title",
  "half title page", "copyright", "copyright page", "contents", "table of contents", "toc",
  "frontispiece", "dedication", "epigraph", "also by", "books by", "praise", "praise for",
  "imprint", "colophon", "map", "maps", "list of illustrations", "illustrations",
]);

function key(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function letters(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function frontTitle(title: string | undefined): boolean {
  if (!title) return false;
  const k = key(title);
  // A preface, foreword or introduction is front matter too: e-books that mark where the text
  // starts (EPUB landmarks "bodymatter") put it after them, and reading apps open there.
  return FRONT_TITLES.has(k) || /^(also by|praise for|other books by|preface|foreword|introduction|editors? note)\b/.test(k);
}

function copyrightPage(text: string): boolean {
  return text.length < 4000 && /(©|\bcopyright\b|all rights reserved|\bisbn\b)/i.test(text);
}

function contentsPage(chapter: ChapterLike, later: ChapterLike[]): boolean {
  const lines = chapter.paragraphs.map((line) => line.trim()).filter(Boolean);
  if (lines.length < 5) return false;
  const average = lines.join("").length / lines.length;
  if (average > 50) return false;
  const titles = new Set(later.map((item) => key(item.title ?? "")).filter((title) => title.length > 0));
  const listed = lines.filter((line) => {
    const k = key(line.replace(/\s*\.{2,}\s*\d+\s*$/, "").replace(/\s+\d+\s*$/, ""));
    return titles.has(k) || /^(chapter|part|book|prologue|epilogue|introduction|preface)\b/.test(k) || /^\d+\s+\S/.test(k);
  });
  return listed.length >= lines.length / 2;
}

function titlePage(chapter: ChapterLike, text: string, bookTitle: string): boolean {
  const first = chapter.paragraphs.find((line) => line.trim());
  return Boolean(bookTitle) && text.length < 2000 && first !== undefined && key(first) === key(bookTitle);
}

export function isFrontMatter(chapter: ChapterLike, later: ChapterLike[] = [], bookTitle = ""): boolean {
  const text = chapter.paragraphs.join(" ");
  if (frontTitle(chapter.title)) return true;
  if (titlePage(chapter, text, bookTitle)) return true;
  if (letters(text) < FEW_LETTERS) return true;
  if (copyrightPage(text)) return true;
  return contentsPage(chapter, later);
}

/** The old rule: the first chapter with enough text in paragraph-sized pieces. */
function longProse(chapters: readonly ChapterLike[]): number {
  const at = chapters.findIndex((item) => {
    const chars = item.paragraphs.join(" ").length;
    return chars > 1200 && chars / Math.max(1, item.paragraphs.length) > 60;
  });
  return at < 0 ? 0 : at;
}

export function firstReadingChapter(chapters: readonly ChapterLike[], bookTitle = ""): number {
  const limit = Math.min(chapters.length, MAX_SKIP);
  for (let i = 0; i < limit; i += 1) {
    const chapter = chapters[i];
    if (chapter && !isFrontMatter(chapter, chapters.slice(i + 1), bookTitle)) return i;
  }
  return chapters.length > MAX_SKIP ? longProse(chapters) : 0;
}
