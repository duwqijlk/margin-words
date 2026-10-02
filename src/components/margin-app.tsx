import { AlertCircle, BookOpen, CheckCircle2, CircleHelp, Compass, Library, NotebookPen, Settings, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  checkBookStorage,
  listBookSummaries,
  loadBookMeta,
  loadNotes,
  patchStoredBook,
  purgeLegacyHelpCache,
  requestPersistentStorage,
} from "@/lib/book-db";
import { readGlossaryFile } from "@/lib/glossary-import";
import { registerInstalled } from "@/lib/shelf-register";
import { importPackZip } from "@/lib/packs";
import { ensureClassics } from "@/lib/classics";
import { useProgress } from "@/lib/progress-store";
import { errorText, tr, trn, useT } from "@/lib/i18n";
import { applyTheme, usePrefs } from "@/lib/reader-prefs";
import { summarize } from "@/lib/srs";
import type { VocabEntry } from "@/lib/vocab-model";
import { markVocabHydrated, normalizeWord, useVocab } from "@/lib/vocab-store";
import { useCovers } from "@/components/book-cover";
import { ShelfToastHost } from "@/components/shelf-actions";
import { finishPendingRemoval, useShelfRemove } from "@/lib/shelf-remove";
import { btn, cn } from "@/components/ui";
import { LanguageButton } from "@/components/language";
import type { ListFlow } from "@/components/word-list";
import { NoticeBar } from "@/components/notice-bar";
import { DEFAULT_ROUTE, menuOf, navigate, pathNeedsRedirect, useRoute, type Route } from "@/lib/router";
import { refreshCovers, repairShelf } from "@/lib/shelf-repair";
import { guideUrl } from "@/lib/guide";

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
const AddBookScreen = lazy(() => import("@/components/get-books").then((m) => ({ default: m.AddBookScreen })));
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [bareEpub, setBareEpub] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const listRef = useRef<HTMLInputElement>(null);
  const listTarget = useRef<string | null>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const [listFlow, setListFlow] = useState<ListFlow | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // "/" and any address that is not a page go to the bookshelf, without adding a history entry.
  useEffect(() => {
    if (pathNeedsRedirect()) navigate(DEFAULT_ROUTE, { replace: true });
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
        if (storedResult.status === "fulfilled") restoreBooks(storedResult.value);
        const notes = notesResult.status === "fulfilled" ? notesResult.value : [];
        if (useVocab.getState().words.length === 0 && notes.length > 0) {
          const saved = notes.filter(
            (item): item is VocabEntry =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as VocabEntry).id === "string" &&
              typeof (item as VocabEntry).bookId === "string",
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
      setReady(true);
    })();
  }, [replaceWords, restoreBooks]);

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
    setBareEpub(false);
  }

  /**
   * Files from the picker or a drop. The only way to add a book is a book pack: ONE .zip with book.epub
   * and glossary.json. A bare EPUB is not accepted: the person gets a friendly message and the guide link.
   * A word list (.json) alone is still added to a book already on the shelf (book menu, or a drop).
   */
  async function takeFiles(files: File[]) {
    if (!ready || importing || files.length === 0) return;
    const name = (file: File) => file.name.toLowerCase();
    const isPack = (file: File) =>
      name(file).endsWith(".zip") ||
      (!name(file).endsWith(".epub") &&
        (file.type === "application/zip" || file.type === "application/x-zip-compressed"));
    const isList = (file: File) => name(file).endsWith(".json") || file.type === "application/json";
    const isEpub = (file: File) =>
      name(file).endsWith(".epub") || file.type === "application/epub+zip";
    clearMessages();
    const packs = files.filter(isPack);
    if (packs.length > 0) {
      if (packs.length > 1 || files.length > 1) {
        setImportError(t("err.onePack"));
        return;
      }
      void importPack(packs[0] as File);
      return;
    }
    if (files.some(isEpub)) {
      setBareEpub(true);
      return;
    }
    const lists = files.filter(isList);
    if (lists.length === 1 && files.length === 1) {
      const list = lists[0] as File;
      const check = await readGlossaryFile(list);
      setListFlow({ fileName: list.name, check, bookId: listTarget.current });
      return;
    }
    setImportError(t("err.notPackFile"));
  }

  async function openListPicker(bookId: string | null) {
    listTarget.current = bookId;
    listRef.current?.click();
  }

  /** A .zip book pack from the picker or a drop. Works with no internet. */
  async function importPack(file: File) {
    if (!ready || importing) return;
    setImporting(true);
    setImportError(null);
    setBareEpub(false);
    try {
      const done = await importPackZip(file);
      for (const item of done) registerInstalled(item);
      window.dispatchEvent(
        new CustomEvent("cibian-progress", { detail: { bookId: done[0]?.bookId } }),
      );
      if (done.length === 1 && done[0]) {
        // The book opens by itself: that is the answer. No extra message.
        setScreen({ kind: "read", bookId: done[0].bookId });
      } else {
        setNotes(
          done.map((item) =>
            t(item.updated ? "msg.packUpdated" : "msg.packAdded", {
              title: item.title,
              words: tn("count.word", item.words),
            }),
          ),
        );
        setScreen({ kind: "shelf" });
      }
    } catch (reason) {
      setImportError(errorText(reason, "err.packOpenFailed"));
    } finally {
      setImporting(false);
    }
  }

  function openBook(bookId: string) {
    // The store updates before React re-renders, so a book just added is visible here.
    const book =
      useVocab.getState().books.find((item) => item.id === bookId) ??
      books.find((item) => item.id === bookId);
    if (book?.needsEpub) {
      setEpubFor(bookId);
      return;
    }
    setScreen(book?.source === "epub" ? { kind: "read", bookId } : { kind: "words", bookId });
  }

  useEffect(() => {
    if (screen.kind === "shelf") useShelfRemove.getState().dismissNotice();
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
  const canDrop = !reading && (screen.kind === "shelf" || screen.kind === "add");

  return (
    <div
      className={cn("min-h-dvh bg-paper text-ink", !reading && "max-sm:pb-[calc(4.25rem+env(safe-area-inset-bottom))]")}
      onDragOver={(event) => {
        if (canDrop && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        setDragging(false);
        listTarget.current = null;
        void takeFiles([...(event.dataTransfer.files ?? [])]);
      }}
    >
      {/* The only file inputs of the app: a book pack (.zip), and a word list (.json) for a book that is already on the shelf. */}
      <input
        ref={packRef}
        id="pack-file"
        className="sr-only"
        type="file"
        accept=".zip,application/zip"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          listTarget.current = null;
          void takeFiles(files.slice(0, 1));
        }}
      />
      <input
        ref={listRef}
        id="list-file"
        className="sr-only"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void takeFiles(files.slice(0, 1));
        }}
      />
      {dragging && canDrop ? (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/85 px-6 text-center text-lg font-semibold text-accent">
          {t("drop.here")}
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
            <LanguageButton />
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
          {bareEpub ? (
            <Banner tone="warn" onClose={() => setBareEpub(false)} data-bare-epub>
              <span>{t("err.bareEpub")}</span>{" "}
              <a
                className="font-semibold underline"
                href={guideUrl()}
                target="_blank"
                rel="noopener"
                data-guide-link
              >
                {t("err.bareEpubLink")}
              </a>
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
            />
          ) : screen.kind === "guide" ? (
            <GuideScreen />
          ) : screen.kind === "discover" ? (
            <DiscoverScreen
              shelf={orderedBooks}
              onOpen={openBook}
              onNeedsEpub={(bookId) => setEpubFor(bookId)}
            />
          ) : screen.kind === "add" ? (
            <AddBookScreen
              shelf={orderedBooks}
              settingsVersion={settingsVersion}
              importing={importing}
              onOpen={(bookId) => (bookId ? openBook(bookId) : undefined)}
              onSettings={() => setSettingsOpen(true)}
              onImportClick={() => packRef.current?.click()}
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
              importing={importing}
              onOpen={openBook}
              onNotebook={(bookId) => setScreen({ kind: "words", bookId })}
              onAdd={() => {
                clearMessages();
                setScreen({ kind: "add" });
              }}
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
            onSaved={(bookId) => {
              setEpubFor(null);
              openBook(bookId);
            }}
          />
        ) : null}
        {settingsOpen ? (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSaved={() => setSettingsVersion((n) => n + 1)}
          />
        ) : null}
      </Suspense>
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
