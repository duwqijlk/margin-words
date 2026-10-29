import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { readingOverview } from "@/lib/reading-stats";
import { useVocab } from "@/lib/vocab-store";
import { ShareButton } from "@/components/share-button";

/**
 * "My reading" in the account dialog: books finished, days of reading, words saved, and the share
 * card for them. It lived above the shelf's search field and crowded the shelf, so it moved here.
 */
export function ReadingOverviewPanel() {
  const { t } = useT();
  const books = useVocab((state) => state.books);
  const words = useVocab((state) => state.words);
  const readDays = useVocab((state) => state.readDays);
  const overview = useMemo(() => readingOverview(books, words, readDays), [books, words, readDays]);
  const facts = [
    { value: overview.finished.length, label: t("share.statFinished") },
    { value: overview.readDays, label: t("share.statDays") },
    { value: overview.words, label: t("share.statWords") },
  ];
  const mastered = t("account.mastered", { n: "\u0001" }).split("\u0001");
  return (
    <section className="grid gap-3 rounded-2xl bg-sheet px-4 pt-3.5 pb-4" aria-labelledby="account-reading-title" data-reading-overview>
      <div className="flex items-center justify-between gap-2">
        <h3 id="account-reading-title" className="m-0 text-[15px] font-bold">
          {t("overview.title")}
        </h3>
        <ShareButton what={{ kind: "overview" }} quiet className="min-h-9 bg-paper px-3 text-sm" />
      </div>
      <dl className="m-0 grid grid-cols-3 gap-1.5">
        {facts.map((fact, index) => (
          <div key={fact.label} className="stat-tile grid min-w-0 content-start rounded-2xl bg-paper px-3 pt-2.5 pb-3" data-overview-part={index}>
            <dt className="truncate text-xs text-faint">{fact.label}</dt>
            <dd className="m-0 mt-1.5 font-display text-[26px] leading-none font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums] text-ink">{fact.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-sm text-muted" data-overview-mastered>
        {mastered[0]}
        <b className="text-ink">{overview.mastered.toLocaleString()}</b>
        {mastered[1]}
      </p>
    </section>
  );
}
