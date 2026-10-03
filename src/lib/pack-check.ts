/**
 * What a book pack must contain, and how the pack tools check it. No DOM and no translation in here:
 * the command-line tools use it (scripts/lib/app-modules.mjs, scripts/make-pack.mjs). The reader itself
 * no longer imports pack zips (books are added on Discover), so a PackProblem is shown as its code.
 * The rules are written for people in docs/book-pack-spec.md, section "Required files".
 *
 * A pack is ONE .zip with exactly:
 *   - one book:      book.epub            (or <name>.epub)
 *   - one word list: glossary.json        (or <name>.glossary.json)
 * and optionally cover.jpg / cover.png / cover.webp and pack.json. Other files are ignored.
 * The word list must pass the glossary check and must belong to the book: same sha256, or same title (and author).
 */
import { normText, type GlossaryFile } from "@/lib/glossary-format";

export type PackProblemCode =
  | "empty"
  | "noEpub"
  | "noList"
  | "manyEpub"
  | "manyList"
  | "listBad"
  | "noId"
  | "shaMismatch"
  | "mismatch"
  | "epubBad"
  | "tooBig";

export class PackProblem extends Error {
  readonly code: PackProblemCode;
  readonly params: Record<string, string | number>;
  constructor(code: PackProblemCode, params: Record<string, string | number> = {}) {
    super(`pack problem: ${code}`);
    this.name = "PackProblem";
    this.code = code;
    this.params = params;
  }
}

/** The biggest book (EPUB) a pack may hold. */
export const MAX_EPUB_BYTES = 40 * 1024 * 1024;

export const EPUB_NAME = /\.epub$/i;
/** glossary.json, or <name>.glossary.json */
export const LIST_NAME = /^(?:glossary|.+\.glossary)\.json$/i;
export const COVER_NAME = /^cover\.(?:jpe?g|png|webp)$/i;

export type PackGroup = { folder: string; epub: string; list: string; cover: string; info: string };

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * Find the packs in the file names of a zip (folders only; no directory entries). Each folder that has a book or a word list
 * is one pack and must have exactly one of each. Returns the files to use. Throws a PackProblem.
 */
export function findPacks(paths: string[]): PackGroup[] {
  const folders = new Map<string, string[]>();
  for (const path of paths) {
    const name = baseName(path);
    if (!name || path.startsWith("__MACOSX/") || name.startsWith(".")) continue;
    const folder = folderOf(path);
    folders.set(folder, [...(folders.get(folder) ?? []), path]);
  }
  const found: PackGroup[] = [];
  for (const [folder, files] of [...folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const epubs = files.filter((path) => EPUB_NAME.test(path));
    const lists = files.filter((path) => LIST_NAME.test(baseName(path)));
    if (epubs.length === 0 && lists.length === 0) continue;
    const label = folder ? baseName(folder) : "";
    if (epubs.length > 1)
      throw new PackProblem("manyEpub", { names: epubs.map(baseName).join(", "), where: label });
    if (lists.length > 1)
      throw new PackProblem("manyList", { names: lists.map(baseName).join(", "), where: label });
    if (epubs.length === 0) throw new PackProblem("noEpub", { where: label });
    if (lists.length === 0) throw new PackProblem("noList", { where: label });
    found.push({
      folder,
      epub: epubs[0] as string,
      list: lists[0] as string,
      cover: files.find((path) => COVER_NAME.test(baseName(path))) ?? "",
      info: files.find((path) => baseName(path).toLowerCase() === "pack.json") ?? "",
    });
  }
  if (found.length === 0) throw new PackProblem("empty");
  return found;
}

const plain = (value: string) => normText(value).replace(/[^a-z0-9]+/g, "");

/**
 * Does this word list belong to this book? Yes when the sha256 in the list is the sha256 of the EPUB,
 * or when the title (and the author, if both have one) are the same. Throws a PackProblem when not.
 */
export function matchGlossary(
  list: Pick<GlossaryFile, "title" | "author" | "sha256">,
  book: { title: string; author: string; sha256: string },
): void {
  const listSha = (list.sha256 ?? "").toLowerCase();
  if (listSha && book.sha256 && listSha === book.sha256.toLowerCase()) return;
  if (!list.title) {
    throw new PackProblem(listSha ? "shaMismatch" : "noId");
  }
  const sameTitle = plain(list.title) === plain(book.title);
  const sameAuthor = !list.author || !book.author || plain(list.author) === plain(book.author);
  if (!sameTitle || !sameAuthor) {
    throw new PackProblem("mismatch", {
      listBook: list.author ? `${list.title} / ${list.author}` : list.title,
      epubBook: book.author ? `${book.title} / ${book.author}` : book.title,
    });
  }
}
