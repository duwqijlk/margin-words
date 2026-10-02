import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  BookPlus,
  FileJson,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deleteStoredBook, loadAllCovers } from "@/lib/book-db";
import {
  overallProgress,
  relativeTime,
  useProgress,
  type BookProgress,
} from "@/lib/progress-store";
import { summarize } from "@/lib/srs";
import { useVocab } from "@/lib/vocab-store";
import type { Book, VocabEntry } from "@/lib/vocab-model";
import { useT, type Key } from "@/lib/i18n";
import { useClassicBookIds, useClassicsRunning } from "@/lib/classics";
import { markPackRemoved } from "@/lib/removed-packs";
import { btn, cn, ConfirmDialog, field, ProgressBar } from "@/components/ui";
import { compareLexile } from "@/lib/lexile";
import {
  BookMetaLines,
  DifficultyControls,
  LexileBadge,
  matchesBand,
  type BandChoice,
  type SortChoice,
} from "@/components/lexile-ui";
import { bookCardGrid, bookCardShell, ListFilters, type SeriesChoice } from "@/components/list-filters";

export function useCovers(ids: string[]) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const key = ids.join("|");
  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadAllCovers()
        .then((next) => {
          if (alive) setCovers(next);
        })
        .catch(() => {
          if (alive) setCovers({});
        });
    };
    load();
    window.addEventListener("cibian-covers", load);
    return () => {
      alive = false;
      window.removeEventListener("cibian-covers", load);
    };
  }, [key]);
  return covers;
}

/**
 * Typographic cover for a book that has no cover picture: a calm bookbinding colour picked from the title,
 * a framed title in a serif face, the author underneath. Sizes use container units, so the same cover is
 * right at 90px and at 220px wide.
 */
const COVER_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#2f6b57", "#1b4033"],
  ["#b85c38", "#76381f"],
  ["#35507a", "#1d2c47"],
  ["#7a4a6b", "#472840"],
  ["#b8872b", "#7d5512"],
  ["#4a5568", "#252b37"],
  ["#2f7f86", "#1a4c52"],
  ["#8a5a3c", "#522f1e"],
  ["#5f8a68", "#3b5e45"],
];

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function BookCover({
  title,
  author,
  cover,
  className,
}: {
  title: string;
  author: string;
  cover?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const pair =
    COVER_PALETTES[hashOf(`${title}|${author}`) % COVER_PALETTES.length] ?? COVER_PALETTES[0];
  const [from, to] = pair as readonly [string, string];
  const size = title.length <= 14 ? "11.5cqw" : title.length <= 30 ? "9.5cqw" : "8cqw";
  const showImage = Boolean(cover) && !broken;
  return (
    <span
      className={cn(
        "relative block aspect-[2/3] w-full shrink-0 overflow-hidden rounded-[0.3rem] bg-line shadow-cover [container-type:inline-size]",
        className,
      )}
      {...(showImage ? {} : { "data-generated-cover": "" })}
    >
      {showImage ? (
        <img
          src={cover}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="absolute inset-0 flex flex-col items-center justify-between text-center text-[#fbf6ea]"
          style={{
            backgroundImage: `linear-gradient(155deg, ${from}, ${to})`,
            padding: "13cqw 11cqw 11cqw",
          }}
        >
          <span
            className="pointer-events-none absolute -top-[22cqw] -right-[22cqw] size-[76cqw] rounded-full bg-white/10"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute inset-[5cqw] rounded-[1cqw] border border-white/35"
            aria-hidden
          />
          <span className="h-px w-[16cqw] bg-white/60" aria-hidden />
          <span
            className="relative font-display leading-[1.12] font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] overflow-hidden text-balance"
            style={{ fontSize: size }}
            lang="en"
          >
            {title}
          </span>
          <span className="grid justify-items-center gap-[3cqw]">
            <span className="h-px w-[16cqw] bg-white/60" aria-hidden />
            {author ? (
              <span
                className="max-w-full tracking-[0.08em] uppercase opacity-90 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                style={{ fontSize: "5.6cqw", lineHeight: 1.3 }}
                lang="en"
              >
                {author}
              </span>
            ) : null}
          </span>
        </span>
      )}
      {/* spine shading */}
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/30 via-black/10 to-transparent"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[0.3rem] ring-1 ring-inset ring-black/10"
        aria-hidden
      />
    </span>
  );
}

type Row = {
  book: Book;
  progress: BookProgress | undefined;
  fraction: number;
  words: number;
  due: number;
};

function RenameDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const { t } = useT();
  const renameBook = useVocab((state) => state.renameBook);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author);
    }
  }, [book]);
  return (
    <Dialog.Root open={book !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 text-ink shadow-pop">
          <Dialog.Title className="font-display text-xl font-semibold">
            {t("rename.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{t("rename.desc")}</Dialog.Description>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!book || !title.trim()) return;
              renameBook(book.id, title, author);
              onClose();
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              {t("rename.titleField")}
              <input
                className={field}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t("rename.authorField")}
              <input
                className={field}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={80}
              />
            </label>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close className={btn.quiet}>{t("common.cancel")}</Dialog.Close>
              <button type="submit" className={btn.primary}>
                {t("common.save")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ContinueCard({ row, cover, onOpen }: { row: Row; cover?: string; onOpen: () => void }) {
  const { t } = useT();
  const { book, progress, fraction } = row;
  const started = Boolean(progress && progress.updatedAt > 0 && fraction > 0);
  const pct = Math.round(fraction * 100);
  return (
    <section
      aria-label={t("shelf.continueReading")}
      className="flex items-center gap-4 rounded-3xl border border-line p-4 shadow-sm sm:gap-8 sm:p-6"
      style={{
        backgroundImage:
          "linear-gradient(120deg, color-mix(in srgb, var(--accent-soft) 85%, var(--card)), var(--card) 70%)",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-24 shrink-0 rounded-[0.3rem] transition-transform duration-200 hover:-translate-y-0.5 sm:w-36"
        aria-label={t("shelf.openAria", { title: book.title })}
      >
        <BookCover title={book.title} author={book.author} cover={cover} />
      </button>
      <div className="grid min-w-0 flex-1 content-center gap-1.5 sm:gap-2.5">
        <p className="text-xs font-bold tracking-wider text-accent uppercase">
          {started ? t("shelf.continueReading") : t("shelf.startReading")}
        </p>
        <h2
          className="font-display text-[1.3rem] leading-snug font-semibold sm:text-[2rem] sm:leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          lang="en"
        >
          {book.title}
        </h2>
        {book.author ? (
          <p className="truncate text-sm text-muted" lang="en">
            {book.author}
          </p>
        ) : null}
        <LexileBadge measure={book.lexile} />
        {started && progress ? (
          <div className="grid gap-1.5 pt-1">
            <ProgressBar value={fraction} className="h-1.5" label={t("shelf.progress")} />
            <p className="text-xs text-muted tabular-nums">
              {t("shelf.chapterOf", { n: progress.chapter + 1, total: progress.chapters })} · {pct}%
              {progress.updatedAt ? ` · ${relativeTime(progress.updatedAt)}` : ""}
            </p>
          </div>
        ) : null}
        <div className="pt-1.5 sm:pt-2">
          <button
            type="button"
            className={cn(btn.primary, "max-sm:w-full sm:px-6")}
            onClick={onOpen}
          >
            <BookOpen className="size-4" aria-hidden />
            {started ? t("shelf.continue") : t("shelf.start")}
          </button>
        </div>
      </div>
    </section>
  );
}

function ShelfSkeleton() {
  return (
    <div className="grid gap-8" aria-busy="true">
      <div className="h-44 animate-pulse rounded-3xl bg-line sm:h-60" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="grid gap-3">
            <div className="aspect-[2/3] animate-pulse rounded-md bg-line" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Three small covers, slightly fanned: the picture of an empty shelf. */
function EmptyArt() {
  const demo = [
    { title: "The Lantern Seller", author: "A. Sample Writer", turn: "-rotate-6 translate-y-2" },
    { title: "Tales of the Night", author: "Anonymous", turn: "z-10 -translate-y-1" },
    { title: "Little Rain", author: "M. Grey", turn: "rotate-6 translate-y-2" },
  ];
  return (
    <div className="flex items-end justify-center -space-x-5" aria-hidden>
      {demo.map((item) => (
        <div key={item.title} className={cn("relative w-20 sm:w-24", item.turn)}>
          <BookCover title={item.title} author={item.author} />
        </div>
      ))}
    </div>
  );
}

function EmptyShelf({
  importing,
  onAdd,
  onDemo,
}: {
  importing: boolean;
  onAdd: () => void;
  onDemo: () => void;
}) {
  const { t } = useT();
  const steps: Array<{ title: Key; body: Key }> = [
    { title: "shelf.step1", body: "shelf.step1Body" },
    { title: "shelf.step2", body: "shelf.step2Body" },
    { title: "shelf.step3", body: "shelf.step3Body" },
  ];
  return (
    <div className="grid justify-items-center gap-8 rounded-3xl border border-line bg-card px-5 py-10 text-center sm:px-10 sm:py-14">
      <EmptyArt />
      <div className="grid gap-2">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">{t("shelf.emptyTitle")}</h2>
        <p className="mx-auto max-w-md text-muted">{t("shelf.emptyBody")}</p>
      </div>
      <ol className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-2xl bg-paper p-3.5 sm:grid sm:gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">
              {index + 1}
            </span>
            <span className="grid gap-0.5">
              <span className="font-semibold">{t(step.title)}</span>
              <span className="text-sm text-muted">{t(step.body)}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid justify-items-center gap-3">
        <button
          type="button"
          className={cn(btn.primary, "px-6")}
          onClick={onAdd}
          disabled={importing}
        >
          <Plus className="size-5" aria-hidden />
          {t("shelf.add")}
        </button>
        <button
          type="button"
          className="min-h-11 px-3 text-sm font-semibold text-accent underline"
          onClick={onDemo}
        >
          {t("shelf.sample")}
        </button>
      </div>
    </div>
  );
}

const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-accent-soft";

function BookCard({
  row,
  cover,
  classic,
  onOpen,
  onNotebook,
  onAddList,
  onRename,
  onDelete,
}: {
  row: Row;
  cover?: string;
  classic: boolean;
  onOpen: () => void;
  onNotebook: () => void;
  onAddList: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const { book } = row;
  const pct = Math.round(row.fraction * 100);
  return (
    <li className={bookCardShell}>
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-[0.3rem] text-left transition-transform duration-200 hover:-translate-y-1"
          aria-label={t("shelf.openAria", { title: book.title })}
        >
          <BookCover title={book.title} author={book.author} cover={cover} />
        </button>
        {book.needsEpub ? (
          <span
            className="pointer-events-none absolute top-2 left-2 rounded-full bg-warn px-2 py-0.5 text-[0.7rem] font-bold text-accent-ink shadow"
            data-needs-epub
          >
            {t("shelf.needsEpub")}
          </span>
        ) : classic ? (
          <span
            className="pointer-events-none absolute top-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[0.7rem] font-bold text-accent-ink shadow"
            data-classic-label
          >
            {t("shelf.classic")}
          </span>
        ) : null}
        {row.due > 0 ? (
          <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-warn px-2 py-0.5 text-[0.7rem] font-bold text-accent-ink tabular-nums shadow">
            {t("shelf.due", { n: row.due })}
          </span>
        ) : null}
      </div>
      <div className="grid flex-1 content-start gap-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left font-display text-[0.97rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] min-h-[2.6em] overflow-hidden"
            lang="en"
          >
            {book.title}
          </button>
          <Menu.Root>
            <Menu.Trigger
              className="-mr-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent-soft hover:text-ink"
              aria-label={t("shelf.moreAria", { title: book.title })}
            >
              <MoreVertical className="size-4" aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={4}
                className="anim-pop z-50 min-w-44 rounded-xl border border-line bg-card p-1.5 text-ink shadow-pop"
              >
                <Menu.Item className={menuItem} onSelect={onNotebook}>
                  <BookPlus className="size-4" aria-hidden />
                  {t("shelf.menuWords")}
                </Menu.Item>
                {book.source === "epub" ? (
                  <Menu.Item className={menuItem} onSelect={onAddList}>
                    <FileJson className="size-4" aria-hidden />
                    {t("shelf.menuAddList")}
                  </Menu.Item>
                ) : null}
                <Menu.Item className={menuItem} onSelect={onRename}>
                  <Pencil className="size-4" aria-hidden />
                  {t("shelf.menuEdit")}
                </Menu.Item>
                <Menu.Item
                  className={cn(menuItem, "text-warn data-[highlighted]:bg-warn-soft")}
                  onSelect={onDelete}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("shelf.menuDelete")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
        {book.author ? (
          <p className="-mt-1.5 truncate text-xs text-muted" lang="en">
            {book.author}
          </p>
        ) : null}
        <BookMetaLines
          lexile={book.lexile}
          isbn={book.isbn}
          series={book.series}
          seriesNumber={book.seriesNumber}
          matchRate={book.matchRate}
        />
      </div>
      {book.source === "epub" ? (
        <div className="mt-auto flex min-h-11 items-center gap-2" data-card-actions>
          <ProgressBar
            value={row.fraction}
            className="h-1 flex-1"
            label={t("shelf.progressFor", { title: book.title })}
          />
          <span
            className={cn(
              "w-9 text-right text-xs tabular-nums",
              pct > 0 ? "text-muted" : "font-semibold text-accent",
            )}
          >
            {pct > 0 ? `${pct}%` : t("shelf.new")}
          </span>
        </div>
      ) : (
        <p className="mt-auto flex min-h-11 items-center text-xs text-muted" data-card-actions>
          {t("shelf.sampleNotebook")}
        </p>
      )}
    </li>
  );
}

/** Books to show before a search box is useful. */
const SEARCH_FROM = 8;

export function Shelf({
  books,
  words,
  covers,
  ready,
  importing,
  onOpen,
  onNotebook,
  onAdd,
  onAddList,
  onDemo,
}: {
  books: Book[];
  words: VocabEntry[];
  covers: Record<string, string>;
  ready: boolean;
  importing: boolean;
  onOpen: (bookId: string) => void;
  onNotebook: (bookId: string) => void;
  onAdd: () => void;
  onAddList: (bookId: string | null) => void;
  onDemo: () => void;
}) {
  const { t, tn } = useT();
  const progress = useProgress((state) => state.items);
  const removeProgress = useProgress((state) => state.remove);
  const deleteBook = useVocab((state) => state.deleteBook);
  const classicIds = useClassicBookIds(books.map((book) => book.id).join("|"));
  const installingClassics = useClassicsRunning((state) => state.running);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortChoice>("recent");
  const [band, setBand] = useState<BandChoice>("all");
  const [author, setAuthor] = useState("all");
  const [series, setSeries] = useState<SeriesChoice>("all");
  const [renaming, setRenaming] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState<Book | null>(null);

  const rows = useMemo<Row[]>(
    () =>
      books.map((book) => {
        const mine = words.filter((word) => word.bookId === book.id);
        const stat = summarize(mine);
        return {
          book,
          progress: progress[book.id],
          fraction: overallProgress(progress[book.id]),
          words: mine.length,
          due: stat.due,
        };
      }),
    [books, words, progress],
  );

  /** Recent first: the book read last, then the book added last. */
  const recent = useMemo(() => {
    const lastOf = (row: Row) => row.progress?.updatedAt ?? 0;
    return [...rows].sort((a, b) => lastOf(b) - lastOf(a) || b.book.updatedAt - a.book.updatedAt);
  }, [rows]);

  const hero = useMemo(() => recent.find((row) => row.book.source === "epub") ?? null, [recent]);

  const authors = useMemo(
    () => [...new Set(rows.map((row) => row.book.author).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const seriesNames = useMemo(
    () => [...new Set(rows.map((row) => row.book.series ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const searched = q
      ? recent.filter((row) => `${row.book.title} ${row.book.author}`.toLowerCase().includes(q))
      : recent;
    let banded = searched.filter((row) => matchesBand(row.book.lexile ?? "", band));
    if (author !== "all") banded = banded.filter((row) => row.book.author === author);
    if (series === "none") banded = banded.filter((row) => !row.book.series);
    else if (series !== "all" && series !== "grouped") banded = banded.filter((row) => row.book.series === series);
    if (series === "grouped") {
      return [...banded].sort(
        (a, b) =>
          (a.book.series ?? "\uffff").localeCompare(b.book.series ?? "\uffff") ||
          (a.book.seriesNumber ?? 99) - (b.book.seriesNumber ?? 99) ||
          a.book.title.localeCompare(b.book.title),
      );
    }
    if (sort === "recent" || sort === "listed") return banded;
    const copy = [...banded];
    if (sort === "title") copy.sort((a, b) => a.book.title.localeCompare(b.book.title) || a.book.author.localeCompare(b.book.author));
    else copy.sort((a, b) => compareLexile(a.book.lexile ?? "", b.book.lexile ?? "", sort) || a.book.title.localeCompare(b.book.title));
    return copy;
  }, [recent, q, band, sort, author, series]);
  const groups = useMemo(() => {
    if (series !== "grouped") return [];
    const names = [...new Set(visible.map((row) => row.book.series ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const blocks = names.map((name) => ({
      key: name,
      title: name,
      rows: visible
        .filter((row) => row.book.series === name)
        .sort((a, b) => (a.book.seriesNumber ?? 0) - (b.book.seriesNumber ?? 0)),
    }));
    const rest = visible.filter((row) => !row.book.series);
    if (rest.length) blocks.push({ key: "none", title: "", rows: rest });
    return blocks;
  }, [visible, series]);
  const filtering = band !== "all" || author !== "all" || series !== "all" || (sort !== "recent" && sort !== "listed");

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
      <header className="flex items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("shelf.title")}</h1>
          {ready && books.length > 0 ? (
            <p className="text-sm text-muted">{tn("count.book", books.length)}</p>
          ) : null}
        </div>
        {ready && books.length > 0 ? (
          <button type="button" className={btn.primary} onClick={onAdd} disabled={importing}>
            <Plus className="size-5" aria-hidden />
            {importing ? t("shelf.importing") : t("shelf.add")}
          </button>
        ) : null}
      </header>

      {!ready || (books.length === 0 && installingClassics && !importing) ? (
        <ShelfSkeleton />
      ) : books.length === 0 && !importing ? (
        <EmptyShelf importing={importing} onAdd={onAdd} onDemo={onDemo} />
      ) : (
        <>
          {hero && !q && !filtering ? (
            <ContinueCard
              row={hero}
              cover={covers[hero.book.id]}
              onOpen={() => onOpen(hero.book.id)}
            />
          ) : null}

          <section className="grid gap-4" aria-label={t("shelf.all")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">{t("shelf.all")}</h2>
              {books.length >= 2 ? (
                <div className="flex flex-wrap gap-2">
                  <DifficultyControls
                    sort={sort}
                    sorts={["recent", "easy", "hard", "title"]}
                    onSort={setSort}
                    band={band}
                    onBand={setBand}
                  />
                  <ListFilters
                    authors={authors}
                    seriesNames={seriesNames}
                    author={author}
                    series={series}
                    onAuthor={setAuthor}
                    onSeries={setSeries}
                  />
                </div>
              ) : null}
              {books.length >= SEARCH_FROM ? (
                <label className="relative w-full max-w-64">
                  <span className="sr-only">{t("shelf.search")}</span>
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <input
                    className={cn(field, "pl-9")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("shelf.search")}
                    type="search"
                  />
                </label>
              ) : null}
            </div>

            {visible.length === 0 && q ? (
              <p className="py-10 text-center text-muted">{t("shelf.noMatch", { query })}</p>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-muted">{t("lexile.none")}</p>
            ) : (
              series === "grouped" ? (
                <div className="grid gap-8">
                  {groups.map((group) => (
                    <div key={group.key} className="grid gap-4" data-series-group={group.key}>
                      <h3 className="font-display text-lg font-semibold" lang={group.title ? "en" : undefined}>
                        {group.title || t("shelf.series.none")}
                      </h3>
                      <ul className={bookCardGrid}>
                        {group.rows.map((row) => (
                          <BookCard
                            key={row.book.id}
                            row={row}
                            cover={covers[row.book.id]}
                            classic={classicIds.has(row.book.id)}
                            onOpen={() => onOpen(row.book.id)}
                            onNotebook={() => onNotebook(row.book.id)}
                            onAddList={() => onAddList(row.book.id)}
                            onRename={() => setRenaming(row.book)}
                            onDelete={() => setDeleting(row.book)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
              <ul className={bookCardGrid}>
                {importing ? (
                  <li className="grid gap-3" aria-busy="true">
                    <div className="flex aspect-[2/3] animate-pulse items-center justify-center rounded-md bg-line text-sm font-semibold text-muted">
                      {t("shelf.importing")}
                    </div>
                  </li>
                ) : null}
                {visible.map((row) => (
                  <BookCard
                    key={row.book.id}
                    row={row}
                    cover={covers[row.book.id]}
                    classic={classicIds.has(row.book.id)}
                    onOpen={() => onOpen(row.book.id)}
                    onNotebook={() => onNotebook(row.book.id)}
                    onAddList={() => onAddList(row.book.id)}
                    onRename={() => setRenaming(row.book)}
                    onDelete={() => setDeleting(row.book)}
                  />
                ))}
              </ul>
              )
            )}
          </section>
        </>
      )}

      <RenameDialog book={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting
            ? t("shelf.deleteTitle", { title: deleting.title })
            : t("shelf.deleteTitleGeneric")
        }
        description={t("shelf.deleteBody", {
          n: deleting ? words.filter((word) => word.bookId === deleting.id).length : 0,
        })}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          // The "removed" flag needs the pack record, so it is written before the book goes.
          void markPackRemoved(id)
            .catch(() => undefined)
            .then(() => deleteStoredBook(id))
            .catch(() => undefined);
          removeProgress(id);
          deleteBook(id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
