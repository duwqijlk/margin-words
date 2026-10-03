/**
 * Clean-up that runs when the app starts, for data an older version left behind.
 *
 * 1. `repairShelf`: one book is one card. Two cards that are the same book (a "needs your e-book" card
 *    from Discover plus the card made by an import, as older versions did) become one. The kept card has
 *    the e-book, the saved words, the reading place and the cover of both.
 * 2. `refreshCovers`: a cover is saved once, when the book is added. A cover that was missing, or a
 *    catalog picture that has changed since, is fetched or worked out again. Needs the network only for
 *    catalog pictures; a missing cover of a stored book can also be found in the book itself.
 */
import { countFromBook } from "@/lib/wordbook";
import {
  deletePackRecord,
  deleteStoredBook,
  listBookSummaries,
  listPackRecords,
  loadAllCoverInfo,
  loadAllCovers,
  loadCover,
  loadStoredBook,
  saveCover,
  savePackRecord,
  type CoverInfo,
  type PackRecord,
} from "@/lib/book-db";
import { matchWordListPack } from "@/lib/book-meta";
import { fetchCoverData } from "@/lib/covers";
import { coverFromChapters } from "@/lib/epub";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst } from "@/lib/packs";
import { coverPlan, type CoverTarget } from "@/lib/cover-plan";
import { overallProgress, useProgress } from "@/lib/progress-store";
import { planMerges, sameAuthor, titleKeys, type ShelfEntry } from "@/lib/shelf-identity";
import { useVocab } from "@/lib/vocab-store";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";

/* ------------------------------------------------------------------ 1. duplicate cards */

/**
 * Merge cards that are the same book. Returns how many cards were folded into another.
 * A second card that holds its own stored e-book is only folded in when it has the very same title;
 * two different-looking e-books are never thrown away.
 */
export async function repairShelf(): Promise<number> {
  const vocab = useVocab.getState();
  const stored = new Set((await listBookSummaries().catch(() => [])).map((book) => book.id));
  const progress = useProgress.getState().items;
  const entries: ShelfEntry[] = vocab.books.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn ?? "",
    stored: stored.has(book.id),
    needsEpub: book.needsEpub === true,
    work:
      countFromBook(vocab.words, book) +
      (progress[book.id] && overallProgress(progress[book.id]) > 0 ? 1 : 0),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  }));
  const plans = planMerges(entries);
  if (plans.length === 0) return 0;

  let merged = 0;
  const records = await listPackRecords();
  for (const plan of plans) {
    const keep = plan.keep;
    const keepTitle = titleKeys(keep.title)[0];
    const drops = plan.drop.filter(
      (drop) => !drop.stored || (titleKeys(drop.title)[0] === keepTitle && sameAuthor(drop.author, keep.author)),
    );
    for (const drop of drops) {
      try {
        await foldInto(keep, drop, records);
        merged += 1;
      } catch {
        // One card that cannot be merged must not stop the others. The next start tries again.
      }
    }
    const state = useVocab.getState();
    if (state.books.some((book) => book.id === keep.id)) {
      state.setBookDetails([
        keep.stored || plan.drop.some((drop) => drop.stored)
          ? { id: keep.id, needsEpub: false, source: "epub" }
          : { id: keep.id },
      ]);
    }
  }
  if (merged > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("cibian-covers"));
    window.dispatchEvent(new CustomEvent("cibian-progress", { detail: {} }));
  }
  return merged;
}

async function foldInto(keep: ShelfEntry, drop: ShelfEntry, records: PackRecord[]): Promise<void> {
  // Cover: the kept card takes the other card's picture when it has none.
  const [keepCover, dropCover, infos] = await Promise.all([
    loadCover(keep.id).catch(() => ""),
    loadCover(drop.id).catch(() => ""),
    loadAllCoverInfo().catch(() => ({}) as Record<string, CoverInfo>),
  ]);
  if (!keepCover && dropCover) await saveCover(keep.id, dropCover, infos[drop.id]);

  // Where the book came from: a card that came from Discover has the catalog pack id, which Discover needs.
  const keepRecord = records.find((record) => record.bookId === keep.id);
  const dropRecord = records.find((record) => record.bookId === drop.id);
  if (dropRecord && (!keepRecord || (dropRecord.sha256 === "" && dropRecord.packId !== keepRecord.packId))) {
    await savePackRecord({
      packId: dropRecord.packId,
      bookId: keep.id,
      rev: keepRecord?.rev ?? dropRecord.rev,
      sha256: keepRecord?.sha256 ?? dropRecord.sha256,
      installedAt: keepRecord?.installedAt ?? dropRecord.installedAt,
    });
    if (keepRecord) keepRecord.packId = dropRecord.packId;
  }

  // Reading place: the one further along wins.
  const store = useProgress.getState();
  const mine = store.items[keep.id];
  const theirs = store.items[drop.id];
  if (theirs && (!mine || overallProgress(theirs) > overallProgress(mine))) store.save(keep.id, theirs);
  if (theirs) store.remove(drop.id);

  // Saved words, details and the card itself.
  useVocab.getState().mergeBook(keep.id, drop.id);
  if (dropRecord) await deletePackRecord(drop.id).catch(() => undefined);
  await deleteStoredBook(drop.id).catch(() => undefined);
}

/* ------------------------------------------------------------------ 2. covers */

const TRIED_KEY = "cibian-cover-tried-v1";

function triedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TRIED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function markTried(ids: Set<string>) {
  try {
    localStorage.setItem(TRIED_KEY, JSON.stringify([...ids]));
  } catch {
    // The next start looks again. Nothing breaks.
  }
}

async function sha256Of(dataUrl: string): Promise<string> {
  try {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/** Fetch or work out the covers that are missing or out of date. Returns how many cards got a new cover. */
export async function refreshCovers(): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  const books = useVocab.getState().books;
  if (books.length === 0) return 0;
  const [covers, infos, records, summaries] = await Promise.all([
    loadAllCovers().catch(() => ({}) as Record<string, string>),
    loadAllCoverInfo().catch(() => ({}) as Record<string, CoverInfo>),
    listPackRecords().catch(() => [] as PackRecord[]),
    listBookSummaries().catch(() => []),
  ]);
  const stored = new Set(summaries.map((book) => book.id));
  const [lists, classics] = await Promise.all([
    loadWordListCatalog().catch(() => null),
    loadCatalog(BUNDLED_CATALOG_URL).then((result) => (result.offline ? null : result.catalog.packs)).catch(() => null),
  ]);
  const tried = triedIds();
  let changed = 0;
  for (const book of books) {
    try {
      const record = records.find((item) => item.bookId === book.id);
      const classic = classics?.find((pack) => pack.id === record?.packId);
      const list =
        lists?.find((pack) => pack.id === record?.packId) ??
        (lists ? matchWordListPack(lists, { title: book.title, author: book.author, isbn: book.isbn ?? "" }) : null);
      let target: CoverTarget | null = null;
      if (classic?.cover?.url)
        target = { url: resolveAgainst(BUNDLED_CATALOG_URL, classic.cover.url), sha256: classic.cover.sha256 };
      else if (list?.cover?.url)
        target = { url: resolveAgainst(WORD_LIST_CATALOG_URL, list.cover.url), sha256: list.cover.sha256 };
      // Without a catalog (offline) a catalog picture cannot be judged, so only the book itself is used.
      const catalogKnown = Boolean(lists || classics);
      const have = covers[book.id] ?? "";
      const info = infos[book.id];
      const isStored = stored.has(book.id);
      const plan = coverPlan({
        have: Boolean(have),
        info,
        stored: isStored,
        target: catalogKnown ? target : null,
        haveSha: !info && have && target ? await sha256Of(have) : "",
      });
      const lookInBook = async () => {
        if (isStored && !tried.has(book.id) && (await derive(book.id, tried))) changed += 1;
      };
      if (plan === "tag" && target) {
        await saveCover(book.id, have, { source: "catalog", ref: target.sha256 });
      } else if (plan === "fetch" && target) {
        const data = await fetchCoverData(target.url, target.sha256);
        if (data) {
          await saveCover(book.id, data, { source: "catalog", ref: target.sha256 });
          changed += 1;
        } else if (!have) {
          await lookInBook();
        }
      } else if (plan === "derive") {
        await lookInBook();
      }
    } catch {
      // A card that fails is tried again next start.
    }
  }
  markTried(tried);
  return changed;
}

/** The portrait picture at the start of the stored book, as a cover. */
async function derive(bookId: string, tried: Set<string>): Promise<boolean> {
  tried.add(bookId);
  const book = await loadStoredBook(bookId).catch(() => null);
  if (!book) return false;
  const cover = await coverFromChapters(book.chapters).catch(() => null);
  if (!cover) return false;
  if (await loadCover(bookId).catch(() => "")) return false;
  await saveCover(bookId, cover, { source: "chapter", ref: "" });
  return true;
}
