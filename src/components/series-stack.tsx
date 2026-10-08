import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { BookCover } from "@/components/book-cover";
import { bookCardShell, cardAuthorClass, cardTitleClass } from "@/components/list-filters";
import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui";

type StackBook = { id: string; title: string; author: string };

/** How the covers lie in the fan, back to front. The first book of the series is in front. */
const FAN: ReadonlyArray<string> = [
  "left-[0%] top-[3%] w-[84%] -rotate-[7deg]",
  "left-[8%] top-[1.5%] w-[84%] rotate-[4deg]",
  "left-[8%] top-0 w-[84%]",
];

/** A closed stack: several covers fanned out, a count badge, and the series name. */
export function ClosedStack({
  name,
  books,
  covers,
  updates = 0,
  onOpen,
}: {
  name: string;
  books: StackBook[];
  covers: Record<string, string>;
  /** Books in this stack whose word list has a newer version. */
  updates?: number;
  onOpen: () => void;
}) {
  const { t, tn } = useT();
  const shown = books.slice(0, FAN.length);
  const authors = [...new Set(books.map((book) => book.author).filter(Boolean))];
  return (
    <li className={bookCardShell} data-series-stack={name} data-stack-count={books.length}>
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          aria-expanded="false"
          aria-label={t("shelf.stackOpenAria", { series: name, books: tn("count.book", books.length) })}
          className="block w-full rounded-md text-left"
          data-stack-toggle
        >
          <span className="relative block aspect-[2/3] w-full">
            {[...shown].reverse().map((book, index) => {
              const place = FAN[FAN.length - shown.length + index] ?? "";
              return (
                <span key={book.id} className={cn("absolute block transition-transform duration-200", place)}>
                  <BookCover title={book.title} author={book.author} cover={covers[book.id]} />
                </span>
              );
            })}
          </span>
        </button>
        <span
          className="pointer-events-none absolute top-2 right-2 z-[2] rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-ink tabular-nums shadow"
          data-stack-badge
        >
          {books.length}
        </span>
      </div>
      <div className="grid flex-1 content-start gap-1">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} className={cn(cardTitleClass, "min-w-0 flex-1 text-left")} lang="en" tabIndex={-1}>
            {name}
          </button>
          {updates > 0 ? (
            <span className="shrink-0 pt-0.5 text-xs font-semibold text-accent" data-stack-update={updates}>
              {t("pack.update")}
            </span>
          ) : null}
        </div>
        <p className={cardAuthorClass} lang="en">
          {authors.slice(0, 2).join(", ")}
        </p>
        <p className="text-xs text-muted">{tn("count.book", books.length)}</p>
      </div>
    </li>
  );
}

/** An open stack: a full-width row with the series name, a close button and every book of the series in order. */
export function OpenStack({
  name,
  count,
  onClose,
  children,
}: {
  name: string;
  count: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t, tn } = useT();
  return (
    <li className="col-span-full" data-series-stack-open={name}>
      <section
        className="grid gap-4 rounded-3xl border border-line bg-accent-soft/40 p-3 sm:p-5"
        aria-label={name}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <h3 className="truncate font-display text-lg font-semibold" lang="en">
              {name}
            </h3>
            <p className="text-xs text-muted">{tn("count.book", count)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-expanded="true"
            aria-label={t("shelf.stackCloseAria", { series: name })}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-sm font-semibold hover:bg-accent-soft"
            data-stack-toggle
          >
            <ChevronUp className="size-4" aria-hidden />
            {t("shelf.stackClose")}
          </button>
        </div>
        <ul className="grid grid-cols-3 items-stretch gap-x-2 gap-y-4 sm:gap-x-5 sm:gap-y-8 md:grid-cols-4 lg:grid-cols-5">
          {children}
        </ul>
      </section>
    </li>
  );
}
