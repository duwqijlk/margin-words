/**
 * Put a word-list book on the shelf before the reader has an e-book.
 * The glossary is downloaded now. The EPUB is not. The card stays "needs your e-book"
 * until the reader adds their own file.
 *
 * One book is one card. If the shelf already has this book (a card from an earlier tap, an imported
 * e-book whose pack had another id, or data left by an older version), that card is used.
 */
import { listBookSummaries, listPackRecords, loadCover, saveCover, savePackRecord } from "@/lib/book-db";
import { fetchCoverData } from "@/lib/covers";
import { fetchWordList } from "@/lib/pair-epub";
import { resolveAgainst } from "@/lib/packs";
import { findOnShelf } from "@/lib/shelf-identity";
import { useVocab } from "@/lib/vocab-store";
import { WORD_LIST_CATALOG_URL, type WordListPack } from "@/lib/word-list-catalog";

const running = new Map<string, Promise<string>>();

/** Returns the id of the card. Taps that come while the first one is still working share its result. */
export function placeWordList(pack: WordListPack): Promise<string> {
  const known = running.get(pack.id);
  if (known) return known;
  const run = place(pack).finally(() => running.delete(pack.id));
  running.set(pack.id, run);
  return run;
}

function details(pack: WordListPack, needsEpub: boolean) {
  return {
    lexile: pack.lexile,
    isbn: pack.isbn,
    series: pack.series,
    seriesNumber: pack.seriesNumber,
    ...(needsEpub ? { needsEpub: true } : {}),
    oldFashioned: pack.oldFashioned,
    oldFashionedReason: pack.oldFashionedReason,
  };
}

async function fillCover(bookId: string, pack: WordListPack): Promise<void> {
  if (!pack.cover?.url || (await loadCover(bookId).catch(() => ""))) return;
  const cover = await fetchCoverData(resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url), pack.cover.sha256);
  if (cover) await saveCover(bookId, cover, { source: "catalog", ref: pack.cover.sha256 });
}

async function place(pack: WordListPack): Promise<string> {
  const { addBook, setBookDetails } = useVocab.getState();
  const records = await listPackRecords();
  const stored = new Set((await listBookSummaries().catch(() => [])).map((book) => book.id));
  const shelf = () => useVocab.getState().books.map((book) => ({ ...book, stored: stored.has(book.id) }));

  // 1. The record of this very list.
  const byId = records.find((record) => record.packId === pack.id);
  // 2. The same book under another pack id.
  const same = byId ? null : findOnShelf(shelf(), { title: pack.title, author: pack.author, isbn: pack.isbn });

  const card = byId?.bookId ?? same?.id ?? "";
  if (card) {
    const mine = useVocab.getState().books.find((book) => book.id === card);
    if (!mine) {
      addBook(pack.title, pack.author, stored.has(card) ? "epub" : "notes", card);
      setBookDetails([{ id: card, ...details(pack, !stored.has(card)) }]);
    }
    if (!byId) {
      const old = records.find((record) => record.bookId === card);
      await savePackRecord({
        packId: pack.id,
        bookId: card,
        rev: old?.rev ?? pack.glossary.sha256.slice(0, 12),
        sha256: old?.sha256 ?? "",
        installedAt: old?.installedAt ?? Date.now(),
      });
    }
    await fillCover(card, pack).catch(() => undefined);
    return card;
  }

  await fetchWordList(pack);
  const bookId = crypto.randomUUID();
  addBook(pack.title, pack.author, "notes", bookId);
  setBookDetails([{ id: bookId, ...details(pack, true) }]);
  await savePackRecord({
    packId: pack.id,
    bookId,
    rev: pack.glossary.sha256.slice(0, 12),
    sha256: "",
    installedAt: Date.now(),
  });
  await fillCover(bookId, pack).catch(() => undefined);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cibian-covers"));
    window.dispatchEvent(new CustomEvent("cibian-progress", { detail: { bookId } }));
  }
  return bookId;
}
