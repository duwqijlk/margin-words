import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CoverBadge } from "@/components/cover-marks";
import type { ShelfState } from "@/components/shelf-actions";
import { btn, cn } from "@/components/ui";
import type { ContentCategory } from "@/lib/content-category";
import { coverCrossOrigin } from "@/lib/cover-request";
import { groupDigits } from "@/lib/library-totals";
import type { CatalogPack } from "@/lib/packs";
import type { WordListPack } from "@/lib/word-list-catalog";
import { useT } from "@/lib/i18n";

export type DiscoverRow = {
  key: string;
  id: string;
  kind: "classic" | "list";
  title: string;
  author: string;
  lexile: string;
  isbn: string;
  series: string;
  seriesNumber: number;
  category: ContentCategory;
  oldFashioned: boolean;
  oldFashionedReason: string;
  coverUrl?: string;
  /** A day or an instant for when the word list last changed. "" when the catalog has neither. */
  updated: string;
  /** When the book first came to the catalog. Orders the new-books row. */
  added: string;
  pack?: CatalogPack;
  list?: WordListPack;
};

/** What a card or the detail sheet shows about one book on this device. */
export type CardModel = {
  state: ShelfState;
  fraction?: number;
  held: boolean;
  needs: boolean;
  error: string;
  note: string;
  lexile: string;
};

function counts(row: DiscoverRow) {
  const from = row.pack ?? row.list;
  return {
    words: from?.words ?? 0,
    phrases: from?.phrases ?? 0,
    notes: (from?.paragraphs ?? 0) + (from?.sentences ?? 0),
  };
}

/**
 * One store-style row: a short heading, "See all", and covers that scroll sideways.
 * A cover opens the book's detail sheet. These are not the list cards, so the list keeps one card per book.
 */
export function BookRail({
  title,
  rows,
  onOpen,
  onSeeAll,
  rail,
}: {
  title: string;
  rows: readonly DiscoverRow[];
  onOpen: (row: DiscoverRow) => void;
  onSeeAll?: () => void;
  rail: string;
}) {
  const { t } = useT();
  const strip = useRef<HTMLUListElement | null>(null);
  const { pages, page } = useRailPages(strip, rows.length);
  const goPage = (index: number) => {
    const node = strip.current;
    if (!node) return;
    const target = Math.max(0, Math.min(pages - 1, index));
    node.scrollTo({ left: Math.min(target * node.clientWidth, node.scrollWidth - node.clientWidth), behavior: "smooth" });
  };
  return (
    <section className="grid min-w-0 gap-3" aria-label={title} data-discover-rail={rail}>
      <div className="flex items-end justify-between gap-3">
        <h2
          className="font-display text-[1.15rem] leading-tight font-semibold sm:text-[1.3rem]"
          lang={rail.startsWith("series:") || rail.startsWith("curated:") ? "en" : undefined}
        >
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {onSeeAll ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-accent-soft"
              onClick={onSeeAll}
              data-rail-all={rail}
            >
              {t("browse.seeAll")}
              <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : null}
          <span className="hidden items-center gap-1 lg:flex">
            <button
              type="button"
              className={btn.icon}
              onClick={() => goPage(page - 1)}
              disabled={page === 0}
              aria-label={t("browse.prev")}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              className={btn.icon}
              onClick={() => goPage(page + 1)}
              disabled={page >= pages - 1}
              aria-label={t("browse.next")}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </span>
        </div>
      </div>
      <ul
        ref={strip}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:gap-4 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((row) => (
          <li key={row.key} className="w-[6.75rem] shrink-0 snap-start sm:w-32 lg:w-[8.6rem]">
            <button
              type="button"
              className="group grid w-full gap-1.5 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => onOpen(row)}
              aria-label={t("browse.openAria", { title: row.title })}
              data-rail-book={row.id}
            >
              <span className="block transition-transform duration-200 group-hover:-translate-y-0.5">
                <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible />
              </span>
              <span
                className="overflow-hidden font-display text-[0.8rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[0.88rem]"
                lang="en"
              >
                {row.title}
              </span>
              <span className="-mt-1 truncate text-xs text-muted" lang="en">
                {row.author}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-0.5" role="group" aria-label={t("browse.pages", { title })} data-rail-dots={pages}>
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              className="grid h-6 min-w-5 place-items-center rounded-full"
              onClick={() => goPage(index)}
              aria-label={t("browse.page", { n: index + 1, total: pages })}
              aria-current={index === page ? "true" : undefined}
              data-rail-dot={index}
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-300",
                  index === page ? "w-5 bg-accent" : "w-1.5 bg-muted/30 hover:bg-muted/60",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * How many screen-wide pages a sideways row has, and which one is showing.
 * Updates while the reader swipes, and when the window size changes.
 */
function useRailPages(ref: React.RefObject<HTMLElement | null>, count: number): { pages: number; page: number } {
  const [state, setState] = useState({ pages: 1, page: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = node.clientWidth || 1;
        const max = Math.max(0, node.scrollWidth - width);
        const pages = max <= 1 ? 1 : Math.ceil(max / width) + 1;
        const page = node.scrollLeft >= max - 2 ? pages - 1 : Math.min(pages - 1, Math.round(node.scrollLeft / width));
        setState((prev) => (prev.pages === pages && prev.page === page ? prev : { pages, page }));
      });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref, count]);
  return state;
}

/** The newest book, large, over a soft copy of its own cover. */
export function FeaturedBook({
  row,
  onOpen,
}: {
  row: DiscoverRow;
  onOpen: (row: DiscoverRow) => void;
}) {
  const { t } = useT();
  const { words } = counts(row);
  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl bg-ink text-paper shadow-sm"
      aria-label={t("browse.featured")}
      data-discover-featured={row.id}
    >
      {row.coverUrl ? (
        <img
          src={row.coverUrl}
          crossOrigin={coverCrossOrigin(row.coverUrl)}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-10 size-full scale-125 object-cover opacity-55 blur-2xl saturate-150"
        />
      ) : null}
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/45 to-black/10"
        aria-hidden
      />
      <button
        type="button"
        className="flex w-full items-center gap-4 p-4 text-left sm:gap-8 sm:p-8"
        onClick={() => onOpen(row)}
        aria-label={t("browse.openAria", { title: row.title })}
      >
        <span className="w-24 shrink-0 shadow-pop sm:w-36">
          <BookCover title={row.title} author={row.author} cover={row.coverUrl} />
        </span>
        <span className="grid min-w-0 gap-1.5 sm:gap-2.5">
          <span className="text-[0.7rem] font-bold tracking-[0.14em] text-white/75 uppercase">
            {t("browse.featured")}
          </span>
          <span
            className="overflow-hidden font-display text-[1.35rem] leading-tight font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[2.2rem]"
            lang="en"
          >
            {row.title}
          </span>
          <span className="truncate text-sm text-white/80 sm:text-base" lang="en">
            {row.author}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75 sm:text-sm">
            {row.lexile ? <span className="tabular-nums">{row.lexile}</span> : null}
            {words > 0 ? <span>{t("browse.wordsMarked", { n: groupDigits(words) })}</span> : null}
            <span>{row.kind === "classic" ? t("shelf.classic") : t("discover.kindList")}</span>
          </span>
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink max-sm:hidden">
            {t("browse.view")}
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </span>
      </button>
    </section>
  );
}

function actionLabel(model: CardModel, canAdd: boolean, t: ReturnType<typeof useT>["t"]): string {
  switch (model.state) {
    case "busy":
      return model.fraction != null
        ? t("discover.workingPct", { pct: Math.round(model.fraction * 100) })
        : t("discover.working");
    case "on":
      return model.needs ? t("discover.addEpub") : t("discover.openBook");
    case "update":
      return t("pack.update");
    case "error":
      return t("discover.retry");
    default:
      return canAdd ? t("discover.add") : t("discover.signInToAdd");
  }
}

/** The detail sheet: everything about one book, and the one thing to do with it. */
export function BookDetail({
  row,
  model,
  canAdd,
  onClose,
  onAction,
  onRemove,
}: {
  row: DiscoverRow | null;
  model: CardModel | null;
  canAdd: boolean;
  onClose: () => void;
  onAction: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const open = row !== null && model !== null;
  const facts = row ? counts(row) : { words: 0, phrases: 0, notes: 0 };
  const Icon =
    model?.state === "busy"
      ? Loader2
      : model?.state === "on"
        ? BookOpen
        : model?.state === "update" || model?.state === "error"
          ? RotateCw
          : Plus;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed z-50 grid max-h-[calc(100dvh-1rem)] gap-5 overflow-y-auto border border-line bg-card p-5 text-ink shadow-pop",
            "inset-x-0 bottom-0 rounded-t-3xl pb-[max(1.25rem,env(safe-area-inset-bottom))]",
            "anim-pop sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6",
          )}
          data-book-detail={row?.id}
        >
          {row && model ? (
            <>
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="relative w-28 shrink-0 sm:w-40">
                  <BookCover title={row.title} author={row.author} cover={row.coverUrl} />
                </div>
                <div className="grid min-w-0 flex-1 content-start gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <CoverBadge tone={row.kind === "classic" ? "publicDomain" : "list"}>
                      {row.kind === "classic" ? t("shelf.classic") : t("discover.kindList")}
                    </CoverBadge>
                    <Dialog.Close
                      className={cn(btn.icon, "-mt-2 -mr-2")}
                      aria-label={t("common.close")}
                    >
                      <X className="size-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  <Dialog.Title
                    className="font-display text-[1.35rem] leading-tight font-semibold sm:text-[1.6rem]"
                    lang="en"
                  >
                    {row.title}
                  </Dialog.Title>
                  <p className="text-sm text-muted" lang="en">
                    {row.author}
                  </p>
                  {row.series ? (
                    <p className="text-sm text-muted" data-detail-series>
                      <span lang="en">{row.series}</span>
                      {row.seriesNumber
                        ? ` · ${t("browse.bookNumber", { n: row.seriesNumber })}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
                {[
                  { label: t("browse.fact.level"), value: model.lexile || t("lexile.unrated") },
                  { label: t("dashboard.words"), value: groupDigits(facts.words) },
                  { label: t("dashboard.phrases"), value: groupDigits(facts.phrases) },
                  { label: t("browse.fact.notes"), value: groupDigits(facts.notes) },
                ].map((fact) => (
                  <div key={fact.label} className="grid gap-0.5 bg-card px-3 py-2.5">
                    <dt className="text-[0.7rem] font-semibold text-muted">{fact.label}</dt>
                    <dd className="font-display text-lg leading-tight font-semibold tabular-nums">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <Dialog.Description className="text-sm leading-6 text-muted">
                {row.kind === "classic" ? t("browse.classicNote") : t("browse.listNote")}
                {row.oldFashioned ? ` ${t("shelf.oldFashionedNote")}` : ""}
              </Dialog.Description>
              {row.isbn ? (
                <p className="-mt-3 text-xs text-muted tabular-nums" data-detail-isbn>
                  {t("browse.isbn", { isbn: row.isbn })}
                </p>
              ) : null}

              {model.error || model.note ? (
                <p
                  className={cn("text-sm leading-snug", model.error ? "text-warn" : "text-accent")}
                  role={model.error ? "alert" : "status"}
                >
                  {model.error || model.note}
                </p>
              ) : null}

              <div className="grid gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  className={cn(btn.primary, "w-full sm:w-auto sm:min-w-48 sm:px-6")}
                  onClick={onAction}
                  disabled={model.state === "busy"}
                  data-detail-action={model.state}
                >
                  <Icon
                    className={cn("size-4", model.state === "busy" && "animate-spin")}
                    aria-hidden
                  />
                  {actionLabel(model, canAdd, t)}
                </button>
                {model.held ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-warn hover:bg-warn-soft"
                    onClick={onRemove}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("discover.remove")}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
