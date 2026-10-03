/**
 * Automatic word-list updates. When the app loads the catalogs (app start, and when Discover
 * opens), every installed book whose catalog revision changed gets its NEW WORD LIST quietly, one
 * book at a time, for public-domain packs and word-list books alike. Only the list is replaced:
 * the EPUB, the reading place, saved words and settings stay. The decisions are pure and live in
 * src/lib/word-list-plan.ts:
 *   - a list the reader added or edited by hand is never replaced, not even by the manual
 *     Update button: the card says the edited list is kept and does not offer that button;
 *   - a classic whose BOOK file changed is left to the manual Update button on Discover;
 *   - a word-list book on the reader's own EPUB keeps its old list when the new one does not
 *     match that EPUB (the same edition check as the own-EPUB dialog), with the reason shown;
 *   - offline, and the book open in the reader, wait for the next load.
 * A hold stays on the Discover card with its reason (Update, or a note when the list is the
 * reader's own). The next app load tries a quiet update again.
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
import { parsePath } from "@/lib/router";
import { useVocab } from "@/lib/vocab-store";
import {
  loadWordListCatalog,
  WORD_LIST_CATALOG_URL,
  type WordListPack,
} from "@/lib/word-list-catalog";
import {
  checkListAgainstBook,
  holdReasonKey,
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
   * pack id -> why the quiet update left this book alone.
   * `ownList` is a note, not an Update button. The other two keep the button.
   */
  holds: Record<string, ListHoldWhy>;
  /** how many books got a new list in the last quiet run (0 = say nothing) */
  updated: number;
  /** goes up after every run, so Discover re-reads the pack records */
  finished: number;
  dismiss: () => void;
  clearFailure: (packId: string) => void;
};

export const useListUpdates = create<ListUpdateState>()((set) => ({
  failures: {},
  holds: {},
  updated: 0,
  finished: 0,
  dismiss: () => set({ updated: 0 }),
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

/** The card explains why this book was left for the reader. The text follows the current language. */
function rememberHold(packId: string, why: "ownList" | "bookChanged"): void {
  useListUpdates.setState((prev) => ({
    failures: { ...prev.failures, [packId]: tr(holdReasonKey(why)) },
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

/** Retry one word-list book from its Discover card (the manual Update button). Throws on failure. */
export async function retryWordListUpdate(pack: WordListPack): Promise<void> {
  const records = await listPackRecords();
  const record = records.find((item) => item.packId === pack.id);
  if (!record) throw new Error(tr("err.bookGone"));
  const state = useListUpdates.getState();
  try {
    await updateWordListBook(record, pack);
    state.clearFailure(pack.id);
    useListUpdates.setState((prev) => ({ finished: prev.finished + 1 }));
  } catch (reason) {
    rememberFailure(pack.id, reason);
    throw reason;
  }
}

/** The book open in the reader right now, or "". Its list waits for the next open. */
function readingBookId(): string {
  if (typeof window === "undefined") return "";
  const route = parsePath(window.location.pathname);
  return route?.kind === "read" ? route.bookId : "";
}

/** packs tried this session (packId@rev): a failure is not retried until the next app load. */
const attempted = new Set<string>();
let running: Promise<void> | null = null;

/** Quietly update the word lists of installed books whose catalog revision changed. Never throws. */
export function autoUpdateWordLists(): Promise<void> {
  if (!running) {
    running = runUpdates()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
  }
  return running;
}

async function runUpdates(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const records = await listPackRecords().catch(() => [] as PackRecord[]);
  if (records.length === 0) return;
  const onShelf = new Set(useVocab.getState().books.map((book) => book.id));
  const live = records.filter((record) => onShelf.has(record.bookId));
  if (live.length === 0) return;

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
  if (classics.size === 0 && lists.size === 0) return;

  const reading = readingBookId();
  const titleOf = (bookId: string) =>
    useVocab.getState().books.find((book) => book.id === bookId)?.title ?? "";
  let updated = 0;
  // One book at a time, quietly; a failure is kept for the manual Update button.
  for (const record of live) {
    const classic = classics.get(record.packId);
    const list = classic ? undefined : lists.get(record.packId);
    if (!classic && !list) continue;
    const catalogRev = classic ? classic.pack.rev : wordListRev(list as WordListPack);
    if (record.rev === catalogRev) continue;
    const key = `${record.packId}@${catalogRev}`;
    if (attempted.has(key)) continue;
    const extras = await loadBookExtras(record.bookId).catch(() => null);
    const plan = planListUpdate({
      installedRev: record.rev,
      catalogRev,
      listSource: extras?.source,
      installedSha: classic ? record.sha256 : "",
      catalogSha: classic ? classic.pack.epub.sha256 : "",
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      reading: record.bookId === reading,
    });
    if (plan.kind === "none" || plan.kind === "wait") continue;
    attempted.add(key);
    if (plan.kind === "manual") {
      rememberHold(record.packId, plan.why);
      continue;
    }
    try {
      if (classic) await downloadPack(classic.url, classic.pack, () => undefined);
      else await updateWordListBook(record, list as WordListPack);
      updated += 1;
      useListUpdates.getState().clearFailure(record.packId);
      if (import.meta.env.DEV)
        console.info(`[word lists] updated "${titleOf(record.bookId)}" to ${catalogRev}`);
    } catch (reason) {
      rememberFailure(record.packId, reason);
    }
  }
  useListUpdates.setState((prev) => ({
    finished: prev.finished + 1,
    ...(updated > 0 ? { updated } : {}),
  }));
}
