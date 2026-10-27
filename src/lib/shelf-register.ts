import { targetIsCurrent } from "@/lib/book-mutation";
import { tr } from "@/lib/i18n";
/**
 * Put the result of an install on the shelf. One book is one card: when the install reused a card that
 * was waiting for the reader's own e-book (a card from Discover), that card now holds the e-book, so it is
 * no longer "needs your e-book" and it reads as an e-book.
 */
import type { InstallResult } from "@/lib/packs";
import { useVocab } from "@/lib/vocab-store";

export function registerInstalled(
  result: InstallResult,
  extra: { matchRate?: number; oldFashioned?: boolean; oldFashionedReason?: string } = {},
): void {
  if (result.mutation && (!targetIsCurrent(result.mutation) ||
      !useVocab.getState().books.some((book) => book.id === result.bookId)))
    throw new Error(tr("err.bookGone"));
  const { books, addBook, setBookDetails } = useVocab.getState();
  if (!books.some((book) => book.id === result.bookId))
    addBook(result.title, result.author, "epub", result.bookId);
  setBookDetails([
    {
      id: result.bookId,
      lexile: result.lexile,
      isbn: result.isbn,
      series: result.series,
      seriesNumber: result.seriesNumber,
      needsEpub: false,
      source: "epub",
      ...extra,
    },
  ]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cibian-progress", { detail: { bookId: result.bookId } }));
  }
}
