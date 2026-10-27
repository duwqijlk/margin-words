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
  loadBookMeta,
  loadStoredBook,
  savePackRecord,
  type PackRecord,
  type StoredChapter,
} from "@/lib/book-db";
import { bookCatalogRef } from "@/lib/catalog-id";
import { uniqueBookRecord } from "@/lib/catalog-shelf-identity";
import { flowText } from "@/lib/flow-text";
import { fetchProtectedGlossary, remoteGlossaryId } from "@/lib/glossary-fetch";
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

export type ListUpdateToast = {
  id: number;
  /** titles whose list was replaced */
  updated: string[];
  /** how many tapped books kept their old list (the card says why) */
  failed: number;
};

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
  /** The last Update the reader tapped: what changed, for the message at the bottom of the screen. */
  toast: ListUpdateToast | null;
  dismiss: () => void;
  dismissToast: () => void;
  clearFailure: (packId: string) => void;
};

export const useListUpdates = create<ListUpdateState>()((set) => ({
  failures: {},
  holds: {},
  waiting: 0,
  finished: 0,
  toast: null,
  dismiss: () => set({ waiting: 0 }),
  dismissToast: () => set({ toast: null }),
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

async function readDirectList(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(tr("err.downloadFailed"));
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchListText(pack: WordListPack): Promise<string> {
  const glossaryUrl = resolveAgainst(WORD_LIST_CATALOG_URL, pack.glossary.url);
  const remoteId = remoteGlossaryId(glossaryUrl);
  const bytes = remoteId
    ? await fetchProtectedGlossary(pack.id, tr("err.downloadFailed"))
    : await readDirectList(glossaryUrl);
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
    await applyPackGlossary(record.bookId, text, record.packId, rev, "word-lists");
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
  const live = new Set(useVocab.getState().books.map((book) => book.id));
  const targets = new Set(records.filter((item) => item.packId === pack.id && live.has(item.bookId)).map((item) => item.bookId));
  const record = targets.size === 1 ? uniqueBookRecord(records, [...targets][0]!) : undefined;
  if (!record) throw new Error(tr("err.bookGone"));
  try {
    const maps = await loadCatalogMaps();
    const extras = await loadBookExtras(record.bookId).catch(() => null);
    const target = await catalogTarget(record, extras, maps);
    if (target.list?.id !== pack.id) throw new Error(tr("discover.missingCatalogIdentity"));
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

/** Stored catalog identity wins; a legacy bare id shared by both catalogs is not evidence. */
async function catalogTarget(record: PackRecord, extras: { source?: string; catalog?: "word-lists" | "public-books" } | null, maps: CatalogMaps) {
  const source = extras?.source === "custom" ? undefined : extras?.source;
  const id = source || record.packId;
  const ref = await bookCatalogRef({
    source, recorded: extras?.catalog, packId: record.packId,
    catalogOf: async (candidate) => {
      const classic = maps.classics.has(candidate);
      const list = maps.lists.has(candidate);
      return classic === list ? null : classic ? "public-books" : "word-lists";
    },
  });
  if (!ref) throw new Error(tr("discover.missingCatalogIdentity"));
  return {
    classic: ref === `public-books:${id}` ? maps.classics.get(id) : undefined,
    list: ref === `word-lists:${id}` ? maps.lists.get(id) : undefined,
  };
}

/**
 * Apply the current catalog list to one book already on the shelf. The reader tapped Update.
 * Throws on failure. A hand-edited list is left as it is.
 */
export async function updateInstalledBook(bookId: string): Promise<void> {
  const records = await listPackRecords();
  const record = uniqueBookRecord(records, bookId);
  if (!useVocab.getState().books.some((book) => book.id === bookId) || !record) throw new Error(tr("err.bookGone"));
  const extras = await loadBookExtras(bookId).catch(() => null);
  if (extras?.source === "custom") return;
  const maps = await loadCatalogMaps();
  try {
    const { classic, list } = await catalogTarget(record, extras, maps);
    if (classic) await downloadPack(classic.url, classic.pack, () => undefined, bookId);
    else if (list) await updateWordListBook({ ...record, packId: list.id }, list);
    else throw new Error(tr("err.downloadFailed"));
    useListUpdates.getState().clearFailure(`book:${record.bookId}`);
    markUpdated(record.packId);
  } catch (reason) {
    rememberFailure(record.packId, reason);
    rememberFailure(`book:${record.bookId}`, reason);
    throw reason;
  }
}

let toastId = 0;

/** The message at the bottom of the screen after the reader tapped Update. */
export function announceListUpdate(updated: string[], failed: number): void {
  if (updated.length === 0 && failed === 0) return;
  toastId += 1;
  useListUpdates.setState({ toast: { id: toastId, updated, failed } });
}

/**
 * The reader tapped Update (one card) or Update all (the shelf card). Books go one at a time,
 * so a slow or failing list does not hold up the others. `onStep` reports how many are done.
 * Never throws: a book that kept its old list is counted, and its card shows the reason.
 */
export async function updateInstalledBooks(
  books: readonly { bookId: string; title: string }[],
  onStep?: (done: number) => void,
): Promise<{ updated: string[]; failed: number }> {
  const updated: string[] = [];
  let failed = 0;
  for (const [index, book] of books.entries()) {
    try {
      await updateInstalledBook(book.bookId);
      updated.push(book.title);
    } catch {
      failed += 1;
    }
    onStep?.(index + 1);
  }
  announceListUpdate(updated, failed);
  return { updated, failed };
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
  const live = [...onShelf].map((id) => uniqueBookRecord(records, id)).filter((record): record is PackRecord => Boolean(record));
  if (live.length === 0) return;

  const maps = await loadCatalogMaps();
  const { classics, lists } = maps;
  if (classics.size === 0 && lists.size === 0) return;

  let waiting = 0;
  for (const record of live) {
    const extras = await loadBookExtras(record.bookId).catch(() => null);
    let target: Awaited<ReturnType<typeof catalogTarget>>;
    try { target = await catalogTarget(record, extras, maps); }
    catch (reason) { rememberFailure(`book:${record.bookId}`, reason); continue; }
    const { classic, list } = target;
    if (!classic && !list) continue;
    const catalogRev = classic ? classic.pack.rev : wordListRev(list as WordListPack);
    const catalogWords = list?.words ?? 0;
    // The revision string can already match while the stored list is an older file
    // (a cached copy paired under the new revision). The word count tells them apart.
    let installedWords: number | undefined;
    if (list && record.rev === catalogRev && catalogWords > 0) {
      const meta = await loadBookMeta(record.bookId).catch(() => null);
      if (meta) installedWords = Object.keys(meta.glossary ?? {}).length;
    }
    const countsMightDiffer =
      typeof installedWords === "number" && catalogWords > 0 && installedWords !== catalogWords;
    const shaDiffers = Boolean(classic?.pack.epub.sha256 && record.sha256 !== classic.pack.epub.sha256);
    if (record.rev === catalogRev && !countsMightDiffer && !shaDiffers) {
      useListUpdates.getState().clearFailure(record.packId);
      useListUpdates.getState().clearFailure(`book:${record.bookId}`);
      continue;
    }
    const plan = shaDiffers
      ? { kind: "manual" as const, why: extras?.source === "custom" ? "ownList" as const : "bookChanged" as const }
      : planListUpdate({
      installedRev: record.rev,
      catalogRev,
      listSource: extras?.source,
      installedSha: classic ? record.sha256 : "",
      catalogSha: classic ? classic.pack.epub.sha256 : "",
      installedWords,
      catalogWords,
    });
    if (plan.kind !== "manual") {
      if (record.rev === catalogRev) useListUpdates.getState().clearFailure(record.packId);
      continue;
    }
    rememberHold(record.packId, plan.why);
    rememberHold(`book:${record.bookId}`, plan.why);
    if (plan.why !== "ownList") waiting += 1;
  }
  useListUpdates.setState((prev) => ({
    finished: prev.finished + 1,
    waiting,
  }));
}
