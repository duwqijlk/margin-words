import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Focus,
  List,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadBookExtras,
  loadBookMeta,
  loadPackRecord,
  loadStoredBook,
  type Gloss,
  type StoredBook,
} from "@/lib/book-db";
import { readingSlots } from "@/lib/epub";
import { phrasePoint, pointFromEntry } from "@/lib/gloss-ref";
import { linkChapterHtml, peekChapterHtml, rememberChapterHtml } from "@/lib/chapter-link";
import {
  countSurface,
  entryAppliesAt,
  hasTrickySense,
  pickSense,
  plainSurface,
  TAP_WORD_PATTERN,
  type OtherMeaning,
} from "@/lib/glossary-format";
import type { PhraseEntry } from "@/lib/glossary-extras";
import { pickPhrase, phraseWordMarks } from "@/lib/help-match";
import { findPhrase, paragraphBlocks } from "@/lib/help-lookup";
import { loadParagraphView } from "@/lib/help-flow";
import { tr, useT, type Key } from "@/lib/i18n";
import { useJump } from "@/lib/jump-store";
import {
  findSentence,
  makeAnchor,
  QUOTE_MAX,
  resolveAnchor,
  restoreReadingPlace,
  type TextAnchor,
} from "@/lib/position";
import { legacyChapter, overallProgress, useProgress } from "@/lib/progress-store";
import { bookSyncKey } from "@/lib/sync-merge";
import type { WordSource } from "@/lib/vocab-model";
import { hasSourceFrom, savedFromCard } from "@/lib/wordbook";
import { extractAnchorContext, flushWordTaps, recordWordTap } from "@/lib/word-taps-collector";
import { readerVars, usePrefs } from "@/lib/reader-prefs";
import {
  contextPos,
  isEasyKey,
  resolveGlossKey,
  sentenceAround,
  surfaceOffset,
  wordStatInBook,
  type WordStat,
} from "@/lib/text";
import { useVocab } from "@/lib/vocab-store";
import { flowCutOffsets, flowPoint, flowText, flowTextBefore } from "@/lib/flow-text";
import { MissingBook } from "@/components/missing-book";
import { READER_GUTTER, SIDE_PANEL } from "@/components/side-panel";
import { btn, cn, ProgressBar, speakEnglish } from "@/components/ui";
import {
  ParagraphBulbs,
  ParagraphPanel,
  type ParagraphPanelState,
} from "@/components/help-panels";
import { ReaderSettings } from "@/components/reader-settings";
import { ReaderContents } from "@/components/reader-contents";
import {
  WordCard,
  type CardState,
  type PhraseHit,
  locateSentence,
  wholeSentence,
} from "@/components/word-card";
import {
  calculatePageStep,
  isEinkScreen,
  MIN_TURN_MS,
  readerLineHeight,
  topBarHeight,
} from "@/lib/reader-paging";
import {
  PLACE_TOP,
  RESTORE_BOTTOM,
  topAnchor,
  tallBlock,
  lineTopAt,
} from "@/lib/reader-anchor";

/* ------------------------------------------------------------------ reader */

/** Tablet only: a quiet hint in the right-hand column. Wide screens have no column, so this stays hidden. */
function SidePlaceholder() {
  const { t } = useT();
  return (
    <aside
      aria-hidden="true"
      data-side-placeholder
      className={cn(
        "pointer-events-none fixed z-0 hidden content-start gap-1 border border-dashed border-line px-5 py-5 text-sm text-muted",
        "md:grid lg:hidden",
        SIDE_PANEL,
        "md:bottom-auto md:h-40",
      )}
    >
      <p className="font-semibold">{t("reader.sideTitle")}</p>
      <p>{t("reader.sideHint")}</p>
      <p>{t("about.markPhrase")}</p>
      <p>{t("reader.trickyHint")}</p>
    </aside>
  );
}



export function ReaderScreen({
  bookId,
  onBack,
  onNotebook,
  onAddEpub,
  onDiscover,
}: {
  bookId: string;
  onBack: () => void;
  onNotebook: () => void;
  onAddEpub: () => void;
  onDiscover: () => void;
}) {
  const { t } = useT();
  const words = useVocab((state) => state.words);
  const shelfBook = useVocab((state) => state.books.find((item) => item.id === bookId));
  const saveWord = useVocab((state) => state.saveWord);
  const removeWordFromBook = useVocab((state) => state.removeWordFromBook);
  const setSourcePlaces = useVocab((state) => state.setSourcePlaces);
  const fillPrepared = useVocab((state) => state.fillPrepared);
  const prefs = usePrefs();
  const saveProgress = useProgress((state) => state.save);

  const [book, setBook] = useState<StoredBook | null>(null);
  const bookChaptersRaw = book?.chapters;
  const [missing, setMissing] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(() => {
    const saved = useProgress.getState().items[bookId];
    return saved ? saved.chapter : (legacyChapter(bookId) ?? -1);
  });
  const [extraId, setExtraId] = useState(() => useProgress.getState().items[bookId]?.extraId ?? "");
  const [scrolled, setScrolled] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [picked, setPicked] = useState<{
    surface: string;
    paragraph: string;
    index: string;
    /** which time this word form appears in the chapter (1-based) */
    nth: number;
    /** the paragraph text before the word */
    before: string;
    /** which paragraph of the chapter this is, counted the way the word list counts them */
    block: number;
  } | null>(null);
  // Paragraph help (overlay). `index` is the paragraph number from paragraphBlocks().
  const [help, setHelp] = useState<{ index: number } | null>(null);
  const [helpState, setHelpState] = useState<ParagraphPanelState>({ status: "loading" });
  const helpToken = useRef(0);
  const [phraseHit, setPhraseHit] = useState<{ at: string; hit: PhraseHit } | null>(null);
  // True from the tap until the phrase lookup answers, so an easy word like "in" is not saved first.
  const [phrasePending, setPhrasePending] = useState(false);
  // Phrases live beside the word list. Empty until that record loads, then the dotted line appears.
  const [phraseList, setPhraseList] = useState<Record<string, PhraseEntry>>({});
  const [listSource, setListSource] = useState("");
  const [glossaryRev, setGlossaryRev] = useState("");
  const articleRef = useRef<HTMLElement | null>(null);
  /** The sticky top bar. Its height is what a page turn must not hide. */
  const headerRef = useRef<HTMLElement | null>(null);
  /** What the last tap said out loud, so the phrase lookup does not say it a second time. */
  const spoken = useRef("");
  const restore = useRef<number | null>(useProgress.getState().items[bookId]?.scroll ?? null);
  // A place found through the file-independent anchor (saved position, or "go to the sentence" from the wordbook).
  const restoreAt = useRef<{ paragraph: number; offset: number; flash: boolean } | null>(null);
  // The page that was last placed, and the spot still held while late text (phrases, a list update) redraws it.
  const placed = useRef<{
    page: string;
    paragraph: number | null;
    offset: number;
    target: number | null;
    until: number;
  } | null>(null);
  // The last scroll position not yet written to the progress store.
  const pendingSave = useRef<(() => void) | null>(null);

  const waitingFile = useRef(false);
  // True once a full read is on screen. A word-list event before that must re-read the book:
  // patching an empty screen would drop the new list.
  const bookShown = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A full-book read keeps the IndexedDB snapshot from the moment it started. The word list
    // can be replaced while that read is still going (Alice's chapter text is large). Adopting
    // the snapshot afterwards would put the old list back on screen, after the refresh had
    // already shown the new one. Each newer request bumps this, and the older read is dropped.
    let generation = 0;
    waitingFile.current = false;
    bookShown.current = false;
    const adopt = (next: StoredBook, seen: number) => {
      if (!alive || seen !== generation) return;
      waitingFile.current = false;
      bookShown.current = true;
      const jump = useJump.getState().take(bookId);
      pendingSave.current?.();
      const saved = useProgress.getState().items[bookId];
      if (jump?.at && next.chapters.length > 0) {
        // A jump from the wordbook names a numbered chapter. It leaves an extra page.
        const hit = resolveAnchor(
          jump.at,
          next.chapters.map((item) => item.paragraphs),
        );
        restoreAt.current = { paragraph: hit.paragraph, offset: hit.offset, flash: true };
        setChapterIndex(hit.chapter);
        setExtraId("");
      } else if (saved) {
        // extraId keeps the reader on that extra; the anchor is then a paragraph of the extra.
        const place = restoreReadingPlace(saved, {
          chapters: next.chapters.map((item) => item.paragraphs),
          extras: next.extras,
        });
        if (place.paragraph !== null)
          restoreAt.current = { paragraph: place.paragraph, offset: place.offset, flash: false };
        setExtraId(place.extraId);
        if (!place.extraId && place.paragraph !== null) setChapterIndex(place.chapter);
      }
      setMissing(false);
      setBook(next);
      fillPrepared(bookId, next.glossary);
    };
    const readWhole = (seen: number) => {
      void loadStoredBook(bookId)
        .then((next) => {
          if (!alive || seen !== generation) return;
          if (!next) {
            waitingFile.current = true;
            setMissing(true);
          } else adopt(next, seen);
        })
        .catch(() => {
          if (alive && seen === generation) {
            waitingFile.current = true;
            setMissing(true);
          }
        });
    };
    // First open: read the whole book once (chapter text is big).
    readWhole(generation);
    // A word list added or updated while the book is open (the "cibian-progress" event): merge it in.
    // The same event fires when the missing file has just been downloaded or paired.
    const refresh = (seen: number) => {
      timer = null;
      if (!alive || seen !== generation) return;
      // Still loading, or the file just arrived: the light glossary read cannot draw the chapter.
      if (waitingFile.current || !bookShown.current) {
        readWhole(seen);
        return;
      }
      void loadBookMeta(bookId)
        .then((meta) => {
          if (!alive || seen !== generation || !meta) return;
          setBook((prev) =>
            prev
              ? {
                  ...prev,
                  glossary: meta.glossary,
                  pending: meta.pending,
                  totalHard: meta.totalHard,
                  ...(meta.bundled ? { bundled: meta.bundled } : {}),
                }
              : prev,
          );
          fillPrepared(bookId, meta.glossary);
        })
        .catch(() => undefined);
    };
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId !== bookId || timer) return;
      // Drop any full-book read that started before this write, before it can paint the old list.
      generation += 1;
      const seen = generation;
      timer = setTimeout(() => refresh(seen), 400);
    };
    window.addEventListener("cibian-progress", onProgress);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("cibian-progress", onProgress);
    };
  }, [bookId, fillPrepared]);

  useEffect(() => {
    return () => {
      void flushWordTaps();
    };
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    setListSource("");
    const pull = () => {
      void loadBookExtras(bookId)
        .then(async (extras) => {
          if (!alive) return;
          setPhraseList(extras?.phrases ?? {});
          setListSource(extras?.source ?? "");
          let rev = extras?.rev ?? "";
          if (!rev) {
            const pack = await loadPackRecord(bookId).catch(() => null);
            if (pack?.rev) rev = pack.rev;
          }
          setGlossaryRev(rev);
        })
        .catch(() => undefined);
    };
    pull();
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId === bookId) pull();
    };
    window.addEventListener("cibian-progress", onProgress);
    return () => {
      alive = false;
      window.removeEventListener("cibian-progress", onProgress);
    };
  }, [bookId]);

  const lastChapter = book ? Math.max(book.chapters.length - 1, 0) : 0;
  // A book opened for the first time starts at the first chapter with real text,
  // skipping the cover, title page and contents.
  const firstReal = useMemo(() => {
    if (!bookChaptersRaw) return 0;
    // "Real" prose = enough text, in paragraph-sized pieces (a contents page is many short lines).
    const at = bookChaptersRaw.findIndex((item) => {
      const chars = item.paragraphs.join(" ").length;
      return chars > 1200 && chars / Math.max(1, item.paragraphs.length) > 60;
    });
    return at < 0 ? 0 : at;
  }, [bookChaptersRaw]);
  const safeIndex = Math.min(chapterIndex < 0 ? firstReal : chapterIndex, lastChapter);
  const chapter = book?.chapters[safeIndex];
  const activeExtra = book?.extras?.find((item) => item.id === extraId) ?? null;
  const chapterHtml = activeExtra ? (activeExtra.html ?? "") : (chapter?.html ?? "");
  const viewChapter = activeExtra ? -1 : safeIndex;
  const slots = useMemo(
    () => (book?.extras && book.extras.length > 0 ? readingSlots(book) : null),
    [book],
  );

  const marked = useMemo(() => {
    const ready = new Set<string>();
    // Entries that hold only position-based senses: underlined at their anchors, not everywhere.
    const sparse = new Map<string, Gloss>();
    // Entries with a sense flagged trickyMeaning: marked at the anchors where that sense resolves.
    const tricky = new Map<string, Gloss>();
    // Word lists may name extra forms ("sawn" -> "saw"); the book's own list decides.
    const forms = new Map<string, string>();
    // Stored key for each straightened spelling, so a curly apostrophe still finds the entry.
    const keys = new Map<string, string>();
    if (book) {
      for (const [key, gloss] of Object.entries(book.glossary)) {
        ready.add(key);
        if (!keys.has(key)) keys.set(key, key);
        const straight = plainSurface(key);
        if (!keys.has(straight)) keys.set(straight, key);
        // `A.M` and `a.m.` are the same listed token. The period is part of the key.
        const bare = straight.replace(/\.+$/g, "");
        if (bare && !keys.has(bare)) keys.set(bare, key);
        if (gloss.senseOnly === true) sparse.set(key, gloss);
        if (hasTrickySense(gloss)) tricky.set(key, gloss);
        for (const form of gloss.forms ?? []) {
          const name = plainSurface(form);
          if (name && !forms.has(name)) forms.set(name, key);
        }
      }
    }
    return { ready, forms, sparse, tricky, keys };
  }, [book]);
  const resolveKey = useCallback(
    (surface: string) => resolveGlossKey(surface, marked.keys, marked.forms),
    [marked],
  );
  const chapterKey = `${bookId}|${viewChapter}|${extraId}`;
  // A chapter the reader just left is already linked. Coming back does not build it again.
  const linkedHtml = useMemo(() => {
    if (!book || !chapterHtml) return "";
    const cached = peekChapterHtml(book, phraseList, chapterKey);
    if (cached !== undefined) return cached;
    try {
      const html = linkChapterHtml(
        chapterHtml,
        marked.ready,
        resolveKey,
        viewChapter,
        marked.sparse,
        marked.tricky,
        phraseList,
      );
      rememberChapterHtml(book, phraseList, chapterKey, html);
      return html;
    } catch (error) {
      console.error("Failed to link chapter HTML", error);
      return chapterHtml;
    }
  }, [book, chapterHtml, chapterKey, phraseList, marked, resolveKey, viewChapter]);
  const bookChapters = book?.chapters;

  const bookKey = shelfBook ? bookSyncKey(shelfBook) : "";
  const savedKeys = useMemo(
    () =>
      new Set(
        words
          .filter((word) => bookKey !== "" && hasSourceFrom(word, bookKey))
          .map((word) => word.lemma.toLowerCase()),
      ),
    [words, bookKey],
  );

  // Paint saved words and the selected word straight onto the page. Doing it in the DOM
  // (not in the HTML string) keeps the scroll position and selection when you save a word.
  const pickedIndex = picked?.index ?? "";
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-word]")) {
      const key = resolveKey(button.dataset.word ?? "");
      const sparseOff =
        marked.sparse.has(key) &&
        !button.classList.contains("book-hard") &&
        !button.classList.contains("book-tricky");
      button.classList.toggle("book-saved", savedKeys.has(key) && !sparseOff);
      button.classList.toggle("book-on", pickedIndex !== "" && button.dataset.i === pickedIndex);
    }
    // A saved phrase marks its own words, not the single easy word that was tapped.
    const savedPhrases = Object.fromEntries(
      Object.entries(phraseList).filter(([key]) => savedKeys.has(key.toLowerCase())),
    );
    if (Object.keys(savedPhrases).length > 0) {
      const sel = "p, h1, h2, h3, h4, li, blockquote, div[data-para]";
      const all = [...root.querySelectorAll<HTMLElement>(sel)];
      const blocks = all.filter(
        (block) => !all.some((other) => other !== block && block.contains(other)),
      );
      for (const block of blocks) {
        const marks = phraseWordMarks(savedPhrases, flowText(block));
        if (marks.length === 0) continue;
        const starts = flowCutOffsets(
          block,
          (el) => el.localName === "button" && el.getAttribute?.("data-word") != null,
        );
        for (const button of block.querySelectorAll<HTMLButtonElement>("button[data-word]")) {
          if (button.closest(sel) !== block) continue;
          const word = button.getAttribute("data-word") ?? "";
          const start = starts.get(button);
          if (start === undefined || !word) continue;
          const end = start + word.length;
          if (marks.some((mark) => start >= mark.start && end <= mark.end))
            button.classList.add("book-saved");
        }
      }
    }
  }, [linkedHtml, savedKeys, pickedIndex, resolveKey, marked, phraseList]);

  // Restore the saved reading position once per chapter, after its text is on screen.
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root || !linkedHtml) return;
    const page = `${bookId}|${safeIndex}|${extraId}`;
    let target = restore.current;
    restore.current = null;
    let mark = restoreAt.current;
    restoreAt.current = null;
    const now = Date.now();
    // A turn backwards lands on the LAST line of the previous page, which is the end of the
    // document, not the end of the article (the buttons and padding sit below the article).
    let bottom = target !== null && target < 0;
    if (bottom) target = 1;
    if (!mark && target === null) {
      const held = placed.current;
      // The same page drawn again (phrases loaded, the list changed): it must not jump to the top.
      if (held?.page === page) {
        if (now >= held.until) return;
        target = held.target;
        if (target !== null && target < 0) {
          bottom = true;
          target = 1;
        }
        mark =
          held.paragraph === null
            ? null
            : { paragraph: held.paragraph, offset: held.offset, flash: false };
      }
    }
    if (!mark && (target === null || target <= 0)) {
      placed.current = { page, paragraph: null, offset: 0, target: null, until: 0 };
      window.scrollTo({ top: 0 });
      setScrolled(0);
      return;
    }
    const until =
      placed.current?.page === page && placed.current.until > now
        ? placed.current.until
        : now + 2500;
    placed.current = {
      page,
      paragraph: mark?.paragraph ?? null,
      offset: mark?.offset ?? 0,
      target: bottom ? RESTORE_BOTTOM : target,
      until,
    };
    const block = mark ? paragraphBlocks(root)[mark.paragraph] : undefined;
    let place: () => void;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    if (block) {
      const inside = mark?.offset ?? 0;
      place = () => {
        const rect = block.getBoundingClientRect();
        const line = inside > 0 && tallBlock(rect) ? lineTopAt(block, inside) : null;
        const top = (line === null ? rect.top - PLACE_TOP : line - PLACE_TOP - 2) + window.scrollY;
        window.scrollTo({ top: Math.max(0, top) });
      };
      if (mark?.flash) {
        block.classList.add("book-flash");
        flashTimer = setTimeout(() => block.classList.remove("book-flash"), 3000);
      }
    } else if (target === null || target <= 0) {
      window.scrollTo({ top: 0 });
      setScrolled(0);
      return;
    } else if (bottom) {
      place = () => {
        window.scrollTo({
          top: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        });
      };
    } else {
      place = () => {
        const top = root.getBoundingClientRect().top + window.scrollY;
        const span = Math.max(1, root.offsetHeight - window.innerHeight);
        window.scrollTo({ top: top + target * span });
      };
    }
    place();
    if (!block && target !== null) setScrolled(bottom ? 1 : target);
    // Fonts, pictures and banners change the page height right after load; keep the
    // saved spot until the reader scrolls on their own (or a few seconds pass).
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => {
        if (!cancelled) place();
      });
      observer.observe(root);
      if (document.body) observer.observe(document.body);
    } catch {
      // ResizeObserver may fail or not support observing document.body in older engines.
    }
    const release = () => {
      cancelled = true;
      try {
        observer?.disconnect();
      } catch {}
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
    function stop() {
      release();
      if (placed.current?.page === page) placed.current.until = 0;
    }
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    const timer = setTimeout(stop, Math.max(0, until - now));
    return () => {
      clearTimeout(timer);
      if (flashTimer) clearTimeout(flashTimer);
      release();
    };
  }, [linkedHtml, bookId, safeIndex, extraId]);

  // Track and save position in the chapter.
  useEffect(() => {
    if (!book) return;
    let frame = 0;
    let saver: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      frame = 0;
      const root = articleRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const span = Math.max(1, rect.height - window.innerHeight);
      // The end of the chapter on screen means the chapter is read, also when it fits on one screen.
      const value =
        rect.bottom <= window.innerHeight ? 1 : Math.min(1, Math.max(0, -rect.top / span));
      // The bar shows whole percent. Setting the exact fraction re-rendered this whole screen on
      // every animation frame of a scroll (a long chapter, dozens of times a second) for a number
      // nobody can see change.
      setScrolled((held) => (Math.round(held * 100) === Math.round(value * 100) ? held : value));
      if (saver) clearTimeout(saver);
      const write = () => {
        saver = null;
        pendingSave.current = null;
        // Read the anchor when the scrolling has stopped, not on every frame: `topAnchor` walks
        // every paragraph of the chapter and reads a rectangle for each, which forced a layout
        // on every animation frame.
        const anchor = topAnchor(root, activeExtra ? 0 : safeIndex);
        saveProgress(bookId, {
          scroll: value,
          // No paragraph on screen: an older anchor would reopen somewhere else, so the scroll fraction is used.
          anchor: anchor ?? undefined,
          ...(activeExtra ? { extraId: activeExtra.id } : {}),
        });
      };
      pendingSave.current = write;
      saver = setTimeout(write, 400);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onHide = () => pendingSave.current?.();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    frame = requestAnimationFrame(measure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      if (frame) cancelAnimationFrame(frame);
      if (saver) clearTimeout(saver);
      // Leaving the book (or the list redrawing) keeps the last spot. A chapter change clears this first.
      pendingSave.current?.();
    };
  }, [book, bookId, saveProgress, safeIndex, activeExtra]);

  useEffect(() => {
    if (!book || !extraId) return;
    if (!book.extras?.some((item) => item.id === extraId)) setExtraId("");
  }, [book, extraId]);

  useEffect(() => {
    if (book) saveProgress(bookId, { chapter: safeIndex, chapters: book.chapters.length, extraId });
  }, [book, bookId, safeIndex, extraId, saveProgress]);

  // Positions saved before anchors existed get one now, from where the page actually is.
  useEffect(() => {
    if (!book || !linkedHtml) return;
    const timer = setTimeout(() => {
      const saved = useProgress.getState().items[bookId];
      if (extraId) {
        if (saved?.extraId === extraId && saved.anchor) return;
        const anchor = topAnchor(articleRef.current, 0);
        if (anchor) saveProgress(bookId, { anchor, extraId });
        return;
      }
      if (saved?.anchor && saved.anchor.chapter === safeIndex) return;
      const anchor = topAnchor(articleRef.current, safeIndex);
      if (anchor) saveProgress(bookId, { anchor });
    }, 900);
    return () => clearTimeout(timer);
  }, [book, bookId, linkedHtml, safeIndex, extraId, saveProgress]);

  // Saved words from before places were stored: find each sentence in this device's text once.
  useEffect(() => {
    if (!book || !bookKey) return;
    const timer = setTimeout(() => {
      const open = useVocab
        .getState()
        .words.flatMap((card) =>
          card.sources
            .filter(
              (source) => source.book === bookKey && !source.ref && !source.at && source.sentence,
            )
            .map((source) => ({ card, source })),
        );
      if (open.length === 0) return;
      const texts = book.chapters.map((item) => item.paragraphs);
      const updates = [];
      for (const { card, source } of open) {
        const sentence = source.sentence;
        if (!sentence) continue;
        const hit = findSentence(sentence, source.surface, texts, source.chapter);
        if (!hit) continue;
        updates.push({
          lemma: card.lemma,
          book: bookKey,
          sentence,
          chapter: hit.chapter,
          chapterTitle: book.chapters[hit.chapter]?.title,
          at: hit,
        });
      }
      setSourcePlaces(updates);
    }, 1200);
    return () => clearTimeout(timer);
  }, [book, bookKey, setSourcePlaces]);

  const goChapter = useCallback(
    (index: number, toBottom = false) => {
      if (!book) return;
      const next = Math.min(Math.max(0, index), book.chapters.length - 1);
      // The place is applied by the restore effect, after the new chapter is on screen. Scrolling
      // here would move the page that is still showing (a flash) and the height measured would be
      // the old chapter's.
      restore.current = toBottom ? RESTORE_BOTTOM : null;
      restoreAt.current = null;
      pendingSave.current = null;
      setExtraId("");
      setChapterIndex(next);
      setPicked(null);
      setHelp(null);
      setScrolled(toBottom ? 1 : 0);
      const first = book.chapters[next]?.paragraphs[0] ?? "";
      saveProgress(bookId, {
        chapter: next,
        chapters: book.chapters.length,
        scroll: toBottom ? 1 : 0,
        extraId: "",
        anchor: first ? makeAnchor({ chapter: next, paragraph: 0, text: first, at: 0 }) : undefined,
      });
    },
    [book, bookId, saveProgress],
  );

  const slotIndex = slots
    ? Math.max(
        0,
        slots.findIndex((slot) =>
          activeExtra
            ? slot.kind === "extra" && book?.extras?.[slot.index]?.id === activeExtra.id
            : slot.kind === "chapter" && slot.index === safeIndex,
        ),
      )
    : safeIndex;

  const goSlot = useCallback(
    (at: number, toBottom = false) => {
      if (!book || !slots) return;
      const slot = slots[at];
      if (!slot) return;
      restore.current = toBottom ? RESTORE_BOTTOM : null;
      restoreAt.current = null;
      pendingSave.current = null;
      setPicked(null);
      setHelp(null);
      setScrolled(toBottom ? 1 : 0);
      if (slot.kind === "chapter") {
        setExtraId("");
        setChapterIndex(slot.index);
        const first = book.chapters[slot.index]?.paragraphs[0] ?? "";
        saveProgress(bookId, {
          chapter: slot.index,
          chapters: book.chapters.length,
          scroll: toBottom ? 1 : 0,
          extraId: "",
          anchor: first
            ? makeAnchor({ chapter: slot.index, paragraph: 0, text: first, at: 0 })
            : undefined,
        });
      } else {
        const extra = book.extras?.[slot.index];
        if (!extra) return;
        setExtraId(extra.id);
        const first = extra.paragraphs[0] ?? "";
        saveProgress(bookId, {
          chapter: safeIndex,
          chapters: book.chapters.length,
          scroll: toBottom ? 1 : 0,
          extraId: extra.id,
          // The anchor is a paragraph of this extra. Restore searches only that extra.
          anchor: first ? makeAnchor({ chapter: 0, paragraph: 0, text: first, at: 0 }) : undefined,
        });
      }
      // The restore effect places the page once it is on screen (see goChapter).
    },
    [book, slots, bookId, saveProgress, safeIndex],
  );

  /**
   * One page = the whole lines that fit, MINUS `PAGE_KEEP_LINES` lines of tolerance.
   *
   * A page must break on a line, not on an arbitrary pixel: `innerHeight - bar` is almost never
   * a multiple of the line height, so a bare height scroll leaves the first line of the new page
   * cut in half at the top. Counting lines gives exact pages instead.
   *
   * The measured height is what the engine REPORTS as visible, and on an e-ink WebView that can
   * include a strip covered by a native bar. Trusting it exactly meant every turn lost the same
   * three lines on the Moaan. Keeping those lines back is the tolerance: see `PAGE_KEEP_LINES`.
   */
  const pageStep = useCallback(() => {
    const bar = prefs.focus ? 0 : topBarHeight(headerRef.current);
    const line = readerLineHeight(articleRef.current);
    return calculatePageStep({
      viewportWidth: window.innerWidth,
      viewportHeight: Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight),
      topBarHeight: bar,
      lineHeight: line,
    });
  }, [prefs.focus]);

  /**
   * One turn per press. The same physical key can reach the page twice (a WebView that maps a
   * page button to both a key event and a click, a double tap, a device that repeats keydown
   * without setting `repeat`), and every extra event used to be another page.
   */
  const lastTurnAt = useRef(0);
  const turnAllowed = useCallback(() => {
    const now = Date.now();
    if (now - lastTurnAt.current < MIN_TURN_MS) return false;
    lastTurnAt.current = now;
    return true;
  }, []);

  const pageForward = useCallback(() => {
    if (!book) return;
    if (!turnAllowed()) return;
    const step = pageStep();
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const top = window.scrollY;
    const hasNext = slots ? slotIndex < slots.length - 1 : safeIndex < book.chapters.length - 1;
    // Only at the end of the page does a forward turn open the next chapter: a short last
    // strip is shown first, so no line of the chapter is ever skipped.
    if (maxScroll - top <= 4) {
      if (hasNext) {
        if (slots) goSlot(slotIndex + 1);
        else goChapter(safeIndex + 1);
      }
      return;
    }
    window.scrollTo(0, Math.min(maxScroll, top + step));
  }, [book, slots, slotIndex, safeIndex, goSlot, goChapter, pageStep, turnAllowed]);

  const pageBackward = useCallback(() => {
    if (!book) return;
    if (!turnAllowed()) return;
    const step = pageStep();
    const top = window.scrollY;
    const hasPrev = slots ? slotIndex > 0 : safeIndex > 0;
    if (top > 0) {
      window.scrollTo(0, Math.max(0, top - step));
      return;
    }
    // At the top of a page, a backward turn opens the previous one at its last line.
    if (hasPrev) {
      if (slots) goSlot(slotIndex - 1, true);
      else goChapter(safeIndex - 1, true);
    }
  }, [book, slots, slotIndex, safeIndex, goSlot, goChapter, pageStep, turnAllowed]);

  const pagingHandlers = useRef({
    pageForward,
    pageBackward,
    paging: prefs.paging,
    cardOpen: false,
  });
  pagingHandlers.current = {
    pageForward,
    pageBackward,
    paging: prefs.paging,
    cardOpen: picked !== null || help !== null,
  };

  useEffect(() => {
    /** The names the DOM uses for the hardware volume keys, plus the Android and media key codes. */
    const isVolKey = (event: KeyboardEvent) =>
      event.key === "AudioVolumeDown" ||
      event.key === "AudioVolumeUp" ||
      event.key === "VolumeDown" ||
      event.key === "VolumeUp" ||
      event.code === "AudioVolumeDown" ||
      event.code === "AudioVolumeUp" ||
      event.code === "VolumeDown" ||
      event.code === "VolumeUp" ||
      event.keyCode === 24 ||
      event.keyCode === 25 ||
      event.keyCode === 174 ||
      event.keyCode === 175;

    /** Which of the two was pressed. A device that sends neither leaves both false. */
    const volumeDirection = (event: KeyboardEvent): "up" | "down" | "" => {
      if (!isVolKey(event)) return "";
      if (
        event.key === "AudioVolumeUp" ||
        event.key === "VolumeUp" ||
        event.code === "AudioVolumeUp" ||
        event.code === "VolumeUp" ||
        event.keyCode === 24 ||
        event.keyCode === 175
      )
        return "up";
      if (
        event.key === "AudioVolumeDown" ||
        event.key === "VolumeDown" ||
        event.code === "AudioVolumeDown" ||
        event.code === "VolumeDown" ||
        event.keyCode === 25 ||
        event.keyCode === 174
      )
        return "down";
      return "";
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicked(null);
        setHelp(null);
        return;
      }
      const { pageForward: next, pageBackward: prev, paging, cardOpen } = pagingHandlers.current;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable)
        return;
      // A card or a panel is open over the text: the keys belong to it (its own list scrolls,
      // its own buttons take Space), not to the page behind it.
      if (cardOpen) return;
      if (
        target?.closest?.(
          'aside, [role="dialog"], [data-radix-popper-content-wrapper], [data-para-ui]',
        )
      )
        return;

      // PageDown / PageUp are ALWAYS ours, whatever the page-turn setting says. The engine's own
      // page scroll is `innerHeight` minus a small overlap, and `innerHeight` is not what is on
      // the glass on an e-ink WebView - that is the three lines the Moaan kept losing. Leaving
      // these two keys to the browser meant the setting (off by default) silently bypassed every
      // page-turn calculation the reader makes.
      //
      // In addition to standard 34/33, Android KeyEvent.KEYCODE_PAGE_DOWN is 93 and KEYCODE_PAGE_UP is 92,
      // which many e-reader WebViews (Onyx Boox, Moaan, Meebook) dispatch as keyCode/which 93/92.
      const isPageDown =
        event.key === "PageDown" ||
        event.code === "PageDown" ||
        event.keyCode === 34 ||
        event.keyCode === 93 ||
        event.which === 93;
      const isPageUp =
        event.key === "PageUp" ||
        event.code === "PageUp" ||
        event.keyCode === 33 ||
        event.keyCode === 92 ||
        event.which === 92;

      // On e-ink readers, volume buttons are dedicated hardware page buttons, so allow them even
      // if the general paging setting is off.
      const isEink = isEinkScreen(window.innerWidth, window.innerHeight);
      const volume = paging || isEink ? volumeDirection(event) : "";
      const isNext =
        isPageDown ||
        volume === "down" ||
        (paging &&
          (event.key === "ArrowDown" ||
            event.key === "ArrowRight" ||
            (event.key === " " && !event.shiftKey)));
      const isPrev =
        isPageUp ||
        volume === "up" ||
        (paging &&
          (event.key === "ArrowUp" ||
            event.key === "ArrowLeft" ||
            (event.key === " " && event.shiftKey)));

      if (isNext || isPrev) {
        // ALWAYS prevent browser native scrolling immediately, even on key repeat.
        event.preventDefault();
        event.stopPropagation();
        // Held keys would run the page away on a slow e-ink screen: one press, one page.
        if (event.repeat) return;
        if (isNext) next();
        else prev();
      }
    };

    // A volume key that the device does hand to the page must not also change the volume.
    const onKeyUp = (event: KeyboardEvent) => {
      const isEink = isEinkScreen(window.innerWidth, window.innerHeight);
      if ((pagingHandlers.current.paging || isEink) && isVolKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // A click anywhere outside the card (and not on a word) closes it.
    const onClickAway = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || !target.closest) return;
      const inside =
        'aside[data-word-card], aside[data-para-panel], [data-para-ui], button[data-word], header, [role="dialog"], [data-radix-popper-content-wrapper]';
      // A button inside a card may remove itself when it is pressed (for example "Explain this
      // sentence"). Look at the path the click took, so it still counts as a click inside.
      const path = (event.composedPath?.() ?? []) as Element[];
      if (target.closest(inside) || path.some((node) => node.matches?.(inside))) return;
      setPicked(null);
      setHelp(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    document.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      document.removeEventListener("click", onClickAway);
    };
  }, []);

  const pickedKey = picked ? resolveKey(picked.surface) : "";
  const statCache = useRef<Map<string, WordStat | null>>(new Map());
  useEffect(() => {
    statCache.current.clear();
  }, [book]);

  const currentStat = useMemo(() => {
    if (!pickedKey || !bookChapters) return undefined;
    if (statCache.current.has(pickedKey)) {
      return statCache.current.get(pickedKey) ?? undefined;
    }
    const stat = wordStatInBook(bookChapters, pickedKey);
    statCache.current.set(pickedKey, stat ?? null);
    return stat;
  }, [pickedKey, bookChapters]);
  // A phrasal verb or idiom that contains the tapped word (from the word list).
  const located = picked
    ? locateSentence(picked.paragraph, picked.surface, picked.before.length)
    : null;
  const pickedSentence = located?.text ?? "";
  const phraseOffset = located?.offset ?? -1;
  const phraseAt = picked
    ? `${picked.index}|${picked.surface}|${pickedSentence}|${phraseOffset}`
    : "";
  useEffect(() => {
    // Phrase notes are anchored to this book's chapters. An extra (often the next
    // book's opening) must not pick one up from the same words.
    if (activeExtra) {
      setPhraseHit(null);
      setPhrasePending(false);
      return;
    }
    if (!picked || !pickedSentence) {
      setPhrasePending(false);
      return;
    }
    let alive = true;
    const at = phraseAt;
    const surface = picked.surface;
    const offset = phraseOffset;
    setPhrasePending(true);
    void findPhrase(bookId, pickedSentence, surface, offset >= 0 ? offset : undefined).then(
      (hit) => {
        if (!alive) return;
        setPhraseHit(hit ? { at, hit } : null);
        setPhrasePending(false);
        // The tap already said the word, or the phrase when the list in memory knew it. Only a
        // phrase found here for the first time replaces that: one voice per tap.
        if (hit && hit.key.trim().toLowerCase() !== spoken.current.trim().toLowerCase()) {
          spoken.current = hit.key;
          speakEnglish(hit.key);
        }
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, phraseAt, activeExtra]);

  function paragraphElement(index: number): Element | null {
    const root = articleRef.current;
    return root ? (paragraphBlocks(root)[index] ?? null) : null;
  }

  function openHelp(index: number) {
    const el = paragraphElement(index);
    if (!el || !book) return;
    const root = articleRef.current;
    const texts = root ? paragraphBlocks(root).map((block) => flowText(block)) : [];
    setAnchor(el instanceof HTMLElement ? el : null);
    setPicked(null);
    setHelp({ index });
    setHelpState({ status: "loading" });
    helpToken.current += 1;
    const token = helpToken.current;
    void loadParagraphView({
      bookId,
      chapter: activeExtra ? activeExtra.id : safeIndex,
      paragraph: index,
      texts,
    }).then((view) => {
      if (helpToken.current !== token) return;
      setHelpState(view ? { status: "ready", view } : { status: "none" });
    });
  }

  function closeHelp() {
    helpToken.current += 1;
    setHelp(null);
  }

  /** Open the word card for a word button on the page (shared by taps and the hard-word list). */
  function pickButton(button: Element) {
    const surface = button.getAttribute("data-word") ?? "";
    const key = resolveKey(surface) || surface;
    const block = button.closest("p, li, blockquote, h1, h2, h3, h4, div[data-para]");
    const paragraph = block ? flowText(block) : surface;
    const before = block ? flowTextBefore(block, button) : "";
    const blocks = articleRef.current ? paragraphBlocks(articleRef.current) : [];
    const blockAt = blocks.findIndex((item) => item.contains(button));
    const nth = Number(button.getAttribute("data-n")) || 1;
    const context = extractAnchorContext(paragraph, surface, before.length);
    const located = locateSentence(paragraph, surface, before.length);
    const sentence = located.text;
    const offset = located.offset;
    const inDict = Boolean(
      book?.glossary && (book.glossary[key] || book.glossary[surface.toLowerCase()]),
    );
    // The phrase list is already in memory, so a tapped word that belongs to a phrase can say the
    // phrase straight away: hearing the word first and the phrase on top of it was the bug.
    const phraseNow =
      activeExtra || !phraseList
        ? null
        : pickPhrase(phraseList, sentence, surface, offset >= 0 ? offset : undefined);
    const inGlossary = inDict || Boolean(phraseNow);
    recordWordTap(bookId, surface, inGlossary, {
      bookTitle: book?.title,
      form: countSurface(surface),
      chapter: activeExtra ? 0 : safeIndex,
      occurrence: nth,
      paragraph: Math.max(0, blockAt),
      context,
      sentence,
      glossaryRev,
    });
    closeHelp();
    setPhraseHit(null);
    setPhrasePending(!activeExtra);
    setAnchor(button instanceof HTMLElement ? button : null);
    setPicked({
      surface,
      paragraph,
      index: button.getAttribute("data-i") ?? "",
      nth,
      before,
      block: Math.max(0, blockAt),
    });
    // One voice per tap. The card's own lookup (`findPhrase`) speaks later only when this list
    // did not know the phrase, and it compares against `spoken.current` so nothing says it twice.
    const saying = phraseNow ? phraseNow.key : resolveKey(surface) || surface;
    spoken.current = saying;
    speakEnglish(saying);
  }

  /** A hard word from the paragraph panel: find it in the paragraph and open its normal card. */
  function pickFromParagraph(word: string) {
    if (!help) return;
    const el = paragraphElement(help.index);
    if (!el) return;
    const tokens = (word.match(new RegExp(TAP_WORD_PATTERN, "gu")) ?? []).map((t) =>
      plainSurface(t),
    );
    if (tokens.length === 0) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button[data-word]")];
    const same = (i: number) =>
      tokens.every((t, k) => plainSurface(buttons[i + k]?.dataset.word ?? "") === t);
    let at = -1;
    for (let i = 0; i < buttons.length; i += 1) {
      if (same(i)) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      at = buttons.findIndex((b) => tokens.includes(plainSurface(b.dataset.word ?? "")));
      if (at < 0) return;
      pickButton(buttons[at] as Element);
      return;
    }
    const group = buttons.slice(at, at + tokens.length);
    const best =
      group.find((b) => b.classList.contains("book-hard") || b.classList.contains("book-tricky")) ??
      group.find((b) => b.classList.contains("book-phrase")) ??
      [...group].sort((a, b) => (b.dataset.word?.length ?? 0) - (a.dataset.word?.length ?? 0))[0];
    if (best) pickButton(best);
  }

  if (missing) {
    return (
      <MissingBook
        book={
          shelfBook ?? {
            id: bookId,
            title: "",
            author: "",
          }
        }
        onBack={onBack}
        onAddEpub={onAddEpub}
        onDiscover={onDiscover}
      />
    );
  }

  if (!book || !chapter) {
    return (
      <div className="mx-auto grid max-w-md justify-items-center gap-4 px-6 py-24" aria-busy="true">
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="text-muted">{t("reader.opening")}</p>
      </div>
    );
  }

  /** The example sentence written in the word list, when it is not the sentence that was tapped. */
  function exampleOf(gloss: Gloss, sentence: string): string | undefined {
    const raw = (gloss as Gloss & { example?: unknown }).example;
    const example = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (!example) return undefined;
    const a = example.toLowerCase().replace(/[^a-z]+/g, "");
    const b = sentence.toLowerCase().replace(/[^a-z]+/g, "");
    return a && (b.includes(a) || a.includes(b)) ? undefined : example;
  }

  function cardFor(tap: NonNullable<typeof picked>): CardState {
    const { surface, paragraph } = tap;
    const key = resolveKey(surface);
    const sentence = sentenceAround(paragraph, surface, tap.before.length);
    const fullSentence = wholeSentence(paragraph, surface, tap.before.length);
    const context = extractAnchorContext(paragraph, surface, tap.before.length);
    const tapAt = {
      chapter: viewChapter,
      surface,
      occurrence: tap.nth,
      paragraph,
      before: tap.before,
    };
    let gloss: Gloss | undefined = book?.glossary[key];
    // A senseOnly entry says nothing about the places its senses do not name.
    if (gloss && !entryAppliesAt(key, gloss, tapAt)) gloss = undefined;
    if (gloss) {
      // Which meaning fits this place in the book? (word list format version 2)
      const choice = pickSense(key, gloss, tapAt);
      return {
        surface,
        key,
        pos: contextPos(surface, choice.pos),
        meaning: choice.meaning,
        whyHard: choice.whyHard,
        here: choice.here,
        sentence,
        fullSentence,
        ready: true,
        status: "ready",
        others: choice.others,
        coined: gloss.coined === true,
        example: exampleOf(gloss, sentence),
        senseIndex: choice.at,
        context,
        occurrence: tap.nth,
        paragraph: tap.block,
        chapter: viewChapter,
        glossaryRev,
      };
    }
    if (isEasyKey(key)) {
      return {
        surface,
        key,
        pos: "",
        meaning: tr("card.easy"),
        whyHard: "",
        sentence,
        fullSentence,
        ready: true,
        status: "easy",
        context,
        occurrence: tap.nth,
        paragraph: tap.block,
        chapter: viewChapter,
        glossaryRev,
      };
    }
    // Not in this book's word list: say so in a friendly way. Nothing is looked up online.
    return {
      surface,
      key,
      pos: "",
      meaning: "",
      whyHard: "",
      sentence,
      fullSentence,
      ready: false,
      status: "unknown",
      context,
      occurrence: tap.nth,
      paragraph: tap.block,
      chapter: viewChapter,
      glossaryRev,
    };
  }

  const card = picked ? cardFor(picked) : null;
  const shownPhrase = phraseHit && phraseHit.at === phraseAt ? phraseHit.hit : null;
  const saveAs = savedFromCard(
    {
      surface: picked?.surface ?? "",
      key: pickedKey,
      pos: card?.pos ?? "",
      meaning: card?.meaning ?? "",
    },
    shownPhrase
      ? {
          key: shownPhrase.key,
          matched: shownPhrase.matched,
          pos: shownPhrase.entry.pos,
          meaning: shownPhrase.entry.meaning,
        }
      : null,
  );
  const alreadySaved = saveAs.lemma
    ? savedKeys.has(saveAs.lemma.toLowerCase()) &&
      (shownPhrase != null || !(marked.sparse.has(pickedKey) && card?.status !== "ready"))
    : false;
  const noList = Object.keys(book.glossary).length === 0;
  const fraction = overallProgress({
    chapter: safeIndex,
    chapters: book.chapters.length,
    scroll: scrolled,
    updatedAt: 1,
  });
  const style = readerVars(prefs) as React.CSSProperties;
  const focus = prefs.focus;

  const onReadingClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("nav, aside, [role='dialog'], [data-para-ui]")) return;

    const button = target.closest("button[data-word]");
    const cardOpen = picked !== null || help !== null;

    if (button) {
      event.preventDefault();
      pickButton(button as HTMLButtonElement);
      return;
    }
    if (target.closest("article a")) {
      event.preventDefault();
    }
    if (cardOpen) {
      setPicked(null);
      closeHelp();
      return;
    }
  };

  return (
    <div style={style} className="min-h-dvh">
      <header
        ref={headerRef}
        className={cn(
          "sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur transition-transform duration-300",
          focus && "-translate-y-full",
        )}
      >
        {/* Full width on purpose: tying this bar to --reader-width slides the text-width control while it is dragged. */}
        <div className="mx-auto flex h-14 w-full items-center gap-1 px-2 sm:px-4">
          <button
            type="button"
            className={btn.icon}
            onClick={onBack}
            aria-label={t("reader.backShelf")}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <ReaderContents
            chapters={book.chapters}
            current={safeIndex}
            onPick={goChapter}
            rows={
              slots
                ? slots.map((slot) => {
                    if (slot.kind === "chapter") {
                      return {
                        key: `c${slot.index}`,
                        mark: String(slot.index + 1),
                        title: book.chapters[slot.index]?.title ?? "",
                        active: !activeExtra && slot.index === safeIndex,
                      };
                    }
                    const extra = book.extras?.[slot.index];
                    return {
                      key: `x${extra?.id ?? slot.index}`,
                      mark: t("reader.extra"),
                      title: extra?.title || t("reader.extra"),
                      active: Boolean(extra && extra.id === activeExtra?.id),
                    };
                  })
                : undefined
            }
            onPickRow={(key) => {
              if (!slots) return;
              const at = slots.findIndex((slot) =>
                slot.kind === "chapter"
                  ? key === `c${slot.index}`
                  : key === `x${book.extras?.[slot.index]?.id ?? slot.index}`,
              );
              if (at >= 0) goSlot(at);
            }}
          />
          <div className="min-w-0 flex-1 px-2 text-center leading-tight">
            <p className="truncate font-display text-[0.95rem] font-semibold">{book.title}</p>
            <p className="truncate text-xs text-muted" lang="en">
              {activeExtra ? activeExtra.title || t("reader.extra") : chapter.title}
            </p>
          </div>
          <ReaderSettings />
          <button
            type="button"
            className={btn.icon}
            onClick={onNotebook}
            aria-label={t("reader.openNotebook")}
          >
            <BookMarked className="size-5" aria-hidden />
          </button>
        </div>
        <ProgressBar value={fraction} className="h-0.5 rounded-none" label={t("reader.progress")} />
      </header>

      {focus ? (
        <button
          type="button"
          onClick={() => prefs.set({ focus: false })}
          className="fixed top-3 right-3 z-30 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-card/90 px-3 text-xs font-semibold text-muted opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          <Focus className="size-3.5" aria-hidden />
          {t("reader.exitFocus")}
        </button>
      ) : null}

      <main
        className={cn("px-5 pt-8 pb-12 sm:px-8 sm:pt-12", READER_GUTTER)}
        onClick={onReadingClick}
      >
        {linkedHtml ? (
          <article
            ref={articleRef}
            className="book-body"
            lang="en"
            data-segmentation={book.segmentation === 2 ? "2" : undefined}
            dangerouslySetInnerHTML={{ __html: linkedHtml }}
          />
        ) : activeExtra ? (
          <article ref={articleRef} className="book-body" lang="en">
            {activeExtra.title ? <h2>{activeExtra.title}</h2> : null}
            {activeExtra.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        ) : (
          <article ref={articleRef} className="book-body" lang="en">
            <h2>{chapter.title}</h2>
            {chapter.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        )}

        <nav
          aria-label={t("reader.nav")}
          className="mx-auto mt-12 grid max-w-[var(--reader-width,40rem)] gap-3 border-t border-line pt-6"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(btn.quiet, "flex-1")}
              disabled={slots ? slotIndex <= 0 : safeIndex <= 0}
              onClick={() => (slots ? goSlot(slotIndex - 1) : goChapter(safeIndex - 1))}
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("reader.prev")}
            </button>
            <button
              type="button"
              className={cn(btn.primary, "flex-1")}
              disabled={
                slots ? slotIndex >= slots.length - 1 : safeIndex >= book.chapters.length - 1
              }
              onClick={() => (slots ? goSlot(slotIndex + 1) : goChapter(safeIndex + 1))}
            >
              {t("reader.next")}
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-center text-xs tabular-nums text-muted">
            {activeExtra
              ? t("reader.extraOf", { pct: Math.round(fraction * 100) })
              : t("reader.chapterOf", {
                  n: safeIndex + 1,
                  total: book.chapters.length,
                  pct: Math.round(fraction * 100),
                })}
          </p>
        </nav>
      </main>

      {!card && !help ? <SidePlaceholder /> : null}

      {linkedHtml ? (
        <ParagraphBulbs
          articleRef={articleRef}
          version={linkedHtml}
          bookId={bookId}
          chapter={activeExtra ? activeExtra.id : safeIndex}
          notesVersion={book?.glossary}
          activeIndex={help ? help.index : null}
          onOpen={openHelp}
        />
      ) : null}

      {help ? (
        <ParagraphPanel
          key={help.index}
          state={helpState}
          anchor={anchor}
          onClose={closeHelp}
          onWord={pickFromParagraph}
        />
      ) : null}

      {card ? (
        <WordCard
          state={card}
          stat={currentStat}
          saved={!phrasePending && alreadySaved}
          phrase={shownPhrase}
          canSave={!phrasePending && (card.ready || shownPhrase != null)}
          bookId={bookId}
          bookTitle={book?.title}
          noList={noList}
          chapter={viewChapter}
          noteChapter={activeExtra?.fromToc ? activeExtra.id : viewChapter}
          anchor={anchor}
          onClose={() => setPicked(null)}
          onToggle={() => {
            if (!picked || !shelfBook || phrasePending) return;
            if (!shownPhrase && !card.ready) return;
            if (alreadySaved) {
              removeWordFromBook(bookKey, saveAs.lemma);
              return;
            }
            const listId = book?.bundled || listSource;
            const gloss =
              book?.glossary[saveAs.lemma] ?? book?.glossary[saveAs.lemma.toLowerCase()];
            const ref = shownPhrase
              ? phrasePoint(listId)
              : gloss
                ? pointFromEntry(listId, saveAs.lemma, gloss, {
                    chapter: viewChapter,
                    surface: picked.surface,
                    occurrence: picked.nth,
                    paragraph: picked.paragraph,
                    before: picked.before,
                  })
                : undefined;
            const sentence = card.fullSentence || card.sentence;
            const source: WordSource = ref
              ? {
                  book: bookKey,
                  title: shelfBook.title,
                  author: shelfBook.author,
                  chapter: ref.chapter ?? safeIndex,
                  ...(chapter.title ? { chapterTitle: chapter.title } : {}),
                  sentence,
                  surface: saveAs.surface,
                  savedAt: Date.now(),
                  ref,
                  ...(saveAs.pos ? { pos: saveAs.pos } : {}),
                }
              : {
                  book: bookKey,
                  title: shelfBook.title,
                  author: shelfBook.author,
                  chapter: safeIndex,
                  ...(chapter.title ? { chapterTitle: chapter.title } : {}),
                  sentence,
                  surface: saveAs.surface,
                  savedAt: Date.now(),
                  ...(saveAs.pos ? { pos: saveAs.pos } : {}),
                };
            saveWord(
              {
                surface: saveAs.surface,
                lemma: saveAs.lemma,
                pos: saveAs.pos,
                meaning: ref ? "" : saveAs.meaning,
                whyHard: "",
                recommend: !isEasyKey(saveAs.lemma),
                sentence,
              },
              source,
            );
          }}
        />
      ) : null}
    </div>
  );
}
