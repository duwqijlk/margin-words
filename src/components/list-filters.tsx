import { useT } from "@/lib/i18n";
import { cn, selectCls } from "@/components/ui";

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
  "grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5";

export const bookCardShell = "flex h-full flex-col gap-2.5";
