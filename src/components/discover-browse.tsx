import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BookCover, talkCoverTone } from "@/components/book-cover";
import { useBookTone } from "@/lib/cover-tone";
import { bump } from "@/lib/motion";
import type { ShelfState } from "@/components/shelf-actions";
import { btn, cn } from "@/components/ui";
import type { ContentCategory } from "@/lib/content-category";
import { groupDigits } from "@/lib/library-totals";
import { lexileMeasure } from "@/lib/lexile";
import type { CatalogPack } from "@/lib/packs";
import type { WordListPack } from "@/lib/word-list-catalog";
import { useT } from "@/lib/i18n";
import { useBookBlurb } from "@/lib/book-blurbs";
import { BookMaintainerList, BookMaintainers } from "@/components/book-maintainers";
import { catalogRef } from "@/lib/catalog-id";
import { SITE } from "@/lib/page-meta";

/** A Lexile measure as a number like the detail's other numbers: "790" with a smaller "L" ("BR100L", "HL600L" keep their prefix). */
function LexileNumber({ measure }: { measure: string }) {
  const { t } = useT();
  return (
    <span aria-label={t("lexile.aria", { measure })}>
      <span aria-hidden>
        {measure.slice(0, -1)}
        <small className="ml-px text-[0.55em] font-bold">L</small>
      </span>
    </span>
  );
}

/**
 * The book's own address, https://inputread.site/book/<id>/: a static page with the cover, title and
 * summary as its link preview (scripts/seo-pages.mjs). The system share sheet where there is one,
 * else the link is copied, else shown to copy by hand.
 */
function ShareBookLink({ id, title }: { id: string; title: string }) {
  const { t } = useT();
  const [state, setState] = useState<"idle" | "copied" | "show">("idle");
  const url = `${SITE}/book/${encodeURIComponent(id)}/`;
  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("show");
    }
  }
  return (
    <div className="ml-auto grid gap-1.5">
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded px-3 text-sm font-semibold whitespace-nowrap text-accent hover:bg-accent-soft/60"
        onClick={() => void share()}
        data-detail-share={state}
      >
        {state === "copied" ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {state === "copied" ? t("browse.linkCopied") : t("browse.shareLink")}
      </button>
      {state === "show" ? (
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full min-w-0 rounded-lg border border-line bg-paper px-2 py-1.5 text-base text-ink sm:text-xs"
          aria-label={t("browse.shareLink")}
          data-detail-share-url
        />
      ) : null}
    </div>
  );
}

/** The catalog book a Discover row is: a classic is a public-domain pack, a list a word-list book. */
export function rowCatalogRef(row: Pick<DiscoverRow, "kind" | "id">): string {
  return catalogRef(row.kind === "classic" ? "public-books" : "word-lists", row.id);
}

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
  blocked?: boolean;
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
  action,
}: {
  title: string;
  rows: readonly DiscoverRow[];
  onOpen: (row: DiscoverRow) => void;
  onSeeAll?: () => void;
  rail: string;
  /** The add-to-shelf button on a cover's bottom-right (design system BookRail / AddToShelf). */
  action?: (row: DiscoverRow) => React.ReactNode;
}) {
  const { t } = useT();
  const strip = useRef<HTMLUListElement | null>(null);
  const { pages, page } = useRailPages(strip, rows.length);
  const goPage = (index: number) => {
    const node = strip.current;
    if (!node) return;
    const target = Math.max(0, Math.min(pages - 1, index));
    node.scrollTo({ left: Math.min(target * railStep(node), node.scrollWidth - node.clientWidth), behavior: "smooth" });
  };
  return (
    <section className="grid min-w-0 gap-3" aria-label={title} data-discover-rail={rail}>
      <div className="flex items-end justify-between gap-3">
        <h2
          className="text-[1.125rem] leading-tight font-bold tracking-[-0.02em] sm:text-[1.3125rem]"
          lang={rail.startsWith("series:") || rail.startsWith("curated:") ? "en" : undefined}
        >
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {onSeeAll ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-0.5 px-1.5 text-[0.9375rem] font-bold text-accent hover:underline hover:underline-offset-4"
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
        // A phone row runs off the screen edge and shows part of the next book; no arrows, no dashes.
        // On a wider screen a page holds exactly 4, 5 or 6 whole books (`.rail-row` in styles.css):
        // no sliver of the next one, since the arrows and dashes already say there is more.
        className="rail-row -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:gap-5 sm:px-0 [&::-webkit-scrollbar]:hidden"
        data-rail-row
      >
        {rows.map((row) => (
          <li key={row.key} className="rail-item relative w-[6.6rem] shrink-0 snap-start">
            <button
              type="button"
              className="group grid w-full gap-1.5 rounded-cover text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => onOpen(row)}
              aria-label={t("browse.openAria", { title: row.title })}
              data-rail-book={row.id}
            >
              <span className="relative block" data-tilt>
                <BookCover title={row.title} author={row.author} cover={row.coverUrl} whenVisible look={row.category === "speech" ? "talk" : "book"} />
                <BookMaintainers bookRef={rowCatalogRef(row)} />
              </span>
              <span
                className="overflow-hidden font-display text-[0.84rem] leading-[1.28] font-semibold text-ink transition-colors group-hover:text-accent [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[0.96rem]"
                lang="en"
              >
                {row.title}
              </span>
              <span className="-mt-0.5 truncate text-[0.8125rem] text-faint" lang="en">
                {row.author}
              </span>
            </button>
            {action ? (
              // Over the cover's bottom-right corner; the cover is 2:3 of the item width.
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] aspect-[2/3]">
                <div className="pointer-events-auto absolute right-1.5 bottom-1.5">{action(row)}</div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="hidden items-center justify-center gap-0.5 sm:flex" role="group" aria-label={t("browse.pages", { title })} data-rail-dots={pages}>
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              className="grid h-6 min-w-4 place-items-center"
              onClick={() => goPage(index)}
              aria-label={t("browse.page", { n: index + 1, total: pages })}
              aria-current={index === page ? "true" : undefined}
              data-rail-dot={index}
            >
              <span
                // The current page is an 18px brand dash, the others 6px hairline dashes.
                className={cn(
                  "rail-dash block h-[3px] rounded-full",
                  index === page ? "w-[18px] bg-accent" : "w-1.5 bg-line hover:bg-edge",
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
/** One page of a rail: its width plus the gap before the next page's first book. */
function railStep(node: HTMLElement): number {
  const gap = parseFloat(getComputedStyle(node).columnGap) || 0;
  return (node.clientWidth || 1) + gap;
}

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
        const step = railStep(node);
        const max = Math.max(0, node.scrollWidth - width);
        const pages = max <= 1 ? 1 : Math.ceil((max - 2) / step) + 1;
        const page = node.scrollLeft >= max - 2 ? pages - 1 : Math.min(pages - 1, Math.round(node.scrollLeft / step));
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

/**
 * Discover's newest book (design system FeaturedBook): a set page, not a dark banner. The cover on
 * the left (rising in once), then "New on inputread", the title in Literata, the author, two lines
 * of the story, three numbers and "See this book". On the book's own colour (src/lib/cover-tone.ts).
 * The whole block opens the detail. On a phone the cover sits beside the title and the rest runs
 * the full width under them.
 */
export function FeaturedBook({
  row,
  onOpen,
}: {
  row: DiscoverRow;
  onOpen: (row: DiscoverRow) => void;
}) {
  const { t, locale } = useT();
  const { words, phrases, notes } = counts(row);
  const speech = row.category === "speech";
  const tone = useBookTone(row.coverUrl, speech && !row.coverUrl ? talkCoverTone(row.title, row.author) : undefined);
  const blurb = useBookBlurb({ kind: row.kind === "classic" ? "public" : "lists", id: row.id }, locale);
  const facts = [
    words > 0 ? t("browse.wordsMarked", { n: groupDigits(words) }) : "",
    notes > 0 ? t("browse.notesCount", { n: groupDigits(notes) }) : "",
    phrases > 0 ? t("browse.phrasesCount", { n: groupDigits(phrases) }) : "",
  ].filter(Boolean);
  return (
    <section className="group" aria-label={t("browse.featured")} data-discover-featured={row.id}>
      <button
        type="button"
        className="tone-ground grid w-full grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-[22px] gap-y-3 rounded-2xl p-5 text-left sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-x-10 sm:gap-y-2.5 sm:px-10 sm:py-8"
        style={tone}
        onClick={() => onOpen(row)}
        aria-label={t("browse.openAria", { title: row.title })}
      >
        <span className="cover-rise tone-cover relative block w-full sm:row-span-2 sm:mx-auto sm:w-[10.5rem]">
          <BookCover title={row.title} author={row.author} cover={row.coverUrl} look={speech ? "talk" : "book"} />
        </span>
        <span className="grid min-w-0 content-end gap-1.5 sm:gap-2.5">
          <span className="flex items-center gap-2 text-[0.8125rem] font-bold text-accent">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {t("browse.featured")}
          </span>
          <span
            className="overflow-hidden font-display text-[1.875rem] leading-[1.05] font-bold tracking-[-0.02em] text-ink transition-colors duration-100 group-hover:text-accent [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[2.5rem]"
            lang="en"
          >
            {row.title}
          </span>
          <span className="truncate text-[0.9375rem] text-muted" lang="en">
            {row.author}
          </span>
        </span>
        <span className="col-span-2 grid min-w-0 gap-2.5 sm:col-span-1 sm:col-start-2">
          {blurb ? (
            <span className="max-w-[34rem] overflow-hidden text-[0.9375rem] leading-[1.65] text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] sm:[-webkit-line-clamp:2]" lang={locale === "zh" ? "zh-CN" : "en"}>
              {blurb}
            </span>
          ) : null}
          {facts.length ? (
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-faint">
              {facts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </span>
          ) : null}
          <span className={cn(btn.primary, "mt-1 w-full sm:w-fit")}>
            {t("browse.view")}
            <ArrowRight className="size-5 transition-transform duration-200 group-hover:translate-x-[3px]" aria-hidden />
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

/** The detail sheet: book information, shelf actions, and access to an installed copy. */
export function BookDetail({
  row,
  model,
  canAdd,
  onClose,
  onAction,
  onOpen,
  onRemove,
}: {
  row: DiscoverRow | null;
  model: CardModel | null;
  canAdd: boolean;
  onClose: () => void;
  onAction: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t, locale } = useT();
  const open = row !== null && model !== null;
  const facts = row ? counts(row) : { words: 0, phrases: 0, notes: 0 };
  // The detail shows only a well-formed measure (790L, BR100L, HL600L); anything else, no Lexile tile.
  const lexile = model ? lexileMeasure(model.lexile) : "";
  const speech = row?.category === "speech";
  const tone = useBookTone(row?.coverUrl, row && speech && !row.coverUrl ? talkCoverTone(row.title, row.author) : undefined);
  // Adding (busy -> on): the main button turns into "Open this book" with a small spring.
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && model?.state === "on") bump(actionRef.current, 1.06);
    wasBusy.current = model?.state === "busy";
  }, [model?.state]);
  // What the book is about, in the interface language. "" while it loads, or when none is written yet.
  const blurb = useBookBlurb(row ? { kind: row.kind === "classic" ? "public" : "lists", id: row.id } : null, locale);
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content
          className={cn(
            // A phone gets a bottom sheet (rounded top, a drag bar, at most 88% high); wider screens a centred panel.
            "fixed z-50 grid max-h-[88dvh] gap-5 overflow-y-auto border border-line bg-paper p-5 pt-0 text-ink shadow-lift",
            "inset-x-0 bottom-0 rounded-t-sheet pb-[max(1.25rem,env(safe-area-inset-bottom))] anim-sheet",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 sm:anim-pop",
          )}
          data-book-detail={row?.id}
        >
          {row && model ? (
            <>
              <div className="-mx-5 -mb-3 flex h-6 items-center justify-center sm:hidden" aria-hidden>
                <span className="h-1 w-10 rounded-full bg-line" />
              </div>
              {/* The top on the book's own colour (CoverTone). */}
              <div
                className="tone-ground -mx-5 flex items-start gap-4 px-5 py-5 sm:-mx-6 sm:-mt-6 sm:gap-6 sm:rounded-t-2xl sm:px-6 sm:py-6"
                style={tone}
              >
                <div className="tone-cover relative w-28 shrink-0 sm:w-36" data-tilt>
                  <BookCover title={row.title} author={row.author} cover={row.coverUrl} look={speech ? "talk" : "book"} />
                </div>
                <div className="grid min-w-0 flex-1 content-start gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="pt-1 text-[0.8125rem] font-bold text-[var(--book-deep)]">
                      {row.kind === "classic" ? t("shelf.classic") : t("discover.kindList")}
                    </span>
                    <Dialog.Close
                      className={cn(btn.icon, "-mt-2 -mr-2")}
                      aria-label={t("common.close")}
                    >
                      <X className="size-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  <Dialog.Title
                    className="font-display text-[1.6rem] leading-tight font-bold tracking-[-0.015em] sm:text-[1.875rem]"
                    lang="en"
                  >
                    {row.title}
                  </Dialog.Title>
                  <p className="text-[0.9375rem] text-muted" lang="en">
                    {row.author}
                  </p>
                  <BookMaintainerList bookRef={rowCatalogRef(row)} />
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

              {blurb ? (
                <section className="grid gap-1.5" aria-labelledby="book-blurb-title" data-detail-blurb>
                  <h3 id="book-blurb-title" className="text-sm font-semibold">
                    {t("browse.blurbTitle")}
                  </h3>
                  <p className="text-[0.9375rem] leading-[1.75] whitespace-pre-line" lang={locale === "zh" ? "zh-CN" : "en"}>
                    {blurb}
                  </p>
                </section>
              ) : null}

              {/* Numbers in soft tiles. The Lexile measure shows here and nowhere else, as a number like the
                  other three (790 with a smaller L, design system BookDetail v36); none, no tile. */}
              <dl className={cn("grid gap-1.5", lexile ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")} data-detail-facts>
                {[
                  ...(lexile ? [{ label: t("browse.fact.level"), value: <LexileNumber measure={lexile} />, lexile: true }] : []),
                  { label: t("dashboard.words"), value: groupDigits(facts.words), lexile: false },
                  { label: t("dashboard.phrases"), value: groupDigits(facts.phrases), lexile: false },
                  { label: t("browse.fact.notes"), value: groupDigits(facts.notes), lexile: false },
                ].map((fact) => (
                  <div key={fact.label} className="grid min-w-0 content-start gap-2 rounded-2xl bg-sheet px-4 pt-3 pb-3.5">
                    <dt className="text-[0.8125rem] whitespace-nowrap text-faint">{fact.label}</dt>
                    <dd
                      className="text-[1.75rem] leading-none font-display font-bold tracking-[-0.02em] whitespace-nowrap [font-variant-numeric:lining-nums_tabular-nums] tabular-nums text-ink"
                      data-detail-lexile={fact.lexile ? lexile : undefined}
                    >
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

              {/* Whole buttons wrap to the next line when they do not fit; their text never wraps (English
                  labels run about twice as long as Chinese ones). */}
              <div className="flex flex-wrap items-center gap-2" data-detail-actions>
                <button
                  ref={actionRef}
                  type="button"
                  className={cn(
                    btn.primary,
                    "relative flex-[1_0_auto] overflow-hidden px-6 sm:flex-none sm:min-w-48",
                    // Adding: the progress shows inside the button, with a line along its bottom edge.
                    model.state === "busy" && "disabled:opacity-100 bg-accent-soft text-accent",
                  )}
                  onClick={onAction}
                  disabled={model.blocked || model.state === "busy"}
                  aria-busy={model.state === "busy" || undefined}
                  data-detail-action={model.state}
                >
                  {model.state === "busy" ? null : <Icon className="size-5" aria-hidden />}
                  {actionLabel(model, canAdd, t)}
                  {model.state === "busy" ? (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-accent/20" aria-hidden>
                      <span
                        className={cn("block h-full bg-accent transition-[width] duration-200", model.fraction == null && "w-1/3 animate-pulse")}
                        style={model.fraction == null ? undefined : { width: `${Math.round(Math.min(1, Math.max(0, model.fraction)) * 100)}%` }}
                      />
                    </span>
                  ) : null}
                </button>
                {model.held && model.state !== "on" ? (
                  <button
                    type="button"
                    className={cn(btn.quiet, "flex-[1_0_auto] sm:flex-none")}
                    onClick={onOpen}
                    data-detail-open
                  >
                    <BookOpen className="size-4" aria-hidden />
                    {model.needs ? t("discover.addEpub") : t("discover.openBook")}
                  </button>
                ) : null}
                {model.held ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded px-3 text-[0.9375rem] font-bold whitespace-nowrap text-warn hover:underline hover:underline-offset-4"
                    onClick={onRemove}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("discover.remove")}
                  </button>
                ) : null}
                <ShareBookLink id={row.id} title={row.title} />
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
