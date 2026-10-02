import { AlertCircle, BookOpen, CheckCircle2, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { importPackZip } from "@/lib/packs";
import { ensureClassics } from "@/lib/classics";
import { useProgress } from "@/lib/progress-store";
import { errorText, tr, trn, useT } from "@/lib/i18n";
import { applyTheme, usePrefs } from "@/lib/reader-prefs";
import { summarize } from "@/lib/srs";
import type { VocabEntry } from "@/lib/vocab-model";
import { markVocabHydrated, normalizeWord, useVocab } from "@/lib/vocab-store";
import { Notebook } from "@/components/notebook";
import { AddBookScreen, SettingsDialog } from "@/components/get-books";
import { ReaderScreen } from "@/components/reader";
import { ReviewScreen } from "@/components/review";
import { Shelf, useCovers } from "@/components/shelf";
import { btn, cn } from "@/components/ui";
import { LanguageButton } from "@/components/language";
import { WordListDialog, type ListFlow } from "@/components/word-list";
import { guideUrl } from "@/lib/guide";

type Screen =
  | { kind: "shelf" }
  | { kind: "get" }
  | { kind: "words"; bookId: string | null }
  | { kind: "read"; bookId: string }
  | { kind: "review"; bookId: string | null };

const SCREEN_KEY = "cibian-screen-v2";

function readScreen(): Screen | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCREEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { kind?: unknown; bookId?: unknown };
    const bookId = typeof data.bookId === "string" ? data.bookId : null;
    switch (data.kind) {
      case "shelf":
        return { kind: "shelf" };
      case "get":
        return { kind: "get" };
      case "words":
        return { kind: "words", bookId };
      case "review":
        return { kind: "review", bookId };
      case "read":
      case "prepare":
        // "prepare" was a waiting room of an older version; it opens the book now.
        return bookId ? { kind: "read", bookId } : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function writeScreen(screen: Screen) {
  try {
    localStorage.setItem(SCREEN_KEY, JSON.stringify(screen));
  } catch {
    // Blocked or full storage must not crash the app.
  }
}

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

export function MarginApp() {
  const { t, tn } = useT();
  const books = useVocab((state) => state.books);
  const words = useVocab((state) => state.words);
  const addBook = useVocab((state) => state.addBook);
  const addDemo = useVocab((state) => state.addDemo);
  const restoreBooks = useVocab((state) => state.restoreBooks);
  const replaceWords = useVocab((state) => state.replaceWords);
  const theme = usePrefs((state) => state.theme);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "shelf" });
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
      void migrateOldData();
      // Tell the user up front if this browser cannot keep books.
      void checkBookStorage().then((state) => {
        setStorageWarning(state.ok ? null : state.reason);
        if (state.ok) void requestPersistentStorage();
      });
      const saved = readScreen();
      const booksNow = useVocab.getState().books;
      if (saved) {
        const bookId = "bookId" in saved ? saved.bookId : null;
        if (bookId === null || booksNow.some((book) => book.id === bookId)) {
          setScreen(saved);
        }
      }
      void ensureClassics();
      setReady(true);
    })();
  }, [replaceWords, restoreBooks]);

  useEffect(() => {
    if (!ready) return;
    writeScreen(screen);
  }, [ready, screen]);

  const orderedBooks = useMemo(() => [...books].sort((a, b) => b.updatedAt - a.updatedAt), [books]);
  const covers = useCovers(books.map((book) => book.id));
  const due = useMemo(() => summarize(words).due, [words]);

  // If the book on screen was deleted (here or in another tab), fall back to the shelf.
  useEffect(() => {
    if (!ready) return;
    if ("bookId" in screen && screen.bookId && !books.some((book) => book.id === screen.bookId)) {
      setScreen({ kind: "shelf" });
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
      for (const item of done) {
        if (!useVocab.getState().books.some((book) => book.id === item.bookId))
          addBook(item.title, item.author, "epub", item.bookId);
        useVocab.getState().setBookDetails([
          {
            id: item.bookId,
            lexile: item.lexile,
            isbn: item.isbn,
            series: item.series,
            seriesNumber: item.seriesNumber,
          },
        ]);
      }
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
    const book = books.find((item) => item.id === bookId);
    setScreen(book?.source === "epub" ? { kind: "read", bookId } : { kind: "words", bookId });
  }

  const reading = screen.kind === "read";
  const canDrop = !reading && (screen.kind === "shelf" || screen.kind === "get");

  return (
    <div
      className="min-h-dvh bg-paper text-ink"
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
            <nav className="flex flex-1 items-center gap-1" aria-label={t("nav.main")}>
              <NavButton
                active={screen.kind === "shelf" || screen.kind === "get"}
                onClick={() => setScreen({ kind: "shelf" })}
              >
                {t("nav.shelf")}
              </NavButton>
              <NavButton
                active={screen.kind === "words" || screen.kind === "review"}
                onClick={() => setScreen({ kind: "words", bookId: null })}
              >
                {t("nav.notebook")}
                {due > 0 ? (
                  <span
                    className="rounded-full bg-warn px-1.5 text-[0.7rem] leading-5 font-bold text-accent-ink tabular-nums"
                    aria-label={t("nav.dueAria", { n: due })}
                  >
                    {due}
                  </span>
                ) : null}
              </NavButton>
            </nav>
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

      {screen.kind === "read" ? (
        <ReaderScreen
          key={screen.bookId}
          bookId={screen.bookId}
          onBack={() => setScreen({ kind: "shelf" })}
          onNotebook={() => setScreen({ kind: "words", bookId: screen.bookId })}
        />
      ) : screen.kind === "get" ? (
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
            setScreen({ kind: "get" });
          }}
          onAddList={(bookId) => void openListPicker(bookId)}
          onDemo={() => {
            if (!ready) return;
            const id = addDemo();
            setScreen({ kind: "words", bookId: id });
          }}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => setSettingsVersion((n) => n + 1)}
      />
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
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[0.95rem] font-semibold transition-colors sm:px-3.5",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-accent-soft/60 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
