import { Quote, Search, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { jumpToQuote } from "@/lib/jump-store";
import type { QuoteRecord } from "@/lib/quote-model";
import { useQuotes } from "@/lib/quote-store";
import { isTedBook, useSpeechBookIds } from "@/lib/speech-books";
import { bookSyncKey } from "@/lib/sync-merge";
import type { Book } from "@/lib/vocab-model";
import { BookCover, useCovers } from "@/components/book-cover";
import { btn, cn, field, selectCls } from "@/components/ui";

type Order = "recent" | "book";

/**
 * The quotes half of the notebook (design system QuoteBook): what the reader kept to keep, not to
 * review. Grouped by book (small cover, title, count); each quote on a light card in the book's
 * serif, its source line (book · chapter · date) and two actions, Back to the book (the sentence
 * lights up there) and Delete (with Undo). A long quote is cut to six lines, a paragraph to four;
 * the book has the rest. Search, a book filter and the order sit on top.
 */
export function QuoteBook({
  books,
  bookKey,
  onOpenBook,
}: {
  books: Book[];
  /** The book the notebook was opened from: its quotes are shown first, if it has any. */
  bookKey: string;
  onOpenBook: (bookId: string) => void;
}) {
  const { t, tn, locale } = useT();
  const quotes = useQuotes((state) => state.quotes);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("recent");
  const [only, setOnly] = useState(() => (quotes.some((quote) => quote.book === bookKey) ? bookKey : ""));
  const [undo, setUndo] = useState<{ id: number; quote: QuoteRecord } | null>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo((now) => (now?.id === undo.id ? null : now)), 5000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const shelfByKey = useMemo(() => new Map(books.map((book) => [bookSyncKey(book), book])), [books]);
  const covers = useCovers(books);
  const speechIds = useSpeechBookIds();

  // One row per book that has quotes: its title as kept with the quotes (the book may be off the shelf now).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; author: string; quotes: QuoteRecord[]; latest: number }>();
    for (const quote of quotes) {
      const row = map.get(quote.book) ?? { key: quote.book, title: quote.title, author: quote.author, quotes: [], latest: 0 };
      row.quotes.push(quote);
      row.latest = Math.max(row.latest, quote.savedAt);
      map.set(quote.book, row);
    }
    return [...map.values()];
  }, [quotes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = groups
      .filter((group) => !only || group.key === only)
      .map((group) => ({
        ...group,
        quotes: group.quotes
          .filter((quote) => !q || `${quote.text} ${quote.title} ${quote.chapterTitle ?? ""}`.toLowerCase().includes(q))
          .sort((a, b) =>
            order === "book"
              ? a.chapter - b.chapter || a.paragraph - b.paragraph || a.start - b.start
              : b.savedAt - a.savedAt,
          ),
      }))
      .filter((group) => group.quotes.length > 0);
    out.sort((a, b) => (order === "book" ? a.title.localeCompare(b.title) : b.latest - a.latest));
    return out;
  }, [groups, only, query, order]);

  const day = (time: number) =>
    new Date(time).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric" });

  if (quotes.length === 0) {
    const home = shelfByKey.get(bookKey);
    return (
      <div className="grid justify-items-start gap-3 border-t border-line pt-6" data-quotes-empty>
        <h2 className="m-0 text-lg font-bold tracking-[-0.02em]">{t("qb.emptyTitle")}</h2>
        <p className="m-0 max-w-md text-muted">{t("qb.emptyBody")}</p>
        {home?.source === "epub" ? (
          <button type="button" className={btn.primary} onClick={() => onOpenBook(home.id)}>
            {t("nb.backToBook")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-quote-book>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative col-span-2 sm:col-span-1">
          <span className="sr-only">{t("qb.search")}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            className={cn(field, "pl-9")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("qb.search")}
            type="search"
            data-quote-search
          />
        </label>
        <label className="sr-only" htmlFor="quote-book">
          {t("nb.filterBook")}
        </label>
        <select
          id="quote-book"
          className={cn(selectCls, "w-full min-w-0 sm:w-auto sm:max-w-56 sm:min-w-32")}
          value={only}
          onChange={(event) => setOnly(event.target.value)}
        >
          <option value="">{t("nb.allBooks")}</option>
          {groups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.title} ({group.quotes.length})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="quote-order">
          {t("nb.sortBy")}
        </label>
        <select
          id="quote-order"
          className={cn(selectCls, "w-full min-w-0 sm:w-auto sm:min-w-32")}
          value={order}
          onChange={(event) => setOrder(event.target.value as Order)}
        >
          <option value="recent">{t("qb.order.recent")}</option>
          <option value="book">{t("qb.order.book")}</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">{t("nb.noMatch")}</p>
      ) : (
        shown.map((group) => {
          const home = shelfByKey.get(group.key);
          const look = home && speechIds.has(home.id) ? (isTedBook(home.id) ? "ted" : "talk") : "book";
          return (
            <section key={group.key} className="grid gap-2.5" data-quote-group>
              <div className="mt-2 flex min-w-0 items-center gap-3">
                <span className="relative block w-[30px] shrink-0" aria-hidden>
                  <BookCover title={group.title} author={group.author} cover={home ? covers[home.id] : undefined} look={look} />
                </span>
                <div className="min-w-0">
                  <b className="block truncate font-display text-[17px] leading-tight font-semibold" lang="en">
                    {group.title}
                  </b>
                  <span className="text-[13px] text-faint">{tn("qb.count", group.quotes.length)}</span>
                </div>
              </div>
              {group.quotes.map((quote) => {
                const chapter = quote.chapterTitle || t("src.chapterN", { n: quote.chapter + 1 });
                return (
                  <article
                    key={quote.id}
                    className="grid grid-cols-[minmax(0,1fr)] gap-x-3.5 gap-y-1 rounded-2xl bg-sheet px-3.5 pt-3.5 pb-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-[18px] sm:pt-4 sm:pb-3"
                    data-quote={quote.whole ? "whole" : "sentence"}
                  >
                    <Quote className="mt-1 hidden size-[22px] text-accent opacity-70 sm:block" aria-hidden />
                    <div className="min-w-0">
                      {quote.whole ? (
                        <span className="mb-1 inline-block rounded-sm bg-paper px-1.5 py-px text-xs font-bold text-faint">
                          {t("qb.whole")}
                        </span>
                      ) : null}
                      <blockquote
                        lang="en"
                        className={cn(
                          "m-0 overflow-hidden font-display text-[17px] leading-[1.6] text-ink wrap-any sm:text-lg",
                          quote.whole ? "line-clamp-4" : "line-clamp-6",
                        )}
                      >
                        {quote.text}
                      </blockquote>
                    </div>
                    <footer className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:col-start-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-faint">
                        <span lang="en">{quote.title}</span> · <span lang="en">{chapter}</span>
                        {quote.whole ? ` · ${t("qb.whole")}` : ""} · {day(quote.savedAt)}
                      </span>
                      <span className="-mr-2 flex items-center gap-0.5">
                        <button
                          type="button"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded px-2.5 text-[13px] font-bold whitespace-nowrap text-accent transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!home}
                          title={home ? undefined : t("src.notOnShelf")}
                          onClick={() => home && jumpToQuote(quote, home.id)}
                          data-quote-open
                        >
                          <Undo2 className="size-4" aria-hidden />
                          {t("qb.open")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex size-9 items-center justify-center rounded text-faint transition-colors hover:bg-paper hover:text-warn"
                          aria-label={t("qb.delete")}
                          onClick={() => {
                            useQuotes.getState().remove([quote.id]);
                            setUndo({ id: Date.now(), quote });
                          }}
                          data-quote-delete
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </span>
                    </footer>
                  </article>
                );
              })}
            </section>
          );
        })
      )}

      {undo ? (
        <div
          role="status"
          className="toast-in fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 sm:bottom-4 mx-auto flex max-w-md items-center gap-3 rounded bg-ink py-2.5 pr-2.5 pl-4 text-sm text-paper shadow-lift"
          data-quote-removed
        >
          <Trash2 className="size-4 shrink-0 opacity-80" aria-hidden />
          <p className="m-0 min-w-0 flex-1 leading-snug">{t("qb.removed")}</p>
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded px-3 font-bold text-mark hover:bg-paper/15"
            onClick={() => {
              useQuotes.getState().restore([undo.quote]);
              setUndo(null);
            }}
          >
            <Undo2 className="size-4" aria-hidden />
            {t("discover.undo")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
