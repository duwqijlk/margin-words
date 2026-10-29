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
  return (
    <section className="mt-5 rounded-xl border border-line px-4 py-3" aria-labelledby="account-reading-title" data-reading-overview>
      <div className="flex items-center justify-between gap-2">
        <h3 id="account-reading-title" className="text-sm font-semibold">
          {t("overview.title")}
        </h3>
        <ShareButton what={{ kind: "overview" }} quiet className="min-h-9 px-3 text-xs" />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {facts.map((fact, index) => (
          <div key={fact.label} className="grid gap-0.5" data-overview-part={index}>
            <dd className="font-display font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums] text-xl tabular-nums text-ink">{fact.value}</dd>
            <dt className="order-first text-xs text-muted">{fact.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
