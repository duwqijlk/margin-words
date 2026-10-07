/**
 * Word-list updates the reader chooses. When the app loads the catalogs (app start, and when
 * Discover opens), every installed book whose catalog revision changed is marked, for public-domain
 * packs and word-list books alike. Nothing is replaced until the reader taps Update on that card.
 * The tap replaces only the list: the EPUB, the reading place, saved words and settings stay.
 * The decisions are pure and live in src/lib/word-list-plan.ts:
 *   - a list the reader added or edited by hand is never replaced, not even by Update:
 *     the card says the edited list is kept and does not offer that button;
 *   - a classic whose BOOK file changed keeps Update, and the card says why;
 *   - a word-list book on the reader's own EPUB keeps its old list when the new one does not
 *     match that EPUB (the same edition check as the own-EPUB dialog), with the reason shown.
 * A hold stays on the shelf card and the Discover card. A banner says how many books are waiting.
 */
import { create } from "zustand";
import {
  listPackRecords,
  loadBookExtras,
  loadStoredBook,
  savePackRecord,
  type PackRecord,
  type StoredChapter,
} from "@/lib/book-db";
import { flowText } from "@/lib/flow-text";
import { errorText, tr } from "@/lib/i18n";
import { paragraphBlocks } from "@/lib/help-match";
import { applyPackGlossary, hashBytes } from "@/lib/pack-glossary";
import {
  BUNDLED_CATALOG_URL,
  downloadPack,
  getCatalogUrl,
  loadCatalog,
  resolveAgainst,
  type CatalogPack,
} from "@/lib/packs";
import { storeWordListText } from "@/lib/pair-epub";
import { useVocab } from "@/lib/vocab-store";
import {
  loadWordListCatalog,
  WORD_LIST_CATALOG_URL,
  type WordListPack,
} from "@/lib/word-list-catalog";
import {
  checkListAgainstBook,
  planListUpdate,
  wordListUpdateActions,
  type ListHoldWhy,
} from "@/lib/word-list-plan";

export { planListUpdate, checkListAgainstBook, wordListUpdateActions };

/** A new list that must not replace the stored one. `mismatch` is the under-80% edition check. */
export class ListUpdateBlock extends Error {
  readonly why: "mismatch" | "unreadable";
  constructor(why: "mismatch" | "unreadable", message: string) {
    super(message);
    this.name = "ListUpdateBlock";
    this.why = why;
  }
}

type ListUpdateState = {
  /** pack id -> plain-language reason its list was NOT replaced (shown under the Update button) */
  failures: Record<string, string>;
  /**
   * pack id -> why this book was left for the reader.
   * `ownList` is a note, not an Update button. The others keep the button.
   */
  holds: Record<string, ListHoldWhy>;
  /** how many installed books are waiting for Update (0 = say nothing) */
  waiting: number;
  /** goes up after every run, so Discover re-reads the pack records */
  finished: number;
  dismiss: () => void;
  clearFailure: (packId: string) => void;
};

export const useListUpdates = create<ListUpdateState>()((set) => ({
  failures: {},
  holds: {},
  waiting: 0,
  finished: 0,
  dismiss: () => set({ waiting: 0 }),
  clearFailure: (packId) =>
    set((state) => {
      if (!(packId in state.failures) && !(packId in state.holds)) return state;
      const failures = { ...state.failures };
      const holds = { ...state.holds };
      delete failures[packId];
      delete holds[packId];
      return { failures, holds };
    }),
}));

function rememberFailure(packId: string, reason: unknown): void {
  const text = errorText(reason, "err.downloadFailed");
  useListUpdates.setState((prev) => ({
    failures: { ...prev.failures, [packId]: text },
    holds:
      reason instanceof ListUpdateBlock && reason.why === "mismatch"
        ? { ...prev.holds, [packId]: "mismatch" }
        : prev.holds,
  }));
}

/** The card explains why this book was left for the reader. The sentence is translated at render. */
function rememberHold(packId: string, why: "ownList" | "bookChanged" | "newList"): void {
  useListUpdates.setState((prev) => ({
    holds: { ...prev.holds, [packId]: why },
  }));
}

/** The catalog revision of a word-list pack (place-word-list.ts stores the same value). */
export function wordListRev(pack: Pick<WordListPack, "id" | "glossary">): string {
  return pack.glossary.sha256.slice(0, 12) || pack.id;
}

/** The text of every paragraph of a stored book, for the edition check. */
function bookParagraphs(chapters: StoredChapter[]): string[] {
  const out: string[] = [];
  for (const chapter of chapters) {
    if (chapter.html && typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(`<div>${chapter.html}</div>`, "text/html");
      for (const block of paragraphBlocks(doc.body)) out.push(flowText(block));
    } else {
      out.push(...(chapter.paragraphs ?? []));
    }
  }
  return out;
}

async function fetchListText(pack: WordListPack): Promise<string> {
  const response = await fetch(resolveAgainst(WORD_LIST_CATALOG_URL, pack.glossary.url), {
    cache: "no-cache",
  });
  if (!response.ok) throw new Error(tr("err.downloadFailed"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha = await hashBytes(bytes);
  if (pack.glossary.sha256 && sha && pack.glossary.sha256 !== sha)
    throw new Error(tr("err.damaged"));
  return new TextDecoder().decode(bytes);
}

/**
 * Give one word-list book its new list. A card still waiting for the reader's e-book only
 * refreshes the saved list text; a book with the reader's own EPUB first passes the edition
 * check, and a list that does not fit stays out (the thrown Error says why).
 */
async function updateWordListBook(record: PackRecord, pack: WordListPack): Promise<void> {
  const rev = wordListRev(pack);
  const text = await fetchListText(pack);
  const stored = await loadStoredBook(record.bookId).catch(() => null);
  // A list the reader added or edited by hand stays theirs, also from the manual Update button
  // (the same rule installPack follows for classics): only the saved copy and the revision move on.
  const source = stored
    ? (await loadBookExtras(record.bookId).catch(() => null))?.source
    : undefined;
  const actions = wordListUpdateActions({ hasStoredBook: Boolean(stored), listSource: source });
  if (actions.applyGlossary && stored) {
    const check = checkListAgainstBook(text, bookParagraphs(stored.chapters));
    if (!check.ok)
      throw new ListUpdateBlock(
        check.problem === "unreadable" ? "unreadable" : "mismatch",
        check.problem === "unreadable"
          ? tr("err.packListUnreadable")
          : tr("lists.matchWarn", { n: check.percent }),
      );
    await applyPackGlossary(record.bookId, text, record.packId, rev);
    useVocab.getState().setBookDetails([{ id: record.bookId, matchRate: check.percent }]);
  }
  if (actions.saveText) await storeWordListText(pack.id, text);
  if (actions.saveRev) await savePackRecord({ ...record, rev });
}

function markUpdated(packId: string): void {
  useListUpdates.getState().clearFailure(packId);
  useListUpdates.setState((prev) => ({
    finished: prev.finished + 1,
    waiting: Math.max(0, prev.waiting - 1),
  }));
}

/** Retry one word-list book from its Discover card (the Update button). Throws on failure. */
export async function retryWordListUpdate(pack: WordListPack): Promise<void> {
  const records = await listPackRecords();
  const record = records.find((item) => item.packId === pack.id);
  if (!record) throw new Error(tr("err.bookGone"));
  try {
    await updateWordListBook(record, pack);
    markUpdated(pack.id);
  } catch (reason) {
    rememberFailure(pack.id, reason);
    throw reason;
  }
}

type CatalogMaps = {
  classics: Map<string, { pack: CatalogPack; url: string }>;
  lists: Map<string, WordListPack>;
};

async function loadCatalogMaps(): Promise<CatalogMaps> {
  const classics = new Map<string, { pack: CatalogPack; url: string }>();
  try {
    const { catalog } = await loadCatalog(BUNDLED_CATALOG_URL);
    for (const pack of catalog.packs) classics.set(pack.id, { pack, url: BUNDLED_CATALOG_URL });
  } catch {
    // Offline or no catalog: the word-list catalog below may still answer.
  }
  const custom = getCatalogUrl();
  if (custom !== BUNDLED_CATALOG_URL) {
    try {
      const { catalog } = await loadCatalog(custom);
      for (const pack of catalog.packs) classics.set(pack.id, { pack, url: custom });
    } catch {
      // The extra list is optional.
    }
  }
  const lists = new Map<string, WordListPack>();
  try {
    for (const pack of await loadWordListCatalog()) lists.set(pack.id, pack);
  } catch {
    // The word-list catalog is optional.
  }
  return { classics, lists };
}

/**
 * Apply the current catalog list to one book already on the shelf. The reader tapped Update.
 * Throws on failure. A hand-edited list is left as it is.
 */
export async function updateInstalledBook(bookId: string): Promise<void> {
  const records = await listPackRecords();
  const record = records.find((item) => item.bookId === bookId);
  if (!record) throw new Error(tr("err.bookGone"));
  const source = (await loadBookExtras(bookId).catch(() => null))?.source;
  if (source === "custom") return;
  const { classics, lists } = await loadCatalogMaps();
  const classic = classics.get(record.packId);
  const list = classic ? undefined : lists.get(record.packId);
  try {
    if (classic) await downloadPack(classic.url, classic.pack, () => undefined);
    else if (list) await updateWordListBook(record, list);
    else throw new Error(tr("err.downloadFailed"));
    markUpdated(record.packId);
  } catch (reason) {
    rememberFailure(record.packId, reason);
    throw reason;
  }
}

let running: Promise<void> | null = null;
/** A call arrived while a run was already going. One more run follows. */
let queued = false;

/**
 * Notice installed books whose catalog revision changed, and offer Update.
 * Never replaces a list. Never throws.
 * A second call during a run is not dropped.
 */
export function autoUpdateWordLists(): Promise<void> {
  if (running) {
    queued = true;
    return running;
  }
  running = runUpdates()
    .catch(() => undefined)
    .finally(() => {
      running = null;
      if (queued) {
        queued = false;
        void autoUpdateWordLists();
      }
    });
  return running;
}

async function runUpdates(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const records = await listPackRecords().catch(() => [] as PackRecord[]);
  if (records.length === 0) return;
  const onShelf = new Set(useVocab.getState().books.map((book) => book.id));
  const live = records.filter((record) => onShelf.has(record.bookId));
  if (live.length === 0) return;

  const { classics, lists } = await loadCatalogMaps();
  if (classics.size === 0 && lists.size === 0) return;

  let waiting = 0;
  for (const record of live) {
    const classic = classics.get(record.packId);
    const list = classic ? undefined : lists.get(record.packId);
    if (!classic && !list) continue;
    const catalogRev = classic ? classic.pack.rev : wordListRev(list as WordListPack);
    if (record.rev === catalogRev) {
      useListUpdates.getState().clearFailure(record.packId);
      continue;
    }
    const extras = await loadBookExtras(record.bookId).catch(() => null);
    const plan = planListUpdate({
      installedRev: record.rev,
      catalogRev,
      listSource: extras?.source,
      installedSha: classic ? record.sha256 : "",
      catalogSha: classic ? classic.pack.epub.sha256 : "",
    });
    if (plan.kind !== "manual") continue;
    rememberHold(record.packId, plan.why);
    if (plan.why !== "ownList") waiting += 1;
  }
  useListUpdates.setState((prev) => ({
    finished: prev.finished + 1,
    waiting,
  }));
}
