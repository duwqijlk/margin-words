/**
 * Public-domain books that ship with the app (./public-books/).
 *
 * ADDING MORE BOOKS: nothing here lists book ids. Every pack in public-books/catalog.json is a "classic".
 * To add one, drop a folder public-books/<id>/ with book.epub, glossary.json, optional cover.jpg and
 * info.json ({"title","author","order"}), then run `node scripts/build-packs.mjs --out public-books`
 * (see public-books/README.md). The other classics are listed on Discover and download when the reader
 * taps the heart on the cover. No book is put on the shelf by itself: a new shelf is empty, and Alice's
 * Adventures in Wonderland is an ordinary classic like the others (it is only suggested on the empty shelf,
 * with a one-tap add). Books already stored on this device stay where they are, and a book the reader
 * deletes stays deleted. An older hosted catalog may still carry `"preinstall": true`; it is ignored.
 *
 * On start this file only copies Lexile, ISBN, series and the old-fashioned flag from the catalogs onto
 * books that are already on the shelf.
 */
import { create } from "zustand";
import { useEffect, useState } from "react";
import { listPackRecords } from "@/lib/book-db";
import { useDownloads } from "@/lib/downloads";
import { BUNDLED_CATALOG_URL, getCatalogUrl, loadCatalog, type CatalogPack } from "@/lib/packs";
import { loadWordListCatalog, type WordListPack } from "@/lib/word-list-catalog";
import { useVocab } from "@/lib/vocab-store";

/** Kept for the shelf placeholder: nothing is installed by itself any more, so this is always false. */
export const useClassicsRunning = create<{ running: boolean }>()(() => ({ running: false }));

let once: Promise<void> | null = null;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error("failed"));
      },
    );
  });

/**
 * Copy the catalog facts (Lexile, ISBN, series) onto books already on the shelf. Never throws.
 */
export function ensureClassics(): Promise<void> {
  if (!once) once = run();
  return once;
}

type FactSource = {
  id: string;
  lexile: string;
  isbn: string;
  series: string;
  seriesNumber: number;
  oldFashioned: boolean;
  oldFashionedReason: string;
};

/** Copy Lexile, ISBN, series and the old-fashioned flag onto books already on the shelf (no re-download). */
async function rememberFacts(packs: FactSource[]): Promise<void> {
  if (packs.length === 0) return;
  const byPack = new Map(packs.map((pack) => [pack.id, pack]));
  const records = await listPackRecords();
  const books = useVocab.getState().books;
  const pairs: Array<{
    id: string;
    lexile?: string;
    isbn?: string;
    series?: string;
    seriesNumber?: number;
    oldFashioned?: boolean;
    oldFashionedReason?: string;
  }> = [];
  for (const record of records) {
    const fact = byPack.get(record.packId);
    if (!fact) continue;
    const book = books.find((item) => item.id === record.bookId);
    if (!book) continue;
    const pair: (typeof pairs)[number] = { id: book.id };
    let changed = false;
    if (fact.lexile && book.lexile !== fact.lexile) {
      pair.lexile = fact.lexile;
      changed = true;
    }
    if (fact.isbn && book.isbn !== fact.isbn) {
      pair.isbn = fact.isbn;
      changed = true;
    }
    if (
      fact.series &&
      (book.series !== fact.series || (book.seriesNumber ?? 0) !== (fact.seriesNumber || 0))
    ) {
      pair.series = fact.series;
      pair.seriesNumber = fact.seriesNumber || 0;
      changed = true;
    }
    if (
      fact.oldFashioned !== Boolean(book.oldFashioned) ||
      (fact.oldFashioned && (book.oldFashionedReason ?? "") !== fact.oldFashionedReason)
    ) {
      pair.oldFashioned = fact.oldFashioned;
      pair.oldFashionedReason = fact.oldFashionedReason;
      changed = true;
    }
    if (changed) pairs.push(pair);
  }
  if (pairs.length > 0) useVocab.getState().setBookDetails(pairs);
}

function asFacts(pack: CatalogPack | WordListPack): FactSource {
  return {
    id: pack.id,
    lexile: pack.lexile,
    isbn: pack.isbn,
    series: pack.series,
    seriesNumber: pack.seriesNumber,
    oldFashioned: pack.oldFashioned,
    oldFashionedReason: pack.oldFashionedReason,
  };
}

async function run(): Promise<void> {
  try {
    const { catalog } = await withTimeout(loadCatalog(BUNDLED_CATALOG_URL), 8000);
    await rememberFacts(catalog.packs.map(asFacts));
    try {
      const lists = await withTimeout(loadWordListCatalog(), 5000);
      await rememberFacts(lists.map(asFacts));
    } catch {
      // The word-list catalog is optional.
    }
    const custom = getCatalogUrl();
    if (custom !== BUNDLED_CATALOG_URL) {
      try {
        const extra = await withTimeout(loadCatalog(custom), 5000);
        await rememberFacts(extra.catalog.packs.map(asFacts));
      } catch {
        // The extra list is optional.
      }
    }
  } catch {
    // Offline, or no bundled catalog: nothing to do.
  }
}

/** Pack ids listed in the bundled catalog (read once; empty when it cannot be loaded). */
let bundledIds: Promise<Set<string>> | null = null;
function bundledPackIds(): Promise<Set<string>> {
  if (!bundledIds)
    bundledIds = loadCatalog(BUNDLED_CATALOG_URL)
      .then(({ catalog }) => new Set(catalog.packs.map((pack) => pack.id)))
      .catch(() => {
        bundledIds = null;
        return new Set<string>();
      });
  return bundledIds;
}

/** Ids of the books on the shelf that came from a bundled classic (to show the "Public domain" label). */
export function useClassicBookIds(bookKey: string): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const finished = useDownloads((state) => state.finished);
  useEffect(() => {
    let alive = true;
    void Promise.all([listPackRecords(), bundledPackIds()])
      .then(([records, packs]) => {
        if (alive) setIds(new Set(records.filter((r) => packs.has(r.packId)).map((r) => r.bookId)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bookKey, finished]);
  return ids;
}
