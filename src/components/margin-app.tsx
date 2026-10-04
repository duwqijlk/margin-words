import { AlertCircle, BookOpen, CheckCircle2, CircleHelp, Compass, Heart, Library, NotebookPen, Settings, UserRound, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  bookFileExists,
  checkBookStorage,
  listBookSummaries,
  loadBookMeta,
  loadNotes,
  loadPackRecord,
  patchStoredBook,
  purgeLegacyHelpCache,
  requestPersistentStorage,
} from "@/lib/book-db";
import { readGlossaryFile } from "@/lib/glossary-import";
import { canAddBooks, askToSignIn } from "@/lib/can-add";
import { ensureClassics } from "@/lib/classics";
import { useProgress } from "@/lib/progress-store";
import { tr, trn, useT } from "@/lib/i18n";
import { applyTheme, usePrefs } from "@/lib/reader-prefs";
import { summarize } from "@/lib/srs";
import type { VocabEntry } from "@/lib/vocab-model";
import { markVocabHydrated, normalizeWord, useVocab } from "@/lib/vocab-store";
import { useCovers } from "@/components/book-cover";
import { ShelfToastHost } from "@/components/shelf-actions";
import { finishPendingRemoval, useShelfRemove } from "@/lib/shelf-remove";
import { SpineWarningList } from "@/components/spine-warnings";
import { btn, cn } from "@/components/ui";
import type { SpineNameWarning } from "@/lib/epub";
import { LanguageButton } from "@/components/language";
import type { ListFlow } from "@/components/word-list";
import { NoticeBar } from "@/components/notice-bar";
import { DEFAULT_ROUTE, menuOf, navigate, pathNeedsRedirect, useRoute, type Route } from "@/lib/router";
import { refreshCovers, repairShelf } from "@/lib/shelf-repair";
import { useAccount } from "@/lib/account-store";
import { notifySyncReady, startAccountSync } from "@/lib/sync-engine";
import { AccountDialog } from "@/components/account-dialog";
import { autoUpdateWordLists, useListUpdates } from "@/lib/word-list-update";
import { rememberListPack, resolveFileOffer } from "@/lib/file-gap";

type Screen = Route;

/**
 * Books saved by an older version keep working. This runs once: it removes the saved answers
 * of the old online helper and clears the old list of words that were waiting to be looked up.
 * Word meanings, saved words and reading places are not touched.
 */
async function migrateOldData(): Promise<void> {
  const KEY = "cibian-static-migrated-v1";
  try {
    if (localStorage.getItem(KEY)) return;
    await purgeLegacyHelpCache();
    for (const book of await listBookSummaries()) {
      const meta = await loadBookMeta(book.id);
      if (meta && meta.pending.length > 0) {
        await patchStoredBook(book.id, (latest) => {
          latest.pending = [];
          latest.totalHard = Object.keys(latest.glossary).length;
        });
      }
    }
    localStorage.setItem(KEY, "1");
  } catch {
    // Try again next time.
  }
}

// Each page is its own chunk: the first visit loads only the page that was asked for.
const Shelf = lazy(() => import("@/components/shelf").then((m) => ({ default: m.Shelf })));
const Notebook = lazy(() => import("@/components/notebook").then((m) => ({ default: m.Notebook })));
const DiscoverScreen = lazy(() => import("@/components/discover").then((m) => ({ default: m.DiscoverScreen })));
const GuideScreen = lazy(() => import("@/components/guide-page").then((m) => ({ default: m.GuideScreen })));
const ThanksScreen = lazy(() => import("@/components/thanks-page").then((m) => ({ default: m.ThanksScreen })));
const SettingsDialog = lazy(() => import("@/components/get-books").then((m) => ({ default: m.SettingsDialog })));
const OwnEpubDialog = lazy(() => import("@/components/own-epub-dialog").then((m) => ({ default: m.OwnEpubDialog })));
const ReaderScreen = lazy(() => import("@/components/reader").then((m) => ({ default: m.ReaderScreen })));
const ReviewScreen = lazy(() => import("@/components/review").then((m) => ({ default: m.ReviewScreen })));
const WordListDialog = lazy(() => import("@/components/word-list").then((m) => ({ default: m.WordListDialog })));

const setScreen = (route: Route) => navigate(route);

export function MarginApp() {
  const { t, tn } = useT();
  const books = useVocab((state) => state.books);
  const words = useVocab((state) => state.words);
  const addDemo = useVocab((state) => state.addDemo);
  const restoreBooks = useVocab((state) => state.restoreBooks);
  const replaceWords = useVocab((state) => state.replaceWords);
  const theme = usePrefs((state) => state.theme);
  const [ready, setReady] = useState(false);
  const screen: Screen = useRoute();
  const [epubFor, setEpubFor] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listRef = useRef<HTMLInputElement>(null);
  const listTarget = useRef<string | null>(null);
  const [listFlow, setListFlow] = useState<ListFlow | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [spineWarnings, setSpineWarnings] = useState<SpineNameWarning[]>([]);
  const listsUpdated = useListUpdates((state) => state.updated);
  const dismissListsUpdated = useListUpdates((state) => state.dismiss);
  const [storedIds, setStoredIds] = useState<Set<string> | null>(null);
  const opening = useRef(false);
  // The previous screen, so closing the reader can retry a word-list update that waited.
  const wasReading = useRef(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token) useAccount.getState().openDialog("reset", token);
    return startAccountSync();
  }, []);

  // "/" and any address that is not a page go to the bookshelf, without adding a history entry.
  // /about is the old About page: it is the Guide now, so the address becomes /guide.
  // popstate covers a Back press that lands on an old /about entry.
  useEffect(() => {
    const fix = () => {
      if (pathNeedsRedirect()) navigate(DEFAULT_ROUTE, { replace: true });
      else if (window.location.pathname === "/about") navigate({ kind: "guide" }, { replace: true });
    };
    fix();
    window.addEventListener("popstate", fix);
    return () => window.removeEventListener("popstate", fix);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([
          useVocab.persist.rehydrate(),
          usePrefs.persist.rehydrate(),
          useProgress.persist.rehydrate(),
        ]);
      } catch {
        // The shelf can still be rebuilt from the saved books.
      }
      markVocabHydrated();
      await finishPendingRemoval();
      try {
        // Summaries only: loading every chapter and image here made the shelf slow.
        const [storedResult, notesResult] = await Promise.allSettled([
          listBookSummaries(),
          loadNotes(),
        ]);
        if (storedResult.status === "fulfilled") {
          restoreBooks(storedResult.value);
          setStoredIds(new Set(storedResult.value.map((book) => book.id)));
        }
        const notes = notesResult.status === "fulfilled" ? notesResult.value : [];
        if (useVocab.getState().words.length === 0 && notes.length > 0) {
          const saved = notes.filter(
            (item): item is VocabEntry =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as VocabEntry).id === "string" &&
              typeof (item as VocabEntry).lemma === "string",
          );
          if (saved.length > 0) replaceWords(saved);
        } else {
          // Re-save once so old cards get their new schedule fields.
          const current = useVocab.getState().words;
          if (current.some((word) => typeof word.stage !== "number"))
            replaceWords(current.map(normalizeWord));
        }
      } catch {
        // Keep whatever was already on this device.
      }
      try {
        await repairShelf();
      } catch {
        // Two cards of one book are a nuisance, not a reason to stop: the next start tries again.
      }
      void migrateOldData();
      // Tell the user up front if this browser cannot keep books.
      void checkBookStorage().then((state) => {
        setStorageWarning(state.ok ? null : state.reason);
        if (state.ok) void requestPersistentStorage();
      });
      void ensureClassics().finally(() => void refreshCovers().catch(() => undefined));
      // Installed books whose catalog revision changed get their new word list in the background.
      void autoUpdateWordLists();
      notifySyncReady();
      setReady(true);
    })();
  }, [replaceWords, restoreBooks]);

  useEffect(() => {
    const refreshStored = () => {
      void listBookSummaries()
        .then((rows) => setStoredIds(new Set(rows.map((book) => book.id))))
        .catch(() => undefined);
    };
    window.addEventListener("cibian-progress", refreshStored);
    return () => window.removeEventListener("cibian-progress", refreshStored);
  }, []);

  const orderedBooks = useMemo(() => [...books].sort((a, b) => b.updatedAt - a.updatedAt), [books]);
  const covers = useCovers(books.map((book) => book.id));
  const due = useMemo(() => summarize(words).due, [words]);

  // If the book on screen was deleted (here or in another tab), fall back to the shelf.
  useEffect(() => {
    if (!ready) return;
    if ("bookId" in screen && screen.bookId && !books.some((book) => book.id === screen.bookId)) {
      navigate(DEFAULT_ROUTE, { replace: true });
    }
  }, [ready, books, screen]);

  function clearMessages() {
    setNotes([]);
    setImportError(null);
    setSpineWarnings([]);
  }

  /**
   * A word list (.json) for a book already on the shelf, from the book-menu picker. Books
   * themselves are added only on Discover (download, or the own-EPUB dialog of a word-list card).
   */
  async function takeListFile(file: File | undefined) {
    if (!ready || !file) return;
    clearMessages();
    try {
      const check = await readGlossaryFile(file);
      setListFlow({ fileName: file.name, check, bookId: listTarget.current });
    } catch {
      setImportError(t("err.listUnreadable"));
    }
  }

  async function openListPicker(bookId: string | null) {
    listTarget.current = bookId;
    listRef.current?.click();
  }

  /** Open the own-EPUB dialog. Importing the reader's own e-book completes an add: it needs the account too. */
  async function askForEpub(bookId: string) {
    if (!canAddBooks(useAccount.getState().phase)) {
      askToSignIn();
      return;
    }
    const known = await loadPackRecord(bookId).catch(() => null);
    if (!known) {
      const book =
        useVocab.getState().books.find((item) => item.id === bookId) ??
        books.find((item) => item.id === bookId);
      if (book) {
        const { offer } = await resolveFileOffer(book).catch(() => ({ offer: { kind: "discover" as const } }));
        if (offer.kind === "epub") await rememberListPack(bookId, offer.packId).catch(() => undefined);
      }
    }
    setEpubFor(bookId);
  }

  async function openBook(bookId: string) {
    if (opening.current) return;
    opening.current = true;
    try {
      // The store updates before React re-renders, so a book just added is visible here.
      const book =
        useVocab.getState().books.find((item) => item.id === bookId) ??
        books.find((item) => item.id === bookId);
      if (!book || book.source !== "epub") {
        if (book) setScreen({ kind: "words", bookId });
        return;
      }
      const here = !book.needsEpub && (await bookFileExists(bookId).catch(() => false));
      if (here) {
        setScreen({ kind: "read", bookId });
        return;
      }
      // The card stays. A word-list book asks for the EPUB here. A classic downloads from the reader.
      const { offer } = await resolveFileOffer(book).catch(() => ({ offer: { kind: "discover" as const } }));
      if (offer.kind === "epub") {
        await rememberListPack(bookId, offer.packId).catch(() => undefined);
        if (!canAddBooks(useAccount.getState().phase)) {
          askToSignIn();
          return;
        }
        setEpubFor(bookId);
        return;
      }
      setScreen({ kind: "read", bookId });
    } finally {
      opening.current = false;
    }
  }

  useEffect(() => {
    if (screen.kind === "shelf") useShelfRemove.getState().dismissNotice();
  }, [screen.kind]);
  // A list update skips the book that is open. Ask again as soon as that page closes,
  // so the shelf can say the lists were updated and the next open reads the new list.
  useEffect(() => {
    const leftReader = wasReading.current && screen.kind !== "read";
    wasReading.current = screen.kind === "read";
    if (leftReader) void autoUpdateWordLists();
  }, [screen.kind]);
  const reading = screen.kind === "read";
  const menu = menuOf(screen);
  const tabs = [
    {
      id: "shelf",
      label: t("nav.shelf"),
      Icon: Library,
      active: menu === "shelf",
      go: () => setScreen({ kind: "shelf" }),
      badge: 0,
    },
    {
      id: "discover",
      label: t("nav.discover"),
      Icon: Compass,
      active: menu === "discover",
      go: () => setScreen({ kind: "discover" }),
      badge: 0,
    },
    {
      id: "guide",
      label: t("nav.guide"),
      Icon: CircleHelp,
      active: menu === "guide",
      go: () => setScreen({ kind: "guide" }),
      badge: 0,
    },
    {
      id: "notebook",
      label: t("nav.notebook"),
      Icon: NotebookPen,
      active: menu === "words",
      go: () => setScreen({ kind: "words", bookId: null }),
      badge: due,
    },
  ];
  return (
    <div
      className={cn("min-h-dvh bg-paper text-ink", !reading && "max-sm:pb-[calc(4.25rem+env(safe-area-inset-bottom))]")}
    >
      {/* The only file input of the app: a word list (.json) for a book that is already on the shelf.
          Books themselves are added only on Discover. */}
      <input
        ref={listRef}
        id="list-file"
        className="sr-only"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void takeListFile(file);
        }}
      />
      {spineWarnings.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-40 px-4">
          <div className="pointer-events-auto mx-auto max-w-6xl">
            <Banner tone="warn" onClose={() => setSpineWarnings([])}>
              <SpineWarningList warnings={spineWarnings} />
            </Banner>
          </div>
        </div>
      ) : null}
      {reading ? null : <NoticeBar />}
      {reading ? null : (
        <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:gap-2 sm:px-6">
            <button
              type="button"
              className="mr-1 flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 font-display text-xl font-semibold"
              onClick={() => setScreen({ kind: "shelf" })}
              aria-label={t("common.brand")}
            >
              <BookOpen className="size-6 text-accent" aria-hidden />
              <span className="max-sm:sr-only">{t("common.brand")}</span>
            </button>
            <nav className="hidden min-w-0 flex-1 items-center gap-1 sm:flex" aria-label={t("nav.main")}>
              {tabs.map((tab) => (
                <NavButton key={tab.id} active={tab.active} onClick={tab.go}>
                  {tab.label}
                  {tab.badge > 0 ? <DueBadge n={tab.badge} /> : null}
                </NavButton>
              ))}
            </nav>
            <div className="min-w-0 flex-1 sm:hidden" />
            <button
              type="button"
              className={cn(
                btn.icon,
                "w-auto gap-1.5 px-2.5",
                menu === "thanks" && "bg-accent-soft text-accent",
              )}
              onClick={() => setScreen({ kind: "thanks" })}
              aria-label={t("nav.thanks")}
              aria-current={menu === "thanks" ? "page" : undefined}
              data-thanks-nav
            >
              <Heart className={cn("size-5", menu === "thanks" ? "fill-accent text-accent" : "")} aria-hidden />
              <span className="hidden text-sm font-semibold lg:inline">{t("nav.thanks")}</span>
            </button>
            <LanguageButton />
            <button
              type="button"
              className={cn(btn.icon, "size-11")}
              onClick={() => useAccount.getState().openDialog()}
              aria-label={t("nav.account")}
              data-account-button
            >
              <UserRound className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              className={cn(btn.icon, "size-11")}
              onClick={() => setSettingsOpen(true)}
              aria-label={t("nav.settings")}
            >
              <Settings className="size-5" aria-hidden />
            </button>
          </div>
        </header>
      )}

      {reading ? null : (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
          aria-label={t("nav.main")}
          data-tab-bar
        >
          <div className="mx-auto grid max-w-md grid-cols-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={tab.go}
                aria-current={tab.active ? "page" : undefined}
                className={cn(
                  "group flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-1 text-[0.72rem] leading-none font-semibold transition-colors",
                  tab.active ? "text-accent" : "text-muted active:text-ink",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    tab.active ? "bg-accent-soft" : "group-active:bg-accent-soft/60",
                  )}
                >
                  <tab.Icon className="size-[1.35rem]" strokeWidth={tab.active ? 2.4 : 2} aria-hidden />
                  {tab.badge > 0 ? (
                    <span className="absolute top-0 right-1.5">
                      <DueBadge n={tab.badge} />
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {reading ? null : (
        <div className="mx-auto grid max-w-6xl gap-2 px-4 pt-4 empty:hidden sm:px-6">
          {importError ? (
            <Banner tone="warn" onClose={() => setImportError(null)}>
              {importError}
            </Banner>
          ) : null}
          {listsUpdated > 0 ? (
            <Banner tone="good" onClose={dismissListsUpdated} data-lists-updated>
              {tn("msg.listsUpdated", listsUpdated)}
            </Banner>
          ) : null}
          {notes.length > 0 ? (
            <Banner tone="good" onClose={() => setNotes([])}>
              <ul className="grid gap-0.5">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {storageWarning ? <Banner tone="warn">{storageWarning}</Banner> : null}
        </div>
      )}

      <Suspense fallback={<div className="min-h-[60dvh]" aria-busy="true" />}>
        {!ready && screen.kind !== "shelf" ? (
          <div className="min-h-[60dvh]" aria-busy="true" />
        ) : (
          <>
          {screen.kind === "read" ? (
            <ReaderScreen
              key={screen.bookId}
              bookId={screen.bookId}
              onBack={() => setScreen({ kind: "shelf" })}
              onNotebook={() => setScreen({ kind: "words", bookId: screen.bookId })}
              onAddEpub={() => void askForEpub(screen.bookId)}
              onDiscover={() => setScreen({ kind: "discover" })}
            />
          ) : screen.kind === "guide" ? (
            <GuideScreen />
          ) : screen.kind === "thanks" ? (
            <ThanksScreen />
          ) : screen.kind === "discover" ? (
            <DiscoverScreen
              shelf={orderedBooks}
              onOpen={openBook}
              onNeedsEpub={askForEpub}
            />
          ) : screen.kind === "words" ? (
            <Notebook
              books={orderedBooks}
              words={words}
              bookId={screen.bookId}
              onBookChange={(bookId) => setScreen({ kind: "words", bookId })}
              onReview={(bookId) => setScreen({ kind: "review", bookId })}
              onOpenBook={openBook}
            />
          ) : screen.kind === "review" ? (
            <ReviewScreen
              books={orderedBooks}
              words={words}
              bookId={screen.bookId}
              onBack={() => setScreen({ kind: "words", bookId: screen.bookId })}
            />
          ) : (
            <Shelf
              books={orderedBooks}
              words={words}
              covers={covers}
              ready={ready}
              onOpen={(bookId) => void openBook(bookId)}
              storedIds={storedIds}
              onNotebook={(bookId) => setScreen({ kind: "words", bookId })}
              onAddList={(bookId) => void openListPicker(bookId)}
              onDemo={() => {
                if (!ready) return;
                const id = addDemo();
                setScreen({ kind: "words", bookId: id });
              }}
            />
          )}
          </>
        )}
      </Suspense>
      <Suspense fallback={null}>
        {epubFor !== null ? (
          <OwnEpubDialog
            bookId={epubFor}
            onClose={() => setEpubFor(null)}
            onSaved={(bookId, warnings) => {
              setEpubFor(null);
              if (warnings.length > 0) setSpineWarnings(warnings);
              openBook(bookId);
            }}
          />
        ) : null}
        {settingsOpen ? (
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={() => undefined} />
        ) : null}
      </Suspense>
      <AccountDialog />
      <ShelfToastHost onViewShelf={() => setScreen({ kind: "shelf" })} aboveTabs={!reading} />
      <Suspense fallback={null}>
        {listFlow ? (
          <WordListDialog
            flow={listFlow}
            books={orderedBooks
              .filter((book) => book.source === "epub")
              .map((book) => ({ id: book.id, title: book.title }))}
            onClose={() => setListFlow(null)}
            onPickAnother={(bookId) => {
              setListFlow(null);
              void openListPicker(bookId);
            }}
            onDone={(_bookId, result, extra) => {
              setListFlow(null);
              setNotes([listAddedNote(result), ...extra]);
            }}
          />
        ) : null}
      </Suspense>
    </div>
  );
}

/** "Word list added: 3 words, 1 with more than one meaning. 2 old meanings were kept." */
function listAddedNote(result: { written: number; multi: number; kept: number }): string {
  return tr("msg.listAdded", {
    words: trn("count.word", result.written),
    multi: result.multi > 0 ? tr("msg.listMulti", { n: result.multi }) : "",
    kept: result.kept > 0 ? trn("msg.listKept", result.kept) : "",
  });
}

function Banner({
  tone,
  onClose,
  children,
  ...rest
}: {
  tone: "warn" | "good";
  onClose?: () => void;
  children: React.ReactNode;
} & Record<`data-${string}`, unknown>) {
  const { t } = useT();
  const Icon = tone === "warn" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-ink",
      )}
      {...rest}
    >
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", tone === "good" && "text-accent")}
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-[0.95rem] leading-relaxed font-medium">{children}</div>
      {onClose ? (
        <button
          type="button"
          className="-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function DueBadge({ n }: { n: number }) {
  const { t } = useT();
  return (
    <span
      className="rounded-full bg-warn px-1.5 text-[0.7rem] leading-5 font-bold text-accent-ink tabular-nums"
      aria-label={t("nav.dueAria", { n })}
    >
      {n}
    </span>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.95rem] font-semibold transition-colors sm:px-3.5",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-accent-soft/70 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
