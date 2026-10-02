import { isbnDigits } from "@/lib/book-meta";
import { difficultyBand, lexileMeasure } from "@/lib/lexile";
import { useT, type Key } from "@/lib/i18n";
import { cn, selectCls } from "@/components/ui";

/** The measure on a shelf card or a free-books card. Empty means unrated. */
export function LexileBadge({ measure }: { measure?: string }) {
  const { t } = useT();
  const clean = lexileMeasure(measure ?? "");
  if (!clean) {
    return (
      <p className="text-xs text-muted" data-lexile="unrated" aria-label={t("lexile.ariaUnrated")}>
        {t("lexile.unrated")}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted" data-lexile={clean} aria-label={t("lexile.aria", { measure: clean })}>
      <span className="font-semibold tabular-nums text-ink">{clean}</span>
      <span> · {t("lexile.name")}</span>
    </p>
  );
}

/** ISBN, series and match rate under the Lexile line. Missing facts take no space. */
export function BookMetaLines({
  lexile,
  isbn,
  series,
  seriesNumber,
  matchRate,
}: {
  lexile?: string;
  isbn?: string;
  series?: string;
  seriesNumber?: number;
  matchRate?: number;
}) {
  const { t } = useT();
  const cleanIsbn = isbnDigits(isbn ?? "");
  return (
    <div className="grid gap-0.5">
      <LexileBadge measure={lexile} />
      {cleanIsbn ? (
        <p
          className="truncate text-xs text-muted tabular-nums"
          data-isbn={cleanIsbn}
          lang="en"
          aria-label={t("isbn.aria", { isbn: cleanIsbn })}
        >
          {t("isbn.name")} {cleanIsbn}
        </p>
      ) : null}
      {series && seriesNumber ? (
        <p
          className="truncate text-xs text-muted"
          lang="en"
          data-series={series}
          data-series-number={seriesNumber}
          aria-label={t("series.aria", { name: series, n: seriesNumber })}
        >
          {t("series.book", { name: series, n: seriesNumber })}
        </p>
      ) : null}
      {typeof matchRate === "number" ? (
        <p
          className={cn("text-xs font-semibold", matchRate < 80 ? "text-warn" : "text-muted")}
          data-match={matchRate}
          aria-label={t("match.aria", { n: matchRate })}
        >
          {t("match.short", { n: matchRate })}
        </p>
      ) : null}
    </div>
  );
}

export type SortChoice = "recent" | "listed" | "easy" | "hard" | "title";
export type BandChoice = "all" | "under800" | "mid" | "high" | "unrated";

const SORT_KEY: Record<SortChoice, Key> = {
  recent: "lexile.sort.recent",
  listed: "lexile.sort.listed",
  easy: "lexile.sort.easy",
  hard: "lexile.sort.hard",
  title: "lexile.sort.title",
};

const BAND_KEY: Record<BandChoice, Key> = {
  all: "lexile.filter.all",
  under800: "lexile.filter.under800",
  mid: "lexile.filter.mid",
  high: "lexile.filter.high",
  unrated: "lexile.filter.unrated",
};

const BANDS: BandChoice[] = ["all", "under800", "mid", "high", "unrated"];

export function matchesBand(measure: string, band: BandChoice): boolean {
  if (band === "all") return true;
  return difficultyBand(measure) === band;
}

/** Sort and difficulty controls. They sit in the page header, never over the reading text. */
export function DifficultyControls({
  sort,
  sorts,
  onSort,
  band,
  onBand,
}: {
  sort: SortChoice;
  sorts: SortChoice[];
  onSort: (value: SortChoice) => void;
  band: BandChoice;
  onBand: (value: BandChoice) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={cn(selectCls, "w-auto max-w-full")}
        aria-label={t("lexile.sortLabel")}
        value={sort}
        onChange={(event) => onSort(event.target.value as SortChoice)}
      >
        {sorts.map((item) => (
          <option key={item} value={item}>
            {t(SORT_KEY[item])}
          </option>
        ))}
      </select>
      <select
        className={cn(selectCls, "w-auto max-w-full")}
        aria-label={t("lexile.filterLabel")}
        value={band}
        data-lexile-filter
        onChange={(event) => onBand(event.target.value as BandChoice)}
      >
        {BANDS.map((item) => (
          <option key={item} value={item}>
            {t(BAND_KEY[item])}
          </option>
        ))}
      </select>
    </div>
  );
}
