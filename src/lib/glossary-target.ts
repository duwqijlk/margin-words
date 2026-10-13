/**
 * Which book a glossary file already belongs to, on the admin word-list page.
 * The file name is only a hint. It selects that book when the file has no title
 * or the same title. A different title is a different book, so the id is not
 * used. Then the ISBN, then the title. Two books that fit the same way are
 * not a match: the admin picks one.
 */

export type BookKind = "lists" | "public";

export type KnownBook = {
  id: string;
  title: string;
  author: string;
  isbn: string;
  kind: BookKind;
};

export type GlossaryFileIdentity = {
  /** Id taken from the file name, before any match. */
  fileId: string;
  title: string;
  author: string;
  isbn: string;
};

const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function isbnDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 13 || digits.length === 10 ? digits : "";
}

function only(books: KnownBook[]): KnownBook | null {
  return books.length === 1 ? books[0] : null;
}

/**
 * The book this file should update. Null when nothing fits, or more than one book fits.
 */
export function matchGlossaryBook(books: readonly KnownBook[], file: GlossaryFileIdentity): KnownBook | null {
  const byId = only(books.filter((book) => book.id === file.fileId));
  if (byId) {
    const title = plain(file.title);
    if (!title || plain(byId.title) === title) return byId;
  }
  const isbn = isbnDigits(file.isbn);
  if (isbn) {
    const byIsbn = only(books.filter((book) => isbnDigits(book.isbn) === isbn));
    if (byIsbn) return byIsbn;
  }
  const title = plain(file.title);
  if (!title) return null;
  const author = plain(file.author);
  return only(
    books.filter((book) => {
      if (plain(book.title) !== title) return false;
      const theirs = plain(book.author);
      return !author || !theirs || author === theirs;
    }),
  );
}

/** Select value for one known book. The kind keeps a public book apart from a word list. */
export function bookKey(book: Pick<KnownBook, "kind" | "id">): string {
  return `${book.kind}:${book.id}`;
}
