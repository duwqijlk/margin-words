import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useState } from "react";
import { useT } from "@/lib/i18n";
import { btn, cn, selectCls } from "@/components/ui";

export type SeriesChoice = "all" | "grouped" | "none" | string;

/** Author and series filters. They sit in the list header, never over the reading text. */
export function ListFilters({
  authors,
  seriesNames,
  author,
  series,
  onAuthor,
  onSeries,
}: {
  authors: string[];
  seriesNames: string[];
  author: string;
  series: SeriesChoice;
  onAuthor: (value: string) => void;
  onSeries: (value: SeriesChoice) => void;
}) {
  const { t } = useT();
  if (authors.length < 2 && seriesNames.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {authors.length >= 2 ? (
        <select
          className={cn(selectCls, "w-auto max-w-full")}
          aria-label={t("shelf.authorLabel")}
          data-author-filter
          value={author}
          onChange={(event) => onAuthor(event.target.value)}
        >
          <option value="all">{t("shelf.author.all")}</option>
          {authors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      {seriesNames.length > 0 ? (
        <select
          className={cn(selectCls, "w-auto max-w-full")}
          aria-label={t("shelf.seriesLabel")}
          data-series-filter
          value={series}
          onChange={(event) => onSeries(event.target.value)}
        >
          <option value="all">{t("shelf.series.all")}</option>
          <option value="grouped">{t("shelf.series.grouped")}</option>
          <option value="none">{t("shelf.series.none")}</option>
          {seriesNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export const bookCardGrid =
  "grid grid-cols-3 items-stretch gap-x-2 gap-y-4 sm:gap-x-5 sm:gap-y-8 md:grid-cols-4 lg:grid-cols-5";

/** Same title and author slots on every card, so the action row lines up. */
export const cardTitleClass =
  "min-h-[2.6em] overflow-hidden font-display text-[0.78rem] leading-snug font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[0.97rem]";

export const cardAuthorClass = "min-h-4 truncate text-xs leading-4 text-muted max-sm:sr-only";

export const bookCardShell = "book-card flex h-full min-h-full flex-col gap-1.5 sm:gap-3";

/**
 * Sort and list filters. One button on every screen. The choices open in an overlay,
 * so the page does not show a row of menus.
 */
export function FilterMenu({
  active,
  render,
}: {
  active: boolean;
  render: () => ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        type="button"
        className={cn(btn.quiet, "shrink-0")}
        data-filter-menu={active ? "on" : "off"}
      >
        {t("list.filter")}
        {active ? <span className="size-2 rounded-full bg-accent" data-filter-on="" /> : null}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="anim-pop fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 grid max-h-[70dvh] gap-3 overflow-y-auto rounded-2xl border border-line bg-card p-4 text-ink shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(24rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="font-display text-xl font-semibold">{t("list.filter")}</Dialog.Title>
            <Dialog.Close className={btn.primary}>{t("common.done")}</Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("list.filter")}</Dialog.Description>
          <div className="grid gap-2 [&_select]:w-full">{render()}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
