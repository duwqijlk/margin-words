/**
 * Put a word-list book on the shelf before the reader has an e-book.
 * The glossary is downloaded now. The EPUB is not. The card stays "needs your e-book"
 * until the reader adds their own file.
 */
import { listPackRecords, saveCover, savePackRecord } from "@/lib/book-db";
import { fetchWordList } from "@/lib/pair-epub";
import { resolveAgainst } from "@/lib/packs";
import { useVocab } from "@/lib/vocab-store";
import { WORD_LIST_CATALOG_URL, type WordListPack } from "@/lib/word-list-catalog";

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

export async function placeWordList(pack: WordListPack): Promise<string> {
  const existing = (await listPackRecords()).find((record) => record.packId === pack.id);
  if (existing) return existing.bookId;
  await fetchWordList(pack);
  const bookId = crypto.randomUUID();
  const { addBook, setBookDetails } = useVocab.getState();
  addBook(pack.title, pack.author, "notes", bookId);
  setBookDetails([
    {
      id: bookId,
      lexile: pack.lexile,
      isbn: pack.isbn,
      series: pack.series,
      seriesNumber: pack.seriesNumber,
      needsEpub: true,
    },
  ]);
  await savePackRecord({
    packId: pack.id,
    bookId,
    rev: pack.glossary.sha256.slice(0, 12),
    sha256: "",
    installedAt: Date.now(),
  });
  if (pack.cover?.url) {
    try {
      const response = await fetch(resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url));
      if (response.ok) {
        const url = await dataUrlOf(await response.blob());
        if (url) await saveCover(bookId, url);
      }
    } catch {
      // The card falls back to the generated cover.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cibian-covers"));
    window.dispatchEvent(new CustomEvent("cibian-progress", { detail: { bookId } }));
  }
  return bookId;
}
